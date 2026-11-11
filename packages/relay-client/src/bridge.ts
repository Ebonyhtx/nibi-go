// workspace bridge 客户端（A2-5，方案 B：精简原生桥）。
// 上游参考: nibi-client@ff1c5f4f
//   - packages/web/src/web-remote-control/app/webRemoteControlWorkspaceBridgeSession.ts（桥会话编排）
//   - packages/services/src/zcode-agent/zcodeAgent.ts（方法面：subscribeConversationV4 /
//     unsubscribeConversationV4 / onDynamicConversationFrame / sendConversationCommandV4）
//   - packages/shared/src/nibi-protocol-v4/transport.ts（conversation topic 帧契约）
// 分工：wire 层（rpc-frame / topic 帧 / Channel RPC / acknowledged 协议）全部复用 shared-extract 抽取件，
// 字节级与桌面一致；服务代理只覆盖手机需要的面（会话订阅 + sendText）。
// 桌面能力面演进 → 按 D17 票据制按需跟进（每新增一个能力面一次小 PR）。
import {
  ChannelClient,
  TopicWireFrameAssembler,
  conversationTopicFrameSchema,
  createAcknowledgedWebRemoteControlRelayProtocol,
  type AcknowledgedWebRemoteControlRelayProtocolAdapter,
  type ConversationTopicFrame,
  type ConversationTopicWireCandidate,
  type IChannel,
  type SubscribeAck,
  type WebRemoteControlRpcTransportFault,
} from "@nibi-go/shared-extract";

import type { RelayJson } from "./types";

/** 来源: packages/shared/src/channels.ts ServiceChannels.ZCodeAgent。 */
const ZCODE_AGENT_CHANNEL = "nibi-agent";

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkspaceBridgeOptions {
  /** 发送 relay data payload（通常为 RelayTransport.sendData）。 */
  send(payload: RelayJson): boolean;
  /** bootstrap / bridge-open 请求超时，默认 15s。 */
  requestTimeoutMs?: number;
  now?: () => number;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface BridgeWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export interface BootstrapWorkspace extends BridgeWorkspaceTarget {
  label?: string;
  kind?: "local" | "remote";
}

export interface BridgeMobileViewState {
  activeWorkspaceKey?: string;
  activeTaskId?: string;
}

export interface BridgeBootstrapResult {
  windowControlSessionId: string;
  desktopAppVersion?: string;
  workspaces: BootstrapWorkspace[];
  /** 桌面当前视图（activeWorkspaceKey/activeTaskId）——手机据此决定订阅哪个会话。 */
  mobileViewState?: BridgeMobileViewState;
  initialViewState?: BridgeMobileViewState;
}

/** 对应上游 WebRemoteControlExternalWorkspaceBridge（手机侧消费的字段子集）。 */
export interface ExternalBridgeInfo {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  kind: "local" | "remote";
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export interface BridgeDegradedEvent {
  reasonCode: string;
  terminal: boolean;
}

/**
 * workspace bridge 会话：bootstrap-request → workspace-bridge-open → bridge-ready，
 * 之后建立 acknowledged 协议 + Channel RPC 通道，供 ConversationSubscription 使用。
 */
export class WorkspaceBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private ackProtocol?: AcknowledgedWebRemoteControlRelayProtocolAdapter;
  private channelClient?: ChannelClient;
  private bridgeInfo?: ExternalBridgeInfo;
  private readonly degradedListeners = new Set<(event: BridgeDegradedEvent) => void>();
  private readonly now: () => number;

  constructor(private readonly options: WorkspaceBridgeOptions) {
    this.now = options.now ?? Date.now;
  }

  get info(): ExternalBridgeInfo | undefined {
    return this.bridgeInfo;
  }

  get isDegraded(): boolean {
    return this.ackProtocol?.isDegraded() ?? false;
  }

  onDegraded(listener: (event: BridgeDegradedEvent) => void): () => void {
    this.degradedListeners.add(listener);
    return () => this.degradedListeners.delete(listener);
  }

  /** 手机首连：向桌面要 windowControlSessionId 与 workspace 列表。 */
  bootstrap(): Promise<BridgeBootstrapResult> {
    return this.request<BridgeBootstrapResult>({ nibi_type: "bootstrap-request" });
  }

  /** 选定 workspace：开 bridge 通道（bridge-ready 后自动挂 acknowledged 协议 + Channel RPC）。 */
  async openWorkspace(params: { workspaceKey: string; taskId?: string }): Promise<ExternalBridgeInfo> {
    const bridgeSessionId = randomId();
    const recoveryId = randomId();
    const info = await this.request<ExternalBridgeInfo>({
      nibi_type: "workspace-bridge-open",
      bridgeSessionId,
      recoveryId,
      workspaceKey: params.workspaceKey,
      ...(params.taskId ? { taskId: params.taskId } : {}),
    });
    this.bridgeInfo = info;
    this.ackProtocol = createAcknowledgedWebRemoteControlRelayProtocol({
      bridgeSessionId: info.bridgeSessionId,
      bridgeGeneration: info.bridgeGeneration,
      recoveryId: info.recoveryId,
      sendFrame: (payload) => this.options.send(payload as RelayJson) !== false,
      now: this.now,
    });
    this.ackProtocol.onDegraded((fault: WebRemoteControlRpcTransportFault) => {
      this.options.logger?.warn("[bridge] degraded", { reasonCode: fault.reasonCode });
      for (const listener of this.degradedListeners) {
        listener({ reasonCode: fault.reasonCode, terminal: fault.terminal });
      }
    });
    this.channelClient = new ChannelClient(this.ackProtocol.protocol);
    return info;
  }

  /**
   * relay data 入口路由（app 在 RelayTransport.onData 里调用）：
   * rpc-frame / rpc-frame-ack → acknowledged 协议；bootstrap/bridge 控制回包 → 挂起请求；
   * bridge-degraded → 降级监听。
   */
  acceptPayload(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const record = payload as Record<string, unknown>;
    switch (record.nibi_type) {
      case "rpc-frame":
      case "rpc-frame-ack":
        return this.ackProtocol?.acceptPayload(payload) ?? false;
      case "bootstrap-response": {
        const requestId = String(record.requestId ?? "");
        if (record.success === false) {
          this.rejectPending(requestId, new Error(String(record.error ?? "bootstrap failed")));
          return true;
        }
        this.resolvePending(requestId, record.result as BridgeBootstrapResult);
        return true;
      }
      case "workspace-bridge-ready": {
        const requestId = String(record.requestId ?? "");
        this.resolvePending(requestId, record.bridge as ExternalBridgeInfo);
        return true;
      }
      case "workspace-bridge-error": {
        const requestId = String(record.requestId ?? "");
        this.rejectPending(
          requestId,
          new Error(String(record.error ?? record.reason ?? "workspace bridge failed")),
        );
        return true;
      }
      case "bridge-degraded": {
        const event = {
          reasonCode: String(record.reason ?? "unknown"),
          terminal: true,
        };
        for (const listener of this.degradedListeners) listener(event);
        return true;
      }
      default:
        return false;
    }
  }

  /** 打开某个会话的订阅通道（需先 openWorkspace）。 */
  conversation(
    target: BridgeWorkspaceTarget,
    sessionId: string,
    callbacks: ConversationSubscriptionCallbacks,
  ): ConversationSubscription {
    if (!this.channelClient) throw new Error("workspace bridge is not open");
    return new ConversationSubscription(
      this.channelClient.getChannel<IChannel>(ZCODE_AGENT_CHANNEL),
      target,
      sessionId,
      callbacks,
      this.now,
    );
  }

  /** 重连后重放未 ACK 的出站帧（对应上游 replayUnacknowledged）。 */
  replayUnacknowledged(): void {
    this.ackProtocol?.replayUnacknowledged();
  }

  dispose(): void {
    for (const [, pending] of this.pending) clearTimeout(pending.timer);
    this.pending.clear();
    this.degradedListeners.clear();
    this.ackProtocol?.dispose();
    this.ackProtocol = undefined;
    this.channelClient = undefined;
    this.bridgeInfo = undefined;
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    const requestId = randomId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("bridge request timeout"));
      }, this.options.requestTimeoutMs ?? 15_000);
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      if (!this.options.send({ ...payload, requestId } as RelayJson)) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("relay data channel unavailable"));
      }
    });
  }

  private resolvePending(requestId: string, value: unknown): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(value);
  }

  private rejectPending(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.reject(error);
  }
}

export interface ConversationSubscriptionCallbacks {
  /** topic 帧（快照/增量）已解析——上层接 chat-core ReplaySession。 */
  onFrame(frame: ConversationTopicFrame): void;
  /** 装配 fault（terminal 时上层应走 resync）。 */
  onDegraded?(fault: { reasonCode: string; terminal: boolean }): void;
}

export interface SendTextOptions {
  /** startNow = 抢占当前 turn；queue = 入队；guide = 插话（按 inputRouting 裁决）。 */
  requestedDelivery?: "startNow" | "queue" | "guide";
}

/** 单个会话的 V4 订阅 + sendText（方法面见 zcodeAgent.ts 契约）。 */
export class ConversationSubscription {
  private readonly assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
  private readonly clientId = randomId();
  private listener?: { dispose(): void };
  private subscriptionId?: string;

  constructor(
    private readonly channel: IChannel,
    private readonly target: BridgeWorkspaceTarget,
    private readonly sessionId: string,
    private readonly callbacks: ConversationSubscriptionCallbacks,
    private readonly now: () => number = Date.now,
  ) {}

  get id(): string | undefined {
    return this.subscriptionId;
  }

  /** 订阅会话：ACK 返回 subscriptionId 与初始帧模式（snapshot/resume）。 */
  async subscribe(): Promise<SubscribeAck> {
    const result = await this.channel.call<{ ack: SubscribeAck }>("subscribeConversationV4", {
      ...this.target,
      sessionId: this.sessionId,
    });
    this.subscriptionId = result.ack.subscriptionId;
    // 通知按 workspace fan-out，这里按 topic 过滤本会话（conversation/<sessionId>）
    this.listener = this.channel.listen<ConversationTopicWireCandidate>(
      "onDynamicConversationFrame",
      this.target,
    )((wire) => this.acceptWire(wire));
    return result.ack;
  }

  /** 发送文本（inputOrigin: mobile 由上游 payload source 面表达，A2 先带最小载荷）。 */
  async sendText(text: string, options: SendTextOptions = {}): Promise<unknown> {
    return this.channel.call("sendConversationCommandV4", {
      ...this.target,
      envelope: {
        commandId: randomId(),
        clientId: this.clientId,
        sessionId: this.sessionId,
        type: "sendText",
        payload: {
          text,
          ...(options.requestedDelivery
            ? { requestedDelivery: options.requestedDelivery }
            : {}),
        },
        issuedAt: this.now(),
      },
    });
  }

  async unsubscribe(): Promise<void> {
    this.listener?.dispose();
    this.listener = undefined;
    const subscriptionId = this.subscriptionId;
    this.subscriptionId = undefined;
    if (!subscriptionId) return;
    await this.channel
      .call("unsubscribeConversationV4", {
        workspacePath: this.target.workspacePath,
        subscriptionId,
      })
      .catch(() => {
        // 断开时桌面可能已清理订阅；取消失败不阻塞本地清理
      });
  }

  private acceptWire(wire: ConversationTopicWireCandidate): void {
    if (wire.topic !== `conversation/${this.sessionId}`) return;
    for (const event of this.assembler.accept(wire, this.now())) {
      if (event.kind === "complete") {
        this.callbacks.onFrame(event.frame);
      } else if (event.kind === "fault") {
        // topic 装配 fault 一律按终态上报（route 已废）；上层据此走 resync
        this.callbacks.onDegraded?.({
          reasonCode: event.fault.reasonCode,
          terminal: true,
        });
      }
    }
  }
}
