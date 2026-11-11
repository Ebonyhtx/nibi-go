// RelayTransport——桌面 WebRemoteControlDeviceTransport 的 terminal 侧移植（草案 §1）。
// 上游参考: nibi-client@ff1c5f4f packages/desktop/src/main/web-remote-relay/webRemoteControlTransport.ts
// 协议依据: nibi-client docs/web-remote-control/relay-v2-pairing.md（Relay V2 契约 + §05 手机侧语义）。
// 与桌面的差异（均为既定手机侧语义，非自创）:
//   - 角色 terminal：无设备注册（device_sid 来自扫码/持久凭据）；auth_init 后 AUTH_FAILED →
//     device-not-owned 终态（不重试注册——注册是桌面 device 侧职责）
//   - 退避 500ms×2ⁿ 最大 10s（桌面 1s 起步最大 30s），jitter ±20% 同源
//   - WRONG_PARAM → invalid-mobile-connection 终态；KICKED 60s 内第二次 → kicked 终态（session-conflict）
//   - WebSocket 经 createSocket 注入，本包零平台 import（AGENTS 规则 4）
//   - 客户端帧上限 guard 留待 A2 rpc-frame 层（relay 侧单消息 1MiB 上限不变）
import {
  parseWebRemoteControlRelayV2IncomingMessage,
  webRemoteControlV2PairState,
  WEB_REMOTE_CONTROL_V2_HEARTBEAT_ACK_TIMEOUT_MS,
  WebRemoteControlV2ConnectionError,
  WebRemoteControlV2Heartbeat,
  WebRemoteControlV2RetryPolicy,
  type WebRemoteControlRelayV2IncomingMessage,
  type WebRemoteControlRelayV2OutgoingMessage,
} from "@nibi-go/shared-extract";

import {
  SOCKET_CONNECTING,
  SOCKET_OPEN,
  TerminalTransportError,
  type ConnState,
  type RelayJson,
  type RelayTransportOptions,
  type SocketLike,
} from "./types";

export class RelayTransport {
  private socket?: SocketLike;
  private state: ConnState = "idle";
  private controller?: AbortController;
  private generation = 0;
  private pairedGeneration = 0;
  private connectStartedAt = 0;
  private connectAttempt = 0;
  private authenticated = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private readonly retry: WebRemoteControlV2RetryPolicy;
  private readonly heartbeat: WebRemoteControlV2Heartbeat;

  constructor(private readonly options: RelayTransportOptions) {
    // 手机侧退避（relay-v2-pairing.md §05）；桌面默认值在抽取件 retry.ts 的构造器缺省里
    this.retry = options.retry ?? new WebRemoteControlV2RetryPolicy(undefined, {
      initialMs: 500,
      maxMs: 10_000,
      jitter: 0.2,
    });
    this.heartbeat = new WebRemoteControlV2Heartbeat(
      () => this.sendControl({ type: "pair_status_query", client_ts: Math.floor(Date.now() / 1000) }),
      () => this.scheduleReconnect(),
      {
        intervalMs: options.timing?.heartbeatIntervalMs,
        jitterMs: options.timing?.heartbeatJitterMs,
        ackTimeoutMs: options.timing?.ackTimeoutMs,
      },
    );
  }

  start(): void {
    if (this.controller) return;
    this.controller = new AbortController();
    void this.connect();
  }

  dispose(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.closeSocket();
    this.controller?.abort();
    this.controller = undefined;
    this.setState("idle");
  }

  /** 已配对发送 data payload（仅 `data` 过信封插桩点，草案 §1）。 */
  sendData(payload: RelayJson): boolean {
    if (this.state !== "paired" || this.socket?.readyState !== SOCKET_OPEN) return false;
    const transformed = this.options.transformOutgoingData
      ? this.options.transformOutgoingData(payload)
      : payload;
    this.sendControl({
      type: "data",
      payload: transformed,
      client_ts: Math.floor(Date.now() / 1000),
    });
    return true;
  }

  /**
   * 回前台/网络恢复（Spike 2 结论）：跳过退避等待立即重连。
   * 已配对时不动（配对中连接仍活）；后台恢复后应主动探测而非信任旧 socket——
   * 调用方先 disconnect 再 resume，或直接 reconnectNow（重连后 onSendReady 会带 reconnected-socket）。
   */
  reconnectNow(): void {
    if (!this.controller || this.controller.signal.aborted) return;
    if (this.state === "paired") return;
    this.scheduleReconnect(0);
  }

  private async connect(): Promise<void> {
    const signal = this.controller?.signal;
    if (!signal || signal.aborted) return;
    this.closeSocket();
    const generation = this.generation;
    this.connectStartedAt = Date.now();
    this.connectAttempt += 1;
    this.setState("connecting");
    try {
      // 一次性 token 每次建连重新申请（relay 契约：升级前原子消费，失败不恢复）
      const token = await this.options.getToken(signal);
      if (signal.aborted || generation !== this.generation) return;
      const url = new URL(this.options.relayWsUrl);
      url.searchParams.set("token", token);
      if (this.options.deviceMid) url.searchParams.set("mid", this.options.deviceMid);
      const socket = this.options.createSocket(url.toString());
      this.socket = socket;
      // 握手 deadline 与 ACK watchdog 同源（15s）
      this.handshakeTimer = setTimeout(
        () => this.scheduleReconnect(),
        this.options.timing?.ackTimeoutMs ?? WEB_REMOTE_CONTROL_V2_HEARTBEAT_ACK_TIMEOUT_MS,
      );
      socket.onOpen(() => {
        if (socket !== this.socket) return;
        this.setState("authenticating");
        this.sendControl({
          type: "auth_init",
          device_sid: this.options.deviceSid,
          meta: this.options.meta,
          client_ts: Math.floor(Date.now() / 1000),
        });
      });
      socket.onMessage((data) => {
        if (socket !== this.socket) return;
        let value: unknown;
        try {
          value = JSON.parse(data);
        } catch {
          return;
        }
        const message = parseWebRemoteControlRelayV2IncomingMessage(value);
        if (message) void this.handleMessage(message);
      });
      socket.onError(() => {
        // WS 错误可能包含一次性 token URL，不落具体内容（凭据纪律）
        if (socket === this.socket) this.options.logger?.warn("[relay-client] socket error");
      });
      socket.onClose(() => {
        if (socket !== this.socket) return;
        this.scheduleReconnect();
      });
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return;
      this.handleConnectionError(error);
    }
  }

  private async handleMessage(message: WebRemoteControlRelayV2IncomingMessage): Promise<void> {
    if (message.type === "error") {
      if (message.code === "KICKED") {
        const delay = this.retry.kickedDelay();
        if (delay === null) {
          // 60s 内第二次：session-conflict 终态，回前台不能绕过（§05/§07）
          this.closeSocket();
          this.setState("kicked");
          this.options.onError(new TerminalTransportError("session-conflict"));
        } else this.scheduleReconnect(delay);
      } else if (message.code === "AUTH_FAILED" && this.state === "authenticating") {
        // terminal 无重注册路径：目标桌面不属当前账号（§05 device-not-owned）
        this.finishTerminal("device-not-owned");
      } else if (message.code === "WRONG_PARAM") {
        this.finishTerminal("invalid-mobile-connection");
      } else if (message.code === "INTERNAL" || message.code === "DEVICE_OFFLINE") {
        // 可恢复等待/重连（DEVICE_OFFLINE 的宽限在 relay 侧）
        this.scheduleReconnect();
      } else {
        this.handleConnectionError(new WebRemoteControlV2ConnectionError("relay-unavailable"));
      }
      return;
    }
    if (message.type === "auth_ack") {
      if (this.state !== "authenticating" || message.device_sid !== this.options.deviceSid) return;
      clearTimeout(this.handshakeTimer);
      this.authenticated = true;
      this.retry.acknowledged();
    }
    if (!this.authenticated) return;
    if (message.type === "auth_ack" || message.type === "pair_status_ack") {
      const previousGeneration = this.pairedGeneration;
      this.heartbeat.acknowledged();
      this.setState(webRemoteControlV2PairState(message.pair_status));
      if (message.pair_status === "matched") {
        this.pairedGeneration = this.generation;
        if (previousGeneration)
          this.options.onSendReady?.({
            kind: previousGeneration === this.generation ? "same-socket" : "reconnected-socket",
          });
      }
    } else if (message.type === "data" && this.state === "paired") {
      const payload = this.options.transformIncomingData
        ? this.options.transformIncomingData(message.payload)
        : message.payload;
      if (payload === null || payload === undefined) return;
      this.options.onData(payload);
    }
  }

  private closeSocket(): void {
    // 先撤销当前代，再关闭；旧 close/ACK 及异步 token 结果均不能推进下一代。
    this.generation += 1;
    this.authenticated = false;
    this.heartbeat.stop();
    clearTimeout(this.handshakeTimer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket?.readyState === SOCKET_CONNECTING) socket.terminate();
    else socket?.close();
  }

  private scheduleReconnect(delay = this.retry.nextDelay()): void {
    if (!this.controller || this.controller.signal.aborted) return;
    this.closeSocket();
    clearTimeout(this.reconnectTimer);
    this.setState("connecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private handleConnectionError(error: unknown): void {
    let terminal: TerminalTransportError | undefined;
    if (error instanceof WebRemoteControlV2ConnectionError) {
      terminal = new TerminalTransportError(
        error.reason === "auth-required" ? "auth-required" : "relay-unavailable",
        error.retryable,
      );
    } else if (error instanceof TerminalTransportError) {
      terminal = error;
    }
    if (!terminal || terminal.retryable) {
      // 网络/5xx → 指数退避重连
      this.options.logger?.warn("[relay-client] connection retry");
      this.scheduleReconnect();
      return;
    }
    // HTTP401 auth-required / 其他 4xx：停止自动重连（§05）
    this.closeSocket();
    clearTimeout(this.reconnectTimer);
    this.setState("error");
    this.options.onError(terminal);
  }

  private finishTerminal(kind: "device-not-owned" | "invalid-mobile-connection"): void {
    this.closeSocket();
    clearTimeout(this.reconnectTimer);
    this.setState("error");
    this.options.onError(new TerminalTransportError(kind));
  }

  private sendControl(message: WebRemoteControlRelayV2OutgoingMessage): void {
    if (this.socket?.readyState === SOCKET_OPEN) this.socket.send(JSON.stringify(message));
  }

  private setState(state: ConnState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.logger?.info("[relay-client] state", { state });
    this.options.onStateChange(state);
  }
}
