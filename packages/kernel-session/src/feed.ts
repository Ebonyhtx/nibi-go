// V4 会话流：把 `v4/conversation/frame` 通知还原成 ConversationSnapshot。
//
// 这是 dsh-Go 的做法（packages/dsh_client transcript：快照 + 增量 append），
// 也是内核给桌面的同一条 v4 投影：首帧 `{kind:"snapshot"}`，之后 `{kind:"deltas"}`，
// 文本增长是 `row.delta`（append）。装配、CRC、schema 校验全部复用 shared-extract
// 的 wire-reassembly，不在本包重写。
import {
  applyConversationDelta,
  conversationTopicFrameSchema,
  reassembleTopicWireFrames,
  type ConversationDelta,
  type ConversationSnapshot,
  type ConversationTopicFrame,
} from "@nibi-go/shared-extract";

import type { KernelNotification } from "./protocol";
import { KERNEL_METHODS } from "./protocol";

/** 本包只用到 client 的订阅/通知面；测试里用假实现。 */
export interface ConversationFeedClient {
  subscribeConversation(
    sessionId: string,
    options?: { connectionId?: string; clientMode?: string },
  ): Promise<{ topic: string; connectionId: string }>;
  unsubscribeConversation(): Promise<void>;
  onNotification(listener: (notification: KernelNotification) => void): () => void;
}

interface WireLike {
  logicalFrameId?: unknown;
  kind?: unknown;
}

/**
 * 一帧 → 新快照（纯函数，便于单测）：
 * snapshot 帧整体替换；deltas 帧逐条 apply（`row.delta` 就是流式文本追加）。
 */
export function applyConversationFrame(
  current: ConversationSnapshot | null,
  frame: ConversationTopicFrame,
): ConversationSnapshot | null {
  const payload = frame.payload;
  if (payload.kind === "snapshot") {
    return payload.snapshot as ConversationSnapshot;
  }
  if (!current) return null; // 还没快照，增量无处可落。
  let next: ConversationSnapshot = current;
  for (const delta of payload.deltas as ConversationDelta[]) {
    next = applyConversationDelta(next, delta);
  }
  return next;
}

/**
 * 会话快照的实时容器：订阅一次，之后按帧增量维护 `snapshot`。
 * UI 直接读 `snapshot`（行模型在 rows.ts 里派生）。
 */
export class ConversationFeed {
  private readonly client: ConversationFeedClient;
  private readonly listeners = new Set<() => void>();
  private readonly offNotification: () => void;
  private readonly pendingWires = new Map<string, unknown[]>();
  private snapshotValue: ConversationSnapshot | null = null;
  private disposed = false;

  constructor(client: ConversationFeedClient) {
    this.client = client;
    this.offNotification = client.onNotification((notification) =>
      this.onNotification(notification),
    );
  }

  get snapshot(): ConversationSnapshot | null {
    return this.snapshotValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 订阅某个会话；首帧快照到达时 `snapshot` 就有了。 */
  async start(sessionId: string): Promise<void> {
    await this.client.subscribeConversation(sessionId);
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.offNotification();
    this.pendingWires.clear();
    this.listeners.clear();
    try {
      await this.client.unsubscribeConversation();
    } catch {
      // 连接已断开时取消订阅失败不影响本地状态。
    }
  }

  private onNotification(notification: KernelNotification): void {
    if (this.disposed) return;
    if (notification.method !== KERNEL_METHODS.conversationFrame) return;
    const wire = notification.params as WireLike;
    const id = typeof wire.logicalFrameId === "string" ? wire.logicalFrameId : "unknown";
    const buffered = this.pendingWires.get(id) ?? [];
    buffered.push(wire);
    this.pendingWires.set(id, buffered);

    const result = reassembleTopicWireFrames(
      buffered as never,
      conversationTopicFrameSchema as never,
    );
    if (result.kind === "incomplete") return; // 等其余分片。
    this.pendingWires.delete(id);
    if (result.kind === "rejected") {
      // 校验不过的帧不进状态；下一帧或重订阅会带回新快照。
      return;
    }
    this.apply(result.frame as unknown as ConversationTopicFrame);
  }

  private apply(frame: ConversationTopicFrame): void {
    const next = applyConversationFrame(this.snapshotValue, frame);
    if (!next) return;
    this.snapshotValue = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
