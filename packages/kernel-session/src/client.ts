import {
  KERNEL_METHODS,
  type KernelMcpServer,
  type KernelMessage,
  type KernelModelSelection,
  type KernelNotification,
  type KernelSendTextOptions,
  type KernelSessionCreateResult,
  type KernelSessionDataPurge,
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

/** `session/create` 的可选参数。 */
export interface KernelSessionCreateOptions {
  /**
   * `deferred`：草稿会话——首条用户输入之前不落库、不进 `session/list`
   * （内核在第一条输入时提升为正式会话）；`immediate` 或缺省照旧立即落库。
   */
  persistence?: "deferred" | "immediate";
  /**
   * 由 Host 生成会话 ID（工作区目录名要用它，创建前就得拿到）。
   * 内核缺省时自己生成；内置的本地内核一直支持显式 ID。
   */
  sessionId?: string;
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

interface SessionMcpParam {
  mcpServers?: readonly KernelMcpServer[];
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
  private sendSeq = 1;
  private resolveSeq = 1;
  private compactSeq = 1;
  private retrySeq = 1;
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

  /**
   * 建会话；成功后记住 sessionId。`model` 显式给出时新会话用它（设置页的默认模型）。
   * `options.persistence` 只在显式给出时随请求带上（`deferred` = 草稿，不落库直到首条输入）。
   */
  async createSession(
    workspace: KernelWorkspaceRef,
    model?: KernelModelSelection,
    mcpServers?: readonly KernelMcpServer[],
    options?: KernelSessionCreateOptions,
  ): Promise<KernelSessionCreateResult> {
    const persistence = options?.persistence;
    const sessionId = options?.sessionId;
    const result = await this.request<KernelSessionCreateResult>(KERNEL_METHODS.sessionCreate, {
      workspace,
      ...(model ? { model } : {}),
      ...(mcpServers && mcpServers.length > 0 ? { mcpServers } : {}),
      ...(persistence ? { persistence } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
    const id = result?.session?.sessionId;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("session/create 没有返回 sessionId");
    }
    this.sessionId = id;
    return { ...result, sessionId: id };
  }

  /**
   * 发一条用户提示（`v4/command` 的 `sendText`）。
   *
   * 和 legacy `session/send` 的区别：这条命令能带结构化引用（注释/选段）与插件引用，
   * 内核把引用/能力说明只注入模型文本，用户行仍显示原文。
   */
  async sendText(
    content: string,
    options: KernelSendTextOptions = {},
  ): Promise<{ accepted: boolean; delivery?: string }> {
    const sessionId = this.requireSessionId();
    const commandId = `send-${Date.now()}-${this.sendSeq++}`;
    const attachments = options.attachments ?? [];
    const quotes = options.conversationQuotes ?? [];
    const pluginReferences = options.pluginReferences ?? [];
    const ack = await this.request<{
      status?: unknown;
      reasonCode?: unknown;
      message?: unknown;
      result?: { delivery?: unknown };
    }>(KERNEL_METHODS.command, {
      commandId,
      clientId: this.clientId,
      sessionId,
      type: "sendText",
      payload: {
        text: content,
        clientId: this.clientId,
        queueItemId: commandId,
        inputOrigin: options.inputOrigin ?? "mobile",
        requestedDelivery: options.requestedDelivery ?? "startNow",
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
        ...(typeof options.planEnabled === "boolean" ? { planEnabled: options.planEnabled } : {}),
        ...(options.modelSelection
          ? {
              modelSelection: {
                providerId: options.modelSelection.providerId,
                modelId: options.modelSelection.modelId,
                ...(options.modelSelection.reasoningLevel
                  ? { options: { reasoningLevel: options.modelSelection.reasoningLevel } }
                  : {}),
              },
            }
          : {}),
        ...(quotes.length > 0 ? { conversationQuotes: quotes } : {}),
        ...(pluginReferences.length > 0 ? { pluginReferences } : {}),
      },
      issuedAt: Date.now(),
    });
    const status = typeof ack?.status === "string" ? ack.status : "";
    if (status === "rejected" || status === "failed") {
      const message = typeof ack?.message === "string" ? ack.message : "";
      throw new Error(message.length > 0 ? message : `内核拒绝了这次发送（${status}）`);
    }
    const delivery =
      typeof ack?.result?.delivery === "string" ? ack.result.delivery : undefined;
    return { accepted: true, ...(delivery ? { delivery } : {}) };
  }

  /** 发一条用户提示（`session/send`，legacy；不带结构化引用）。 */
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
   * 压缩当前会话上下文（`v4/command` 的 `compact`）。
   *
   * 以前 App 把 `/compact` 当普通文本发出去，模型会回“已压缩”而实际没压；内核只认这条
   * 命令。ACK 只是受理回执，真正的进度/结果走会话投影里的 timelineMarker 行。
   * 有回合在跑时内核会拒绝（fault.command.compactFailed），这里抛出可读原因。
   */
  async compact(): Promise<void> {
    const sessionId = this.requireSessionId();
    const ack = await this.request<{ status?: unknown; reasonCode?: unknown; message?: unknown }>(
      KERNEL_METHODS.command,
      {
        commandId: `compact-${Date.now()}-${this.compactSeq++}`,
        clientId: this.clientId,
        sessionId,
        type: "compact",
        payload: {},
        issuedAt: Date.now(),
      },
    );
    const status = typeof ack?.status === "string" ? ack.status : "";
    if (status === "rejected" || status === "failed") {
      const message = typeof ack?.message === "string" ? ack.message : "";
      throw new Error(message.length > 0 ? message : `内核拒绝了压缩（${status}）`);
    }
  }

  /**
   * 重试最后一轮（`v4/command` 的 `retryTurn`）：内核把历史截到最后一条用户输入之前，
   * 再重新提交一次。
   *
   * `target` 是协议必填（`{rowId, entityId}`，取自轮头行）：内核只认“最后一轮”，但 schema
   * 缺了它会回 `payload: missing required property target`。
   */
  async retryTurn(
    target: { rowId: number; entityId: string },
    bases: { revision: number; logEpoch: string },
  ): Promise<void> {
    const sessionId = this.requireSessionId();
    const ack = await this.request<{ status?: unknown; reasonCode?: unknown; message?: unknown }>(
      KERNEL_METHODS.command,
      {
        commandId: `retry-${Date.now()}-${this.retrySeq++}`,
        clientId: this.clientId,
        sessionId,
        type: "retryTurn",
        payload: { target },
        // retryTurn 是 CAS 命令：缺这两个内核直接回 “CAS commands require baseRevision and baseLogEpoch”。
        baseRevision: bases.revision,
        baseLogEpoch: bases.logEpoch,
        issuedAt: Date.now(),
      },
    );
    const status = typeof ack?.status === "string" ? ack.status : "";
    if (status === "rejected" || status === "failed") {
      const message = typeof ack?.message === "string" ? ack.message : "";
      throw new Error(message.length > 0 ? message : `内核拒绝了重试（${status}）`);
    }
  }

  /**
   * 立即切换会话模式（`session/setMode`，plan/build）。加号菜单里的计划模式/退出计划
   * 用这条命令，而不是等下一次 sendText 的 mode 字段——退出计划不该依赖再发一条消息。
   */
  async setMode(mode: "build" | "edit" | "guarded" | "yolo"): Promise<void> {
    const sessionId = this.requireSessionId();
    await this.request(KERNEL_METHODS.sessionSetMode, { sessionId, mode });
  }

  /**
   * 目标管理（`session/goal`）：`show` 回一句人读状态，`set` 设置/替换目标并让内核开一轮，
   * `pause`/`resume` 暂停或恢复续跑，`clear` 清除。
   *
   * 以前 App 把 `/goal` 当普通文本发：设置能生效但内核的回执走 Meta stdout、V4 投影不展示，
   * 界面上看不到任何结果；`/goal pause` 还会被解析成一个叫 “pause” 的新目标。
   */
  async goal(
    action: "show" | "set" | "pause" | "resume" | "clear",
    objective?: string,
  ): Promise<{ response: string; startedTurn: boolean }> {
    const sessionId = this.requireSessionId();
    const result = await this.request<{ response?: unknown; startedTurn?: unknown }>(
      KERNEL_METHODS.sessionGoal,
      {
        sessionId,
        action,
        ...(objective ? { objective } : {}),
      },
    );
    return {
      response: typeof result?.response === "string" ? result.response : "",
      startedTurn: result?.startedTurn === true,
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
   * 删除会话（`v4/command` 的 `deleteSession`，内核侧软删除）。
   *
   * 可以删当前没打开的会话（归档管理）；删除正在打开的会话时内核会先中断当前回合并关闭它。
   * 内核的 ACK 成功时没有 result（Node 同形）；拒绝/失败抛出可读原因。
   */
  async deleteSession(sessionId: string): Promise<void> {
    const ack = await this.request<{ status?: unknown; reasonCode?: unknown; message?: unknown }>(
      KERNEL_METHODS.command,
      {
        commandId: `delete-${sessionId}-${this.resolveSeq++}`,
        clientId: this.clientId,
        sessionId,
        type: "deleteSession",
        payload: {},
        issuedAt: Date.now(),
      },
    );
    const status = typeof ack?.status === "string" ? ack.status : "";
    if (status === "rejected" || status === "failed") {
      const message = typeof ack?.message === "string" ? ack.message : "";
      throw new Error(message.length > 0 ? message : `内核拒绝删除会话（${status}）`);
    }
  }

  /**
   * 彻底删除会话数据（`v4/storage/sessionData/purge`）：删除会话行（级联消息/part/待办/输入账本）
   * 与附件/轨迹文件目录，返回实际释放的文件字节。运行中、被分享/工作流引用、附件被别的会话引用
   * 的会话整棵保留（`kept` 说明原因）；逐项失败在 `failed`。
   *
   * 与 `deleteSession`（软删除）不同：这是不可恢复的硬删除，也是 NIBI 客户端「清理数据」用的
   * 同一个内核能力。数据库行删除不计入 `bytes`（SQLite 文件不收缩，但空闲页会被后续会话复用）。
   */
  async purgeSessionData(
    sessionIds: readonly string[],
    directories: readonly { workspacePath: string; workspaceIdentity?: string }[] = [],
  ): Promise<KernelSessionDataPurge> {
    return this.request<KernelSessionDataPurge>(KERNEL_METHODS.sessionDataPurge, {
      sessionIds,
      directories,
    });
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
   * 之后用 `readMessages()` 拿历史。插件 MCP 服务器随 resume 一起交回去（内核不持久化这份配置）。
   */
  async resumeSession(
    sessionId: string,
    mcpServers?: readonly KernelMcpServer[],
  ): Promise<unknown> {
    const params: { sessionId: string } & SessionMcpParam = { sessionId };
    if (mcpServers && mcpServers.length > 0) params.mcpServers = mcpServers;
    const result = await this.request(KERNEL_METHODS.sessionResume, params);
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
