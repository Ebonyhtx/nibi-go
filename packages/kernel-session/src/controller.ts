import type { KernelMessage, KernelNotification } from "./protocol";
import { mapKernelMessages, type ConversationRow } from "./rows";

/** 控制器只依赖这几个方法；测试里用假实现，App 里用 KernelSessionClient。 */
export interface KernelSessionSource {
  readonly currentSessionId: string | null;
  readMessages(options?: { afterMessageId?: string; limit?: number }): Promise<KernelMessage[]>;
  onNotification(listener: (notification: KernelNotification) => void): () => void;
}

export type TurnState = "idle" | "running";

export interface ConversationControllerOptions {
  /** 每次刷新全量读消息；默认 200。 */
  messageLimit?: number;
  /** 相邻两次刷新合并的时间窗，默认 100ms（stream.chunk 很密）。 */
  refreshDebounceMs?: number;
}

const REFRESH_EVENTS = new Set(["turn.started", "stream.chunk", "turn.terminal", "message.upserted"]);

/**
 * 会话界面的行状态容器：
 * - `refresh()` 全量读一次消息并映射成行；
 * - 内核通知（turn/stream）会合并成一次刷新（debounce）；
 * - UI 通过 `subscribe` 在行变化时重渲染。
 */
export class ConversationController {
  private readonly source: KernelSessionSource;
  private readonly messageLimit: number;
  private readonly refreshDebounceMs: number;
  private readonly listeners = new Set<() => void>();
  private readonly offNotification: () => void;
  private currentRows: ConversationRow[] = [];
  private currentTurn: TurnState = "idle";
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing: Promise<void> | null = null;
  private disposed = false;

  constructor(source: KernelSessionSource, options: ConversationControllerOptions = {}) {
    this.source = source;
    this.messageLimit = options.messageLimit ?? 200;
    this.refreshDebounceMs = options.refreshDebounceMs ?? 100;
    this.offNotification = source.onNotification((notification) => this.onNotification(notification));
  }

  get rows(): readonly ConversationRow[] {
    return this.currentRows;
  }

  get turn(): TurnState {
    return this.currentTurn;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 读一次消息并替换行；并发调用复用同一次请求。 */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.source
      .readMessages({ limit: this.messageLimit })
      .then((messages) => {
        if (this.disposed) return;
        this.currentRows = mapKernelMessages(messages);
        this.emit();
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** 停止监听并丢弃待刷新。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offNotification();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.listeners.clear();
  }

  private onNotification(notification: KernelNotification): void {
    if (this.disposed) return;
    const params = notification.params as { kind?: unknown; status?: unknown } | undefined;
    if (typeof params?.kind !== "string") return;
    if (params.kind === "turn.started") this.setTurn("running");
    if (params.kind === "turn.terminal") this.setTurn("idle");
    if (REFRESH_EVENTS.has(params.kind)) this.scheduleRefresh();
  }

  private setTurn(turn: TurnState): void {
    if (this.currentTurn === turn) return;
    this.currentTurn = turn;
    this.emit();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, this.refreshDebounceMs);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
