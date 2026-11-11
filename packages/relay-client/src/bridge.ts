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
  sessionsIndexTopicFrameSchema,
  type AcknowledgedWebRemoteControlRelayProtocolAdapter,
  type ConversationTopicFrame,
  type ConversationTopicWireCandidate,
  type IChannel,
  type SessionsIndexTopicFrame,
  type SessionsIndexTopicWireCandidate,
  type SubscribeAck,
  type WebRemoteControlRpcTransportFault,
} from "@nibi-go/shared-extract";

import type { RelayJson } from "./types";
import {
  AgentV4AttachmentHandshake,
  type AgentV4Attachment,
} from "./v4Attachment";

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
  /** attachment 级 V4 握手 + clientId；openWorkspace 重建，conversation/sessions-index 共享。 */
  private attachment?: AgentV4AttachmentHandshake;
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
    // 新的 bridge attachment：clientId 与握手状态都属于它，不能复用上一条连接的。
    this.attachment = new AgentV4AttachmentHandshake(
      this.channelClient.getChannel<IChannel>(ZCODE_AGENT_CHANNEL),
      randomId(),
      { logger: this.options.logger },
    );
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
    if (!this.channelClient || !this.attachment) throw new Error("workspace bridge is not open");
    return new ConversationSubscription(
      this.channelClient.getChannel<IChannel>(ZCODE_AGENT_CHANNEL),
      target,
      sessionId,
      callbacks,
      this.now,
      this.attachment,
    );
  }

  /** 打开 workspace 级会话列表订阅（sessions-index topic；需先 openWorkspace）。 */
  sessionsIndex(
    target: BridgeWorkspaceTarget,
    callbacks: SessionsIndexCallbacks,
  ): SessionsIndexSubscription {
    if (!this.channelClient || !this.attachment) throw new Error("workspace bridge is not open");
    return new SessionsIndexSubscription(
      this.channelClient.getChannel<IChannel>(ZCODE_AGENT_CHANNEL),
      target,
      callbacks,
      this.now,
      this.attachment,
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
    this.attachment = undefined;
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

/** resolveInteraction 的 answer：新路径用 optionId；旧载荷/取消用 action。 */
export interface ResolveInteractionAnswer {
  /** 快照 pendingInteractions[].payload.options[].optionId（桌面按它判定 allow/deny）。 */
  optionId?: string;
  /** 无 options 的兼容路径；cancel 也走这里（command.ts answer.action 闭集）。 */
  action?: "accept" | "decline" | "cancel";
}

/** 单个会话的 V4 订阅 + sendText（方法面见 zcodeAgent.ts 契约）。 */
export class ConversationSubscription {
  private readonly assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
  /** attachment 级 clientId：clientHello 绑定它，sendConversationCommandV4 会按它校验。 */
  private readonly clientId: string;
  private listener?: { dispose(): void };
  private subscriptionId?: string;

  constructor(
    private readonly channel: IChannel,
    private readonly target: BridgeWorkspaceTarget,
    private readonly sessionId: string,
    private readonly callbacks: ConversationSubscriptionCallbacks,
    private readonly now: () => number = Date.now,
    /** 直连构造（测试/旧调用）可缺省：无 attachment 时不握手、自用一次性 clientId。 */
    private readonly attachment?: AgentV4Attachment,
  ) {
    this.clientId = attachment?.clientId ?? randomId();
  }

  get id(): string | undefined {
    return this.subscriptionId;
  }

  /** 订阅会话：ACK 返回 subscriptionId 与初始帧模式（snapshot/resume）。 */
  async subscribe(): Promise<SubscribeAck> {
    // 必须先 hello → clientHello：桌面 connection scope 未握手时直接拒绝订阅。
    await this.attachment?.ensureHandshake();
    // 注意：桌面服务经 ProxyChannel 暴露，call 的 arg 是"方法实参数组"（target.apply(handler, args)）。
    // 传裸对象会让 ProxyChannel 解出 0 个实参，订阅方法收到 undefined。
    const result = await this.channel.call<{ ack: SubscribeAck }>("subscribeConversationV4", [
      {
        ...this.target,
        sessionId: this.sessionId,
      },
    ]);
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
    return this.sendCommand("sendText", {
      text,
      ...(options.requestedDelivery ? { requestedDelivery: options.requestedDelivery } : {}),
    });
  }

  /**
   * 审批/提问作答（A3）：resolveInteraction 命令（command.ts 契约）。
   *
   * 根因：桌面按 answer.optionId 精确匹配快照 options[].optionId 判定；没有 optionId 时
   * permission 一律 deny（Node interaction-broker v4AnswerToPermissionResponse / Rust
   * commands.rs resolve）。旧的 `{action:"accept"}` 只对 AskUserQuestion 等 elicitation
   * 通道有效，权限卡点"允许"会被当成拒绝。新路径必须传选项的 optionId；无 options 的
   * 旧载荷（userInput/旧快照）仍退回 action 兼容。
   */
  async resolveInteraction(
    interactionId: string,
    answer: ResolveInteractionAnswer,
  ): Promise<unknown> {
    if (!answer.optionId && !answer.action) {
      throw new Error("resolveInteraction requires optionId (new path) or action (legacy)");
    }
    // optionId 优先：同时给出时不混入 action，避免桌面按 action 走 elicitation 分支。
    return this.sendCommand("resolveInteraction", {
      interactionId,
      answer: answer.optionId ? { optionId: answer.optionId } : { action: answer.action },
    });
  }

  /** 通用 V4 命令（commandEnvelopeSchema 信封；服务面按需扩展）。 */
  async sendCommand(type: string, payload: unknown): Promise<unknown> {
    // 命令同样受 connection scope 的 handshakeRequired / boundClientId 校验。
    await this.attachment?.ensureHandshake();
    return this.channel.call("sendConversationCommandV4", [
      {
        ...this.target,
        envelope: {
          commandId: randomId(),
          clientId: this.clientId,
          sessionId: this.sessionId,
          type,
          payload,
          issuedAt: this.now(),
        },
      },
    ]);
  }

  async unsubscribe(): Promise<void> {
    this.listener?.dispose();
    this.listener = undefined;
    const subscriptionId = this.subscriptionId;
    this.subscriptionId = undefined;
    if (!subscriptionId) return;
    await this.channel
      .call("unsubscribeConversationV4", [
        {
          // 必须带全 target：桌面按 workspaceIdentity（若存在）匹配 ownership，只带 path 会 no-op。
          ...this.target,
          subscriptionId,
        },
      ])
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

export interface SessionsIndexCallbacks {
  /** workspace 会话列表帧（快照/增量）；上层维护列表状态。 */
  onFrame(frame: SessionsIndexTopicFrame): void;
}

/** workspace 级会话列表订阅（sessions-index topic，与 conversation 同一通知按 topic 前缀分流）。 */
export class SessionsIndexSubscription {
  private readonly assembler = new TopicWireFrameAssembler(sessionsIndexTopicFrameSchema);
  private listener?: { dispose(): void };
  private subscriptionId?: string;

  constructor(
    private readonly channel: IChannel,
    private readonly target: BridgeWorkspaceTarget,
    private readonly callbacks: SessionsIndexCallbacks,
    private readonly now: () => number = Date.now,
    /** 与 conversation 订阅共享 attachment 握手；无 attachment（直连测试）时跳过。 */
    private readonly attachment?: AgentV4Attachment,
  ) {}

  get id(): string | undefined {
    return this.subscriptionId;
  }

  async subscribe(): Promise<SubscribeAck> {
    // sessions-index 同样在 connection scope 的 assertReady() 之后，必须先握手。
    await this.attachment?.ensureHandshake();
    const result = await this.channel.call<{ ack: SubscribeAck }>("subscribeSessionsIndexV4", [
      {
        ...this.target,
      },
    ]);
    this.subscriptionId = result.ack.subscriptionId;
    this.listener = this.channel.listen<SessionsIndexTopicWireCandidate>(
      "onDynamicSessionsIndexFrame",
      this.target,
    )((wire) => this.acceptWire(wire));
    return result.ack;
  }

  async unsubscribe(): Promise<void> {
    this.listener?.dispose();
    this.listener = undefined;
    const subscriptionId = this.subscriptionId;
    this.subscriptionId = undefined;
    if (!subscriptionId) return;
    await this.channel
      .call("unsubscribeSessionsIndexV4", [
        {
          // 同上：workspaceIdentity 参与 ownership 匹配。
          ...this.target,
          subscriptionId,
        },
      ])
      .catch(() => {
        // 断开时桌面可能已清理订阅；取消失败不阻塞本地清理
      });
  }

  private acceptWire(wire: SessionsIndexTopicWireCandidate): void {
    if (!wire.topic.startsWith("sessions-index/")) return;
    for (const event of this.assembler.accept(wire, this.now())) {
      if (event.kind === "complete") this.callbacks.onFrame(event.frame);
    }
  }
}
