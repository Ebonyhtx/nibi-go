import {
  KERNEL_METHODS,
  type KernelMessage,
  type KernelNotification,
  type KernelSessionCreateResult,
  type KernelSessionSummary,
  type KernelTransport,
  type KernelWorkspaceRef,
} from "./protocol";

/** 内核返回的 JSON-RPC 错误（例如 `-32601 Method not found`）。 */
export class KernelProtocolError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "KernelProtocolError";
    this.code = code;
  }
}

export interface KernelSessionClientOptions {
  transport: KernelTransport;
  /** 单次请求超时，默认 30 s（建会话/首轮模型请求都可能慢）。 */
  requestTimeoutMs?: number;
  /**
   * 内核建会话时会反向请求运行期偏好（`session/requestRuntimePreferences`），
   * 这里的返回值就是给它的 result。默认最小可用集合；产品侧按设置页填全。
   */
  runtimePreferences?: (scope: string) => Record<string, unknown>;
  /** 命令信封里的客户端标识；内核按 `(sessionId, commandId)` 去重。 */
  clientId?: string;
}

/** `v4/conversation/fileChanges` 的一个文件（内核 `FileChangeItem`）。 */
export interface KernelFileChange {
  path: string;
  additions: number;
  deletions: number;
  /** 这一轮写这个文件的次数。 */
  writeCount: number;
  toolNames: string[];
}

/** `v4/conversation/fileChanges` 的结果（内核 `FileChangesReport`）。 */
export interface KernelFileChangesReport {
  files: number;
  additions: number;
  deletions: number;
  items: KernelFileChange[];
}

interface IncomingFrame {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 进程内内核的会话客户端（纯 TS，Node 可测；不依赖 react-native）。
 *
 * 只负责协议：请求/应答配对、内核反向请求的应答、通知转发。
 * UI 状态（行模型、reducer）是上一层的事。
 */
export class KernelSessionClient {
  private readonly transport: KernelTransport;
  private readonly requestTimeoutMs: number;
  private readonly runtimePreferences: (scope: string) => Record<string, unknown>;
  private readonly clientId: string;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(notification: KernelNotification) => void>();
  private readonly offLine: () => void;
  private nextId = 1;
  private resolveSeq = 1;
  private sessionId: string | null = null;
  private subscribed: { topic: string; connectionId: string } | null = null;
  private closed = false;

  constructor(options: KernelSessionClientOptions) {
    this.transport = options.transport;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runtimePreferences =
      options.runtimePreferences ?? (() => ({ nativeSearchEnhancementsEnabled: false }));
    this.clientId = options.clientId ?? "nibi-go";
    this.offLine = this.transport.onLine((line) => this.handleLine(line));
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /** 订阅内核通知（`v4/telemetry/event`、`computer-use/operation-event` 等）。 */
  onNotification(listener: (notification: KernelNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 发一条请求并等对应 result；内核回 error 或超时会 reject。 */
  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("内核会话客户端已关闭"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`内核请求超时：${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      const sent = this.transport.sendLine(JSON.stringify({ id, method, params }));
      if (!sent) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`内核输入通道不可用：${method}`));
      }
    });
  }

  /** 建会话；成功后记住 sessionId。 */
  async createSession(workspace: KernelWorkspaceRef): Promise<KernelSessionCreateResult> {
    const result = await this.request<KernelSessionCreateResult>(KERNEL_METHODS.sessionCreate, {
      workspace,
    });
    const id = result?.session?.sessionId;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("session/create 没有返回 sessionId");
    }
    this.sessionId = id;
    return { ...result, sessionId: id };
  }

  /** 发一条用户提示（`session/send`）。 */
  async sendPrompt(
    content: string,
    extra?: Record<string, unknown>,
  ): Promise<{ accepted: boolean; stateRevision?: number }> {
    const sessionId = this.requireSessionId();
    const result = await this.request<{ accepted?: unknown; stateRevision?: unknown }>(
      KERNEL_METHODS.sessionSend,
      { sessionId, content, ...extra },
    );
    return {
      accepted: result?.accepted === true,
      stateRevision: typeof result?.stateRevision === "number" ? result.stateRevision : undefined,
    };
  }

  /**
   * 回答一个待处理交互（`v4/command` 的 `resolveInteraction`）。
   *
   * 应答形状由交互类型决定：权限是 `{ optionId, freeText? }`；提问是
   * `{ action: "accept", content: { answers } }` 或 `{ action: "decline" }`。
   * 内核按先到先得处理，已收口的晚到应答回 `noop`——这里当成功。
   */
  async resolveInteraction(
    interactionId: string,
    answer: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = this.requireSessionId();
    const ack = await this.request<{ status?: unknown; reasonCode?: unknown; message?: unknown }>(
      KERNEL_METHODS.command,
      {
        commandId: `resolve-${interactionId}-${this.resolveSeq++}`,
        clientId: this.clientId,
        sessionId,
        type: "resolveInteraction",
        payload: { interactionId, answer },
        // commandEnvelopeSchema 的必填字段（真机核对：缺它会回 -32602 "(root): missing"）。
        issuedAt: Date.now(),
      },
    );
    const status = typeof ack?.status === "string" ? ack.status : "";
    if (status === "rejected" || status === "failed") {
      const message = typeof ack?.message === "string" ? ack.message : "";
      throw new Error(message.length > 0 ? message : `内核拒绝了这次回答（${status}）`);
    }
  }

  /**
   * 读一轮的文件改动明细（`v4/conversation/fileChanges`）。
   *
   * `target` 必须是轮头行（`rowId` + `entityId`）；`baseRevision` / `baseLogEpoch` 取自
   * 当前快照，内核按 CAS 校验（过期回 `proto.staleRevision` / `proto.staleLogEpoch`）。
   */
  async fileChanges(
    target: { rowId: number; entityId: string },
    bases: { revision: number; logEpoch: string },
  ): Promise<KernelFileChangesReport> {
    const sessionId = this.requireSessionId();
    return this.request<KernelFileChangesReport>(KERNEL_METHODS.fileChanges, {
      sessionId,
      target,
      baseRevision: bases.revision,
      baseLogEpoch: bases.logEpoch,
    });
  }

  /** 读会话消息（`session/messages`；增量用 `afterMessageId`）。 */
  async readMessages(options?: {
    afterMessageId?: string;
    limit?: number;
  }): Promise<KernelMessage[]> {
    const sessionId = this.requireSessionId();
    const result = await this.request<{ messages?: unknown }>(KERNEL_METHODS.sessionMessages, {
      sessionId,
      ...(options?.afterMessageId ? { afterMessageId: options.afterMessageId } : {}),
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
    });
    return Array.isArray(result?.messages) ? (result.messages as KernelMessage[]) : [];
  }

  /** 列会话（`session/list`）；按 workspace 过滤，缺省取内核目录里的最近 50 条。 */
  async listSessions(options?: {
    workspace?: KernelWorkspaceRef;
    limit?: number;
  }): Promise<KernelSessionSummary[]> {
    const result = await this.request<{ sessions?: unknown }>(KERNEL_METHODS.sessionList, {
      ...(options?.workspace ? { workspace: options.workspace } : {}),
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
    });
    return Array.isArray(result?.sessions) ? (result.sessions as KernelSessionSummary[]) : [];
  }

  /**
   * 恢复会话（`session/resume`）：内核冷加载运行实例，返回快照。
   * 之后用 `readMessages()` 拿历史。
   */
  async resumeSession(sessionId: string): Promise<unknown> {
    const result = await this.request(KERNEL_METHODS.sessionResume, { sessionId });
    this.sessionId = sessionId;
    return result;
  }

  /**
   * 订阅会话的 V4 变更流（`v4/conversation/subscribe`）。
   * 之后内核会推送 `v4/conversation/frame` 通知：首帧 `{kind:"snapshot"}`，之后 `{kind:"deltas"}`。
   */
  async subscribeConversation(
    sessionId: string,
    options?: { connectionId?: string; clientMode?: string },
  ): Promise<{ topic: string; connectionId: string }> {
    const topic = `conversation/${sessionId}`;
    const connectionId = options?.connectionId ?? `nibi-go-${Date.now()}`;
    await this.request(KERNEL_METHODS.conversationSubscribe, {
      topic,
      connectionId,
      clientMode: options?.clientMode ?? "desktop-continuous",
    });
    this.subscribed = { topic, connectionId };
    return { topic, connectionId };
  }

  /** 取消订阅（同一 connectionId）。 */
  async unsubscribeConversation(): Promise<void> {
    const current = this.subscribed;
    if (!current) return;
    this.subscribed = null;
    await this.request(KERNEL_METHODS.conversationUnsubscribe, {
      topic: current.topic,
      connectionId: current.connectionId,
    });
  }

  /** 停止监听；未完成的请求一律 reject。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.offLine();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("内核会话客户端已关闭"));
      this.pending.delete(id);
    }
    this.listeners.clear();
  }

  private requireSessionId(): string {
    if (!this.sessionId) throw new Error("还没有会话：先 createSession()");
    return this.sessionId;
  }

  private handleLine(line: string): void {
    let frame: IncomingFrame;
    try {
      frame = JSON.parse(line) as IncomingFrame;
    } catch {
      return; // 非 JSON 行（启动期诊断）不参与协议。
    }
    if (!frame || typeof frame !== "object") return;

    // 我们对内核的请求：数字 id。
    if (typeof frame.id === "number" && this.pending.has(frame.id)) {
      this.settle(frame.id, frame);
      return;
    }

    // 内核对我们的请求：字符串 id（如 "rs-1"）。
    if (typeof frame.id === "string" && typeof frame.method === "string") {
      this.answerRequest(frame.id, frame.method, frame.params);
      return;
    }

    // 通知帧：只有 method。
    if (typeof frame.method === "string") {
      const notification: KernelNotification = { method: frame.method };
      if (frame.params !== undefined) notification.params = frame.params;
      for (const listener of this.listeners) listener(notification);
    }
  }

  private settle(id: number, frame: IncomingFrame): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const error = frame.error;
    if (error && typeof error === "object") {
      const code = typeof error.code === "number" ? error.code : -32603;
      const message = typeof error.message === "string" ? error.message : "内核请求失败";
      pending.reject(new KernelProtocolError(code, message));
      return;
    }
    pending.resolve(frame.result);
  }

  private answerRequest(id: string, method: string, params: unknown): void {
    if (method === KERNEL_METHODS.requestRuntimePreferences) {
      const scope =
        params && typeof params === "object" && typeof (params as { scope?: unknown }).scope === "string"
          ? (params as { scope: string }).scope
          : "";
      this.transport.sendLine(JSON.stringify({ id, result: this.runtimePreferences(scope) }));
      return;
    }
    this.transport.sendLine(
      JSON.stringify({ id, error: { code: -32601, message: `Method not found: ${method}` } }),
    );
  }
}
