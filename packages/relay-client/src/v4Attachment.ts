// V4 attachment 握手（hello → clientHello）。
//
// 根因：桌面把每个 RPC attachment 包在 zcodeAgentConnectionScope 里，role=terminal-client
// 时未完成 hello → clientHello 的 subscribeConversationV4 / sendConversationCommandV4 会被
// `fault.connection.handshakeRequired` 直接拒绝；失败后 GO 只把 phase 置 error，store.snapshot
// 永远为空，pendingInteractions 就表现为"恒为空"。所以订阅/命令之前必须先握手。
//
// 上游语义（nibi-client packages/ui/src/v4/agentV4ConnectionHandshake.ts）：
//   - 每个 attachment 只做一次，并发首订阅共享同一个 Promise；
//   - clientId 必须在 attachment 生命周期内稳定：桌面 initializeConversationV4 记录
//     boundClientId，之后 command envelope.clientId 不一致会报 fault.command.clientMismatch；
//   - capabilities 是 strictObject：只有 Host 在 hello 里声明过的能力才能回声明，
//     否则整条 clientHello 解析失败（不是优雅降级，是会话面板打不开）。
// 旧桌面（没有 helloConversationV4）：跳过握手继续走旧订阅路径；不能把 UI 永久卡在 error。
import {
  V4_WIRE_PROTOCOL_VERSION,
  helloMessageSchema,
  hostSupportsWorkflowRunDeltas,
  type ClientHello,
  type HelloMessage,
  type IChannel,
} from "@nibi-go/shared-extract";

export type BridgeHandshakeErrorKind = "unsupported" | "rejected";

/** 握手诊断状态：legacy = 旧桌面无握手方法（已降级）；failed 可在下次订阅重试。 */
export type BridgeHandshakeState = "pending" | "complete" | "legacy" | "failed";

/** 握手失败可诊断：unsupported（方法缺失）/ rejected（Host 拒绝或回包非法）。 */
export class BridgeHandshakeError extends Error {
  constructor(
    readonly kind: BridgeHandshakeErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BridgeHandshakeError";
  }
}

/** ConversationSubscription/SessionsIndexSubscription 需要的 attachment 级上下文。 */
export interface AgentV4Attachment {
  /** 整个 attachment 生命周期稳定；clientHello 与 command envelope 必须同值。 */
  readonly clientId: string;
  /** 首次订阅/命令前完成 hello → clientHello；并发调用共享同一 Promise。 */
  ensureHandshake(): Promise<void>;
}

export interface AgentV4AttachmentHandshakeOptions {
  /** 桌面只把它当诊断字段；缺省 "unknown"（上游同值）。 */
  appVersion?: string;
  logger?: { warn: (...args: unknown[]) => void };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * RPC 方法缺失（旧桌面）的判定：ChannelServer 的 ProxyChannel 抛 `Method not found: <name>`；
 * JSON-RPC 形态可能带 -32601 code。拒绝/故障（handshakeRequired、clientChanged）不在此列。
 */
export function isHandshakeMethodUnavailable(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === -32601) return true;
  }
  return /method not found|unknown method|not implemented/i.test(errorMessage(error));
}

/**
 * 单个 attachment 的 V4 握手状态机。WorkspaceBridge 在 openWorkspace 时创建一份，
 * 该 attachment 下所有 conversation / sessions-index 订阅共用。
 */
export class AgentV4AttachmentHandshake implements AgentV4Attachment {
  private pending?: Promise<void>;
  private stateValue: BridgeHandshakeState = "pending";

  constructor(
    private readonly channel: IChannel,
    readonly clientId: string,
    private readonly options: AgentV4AttachmentHandshakeOptions = {},
  ) {}

  get state(): BridgeHandshakeState {
    return this.stateValue;
  }

  ensureHandshake(): Promise<void> {
    if (this.pending) return this.pending;
    // 上一次 rejected 已清掉 pending；同一 attachment 的重订阅可以再次尝试
    // （与上游 failures delete handshake 的语义一致）。成功/legacy 后 pending 永久保留。
    this.stateValue = "pending";
    const pending = this.runHandshake();
    this.pending = pending;
    void pending.catch(() => {
      if (this.pending === pending) this.pending = undefined;
    });
    return pending;
  }

  private async runHandshake(): Promise<void> {
    let hello: HelloMessage;
    try {
      hello = helloMessageSchema.parse(await this.channel.call("helloConversationV4"));
    } catch (error) {
      if (isHandshakeMethodUnavailable(error)) {
        // 旧桌面没有握手方法，也就没有 handshakeRequired 门禁：直接走旧订阅路径。
        this.stateValue = "legacy";
        this.options.logger?.warn("[bridge] V4 handshake unavailable; continue legacy attach", {
          clientId: this.clientId,
          error: errorMessage(error),
        });
        return;
      }
      this.stateValue = "failed";
      throw new BridgeHandshakeError("rejected", `V4 hello 失败: ${errorMessage(error)}`, {
        cause: error,
      });
    }

    // 严格对象：只回声明 Host 在 hello 里宣告过的能力。GO 没有 workspace hook review UI，
    // 因此不声明 workspaceHookReviewUi——谎报会让 Host 把该能力的交互路由过来。
    const capabilities: NonNullable<ClientHello["capabilities"]> = {
      ...(hello.capabilities.historyFirst === true ? { historyFirst: true } : {}),
      ...(hostSupportsWorkflowRunDeltas(hello.capabilities) ? { workflowRunDeltas: true } : {}),
    };
    const clientHello: ClientHello = {
      kind: "clientHello",
      protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      clientId: this.clientId,
      // 手机走 web-remote-replayable；desktop 分支只为同一 helper 的通用性保留。
      clientKind: hello.clientMode === "desktop-continuous" ? "desktop" : "mobileApp",
      appVersion: this.options.appVersion ?? "unknown",
      ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
    };

    try {
      // ProxyChannel 的 call arg 是方法实参数组；裸对象会被解成 0 个实参。
      await this.channel.call("initializeConversationV4", [clientHello]);
    } catch (error) {
      this.stateValue = "failed";
      const kind = isHandshakeMethodUnavailable(error) ? "unsupported" : "rejected";
      throw new BridgeHandshakeError(kind, `V4 clientHello 失败: ${errorMessage(error)}`, {
        cause: error,
      });
    }
    this.stateValue = "complete";
  }
}
