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
  ): Promise<{ topic: string; connectionId: string; subscriptionId: string | null }>;
  unsubscribeConversation(): Promise<void>;
  /** 只读管道订阅（面板里看子会话消息流）：独立 connectionId，不占主订阅槽。 */
  subscribeReadOnly?(sessionId: string): Promise<{ topic: string; connectionId: string }>;
  unsubscribeReadOnly?(sessionId: string): Promise<void>;
  /** 对账：base 有效则续传缺失增量，force 一律重发快照（帧丢失后的恢复路径）。 */
  resyncConversation(force?: boolean): Promise<void>;
  onNotification(listener: (notification: KernelNotification) => void): () => void;
}

interface WireLike {
  logicalFrameId?: unknown;
  kind?: unknown;
  /** 帧信封自带 topic（`conversation/<sessionId>`）：多订阅时按它路由。 */
  topic?: unknown;
}

/**
 * 逻辑帧的分片等待窗口：超过就算分片丢失，清缓冲并对账重取快照。
 * 增量帧是毫秒级的，10s 还没凑齐基本只剩「分片在传输里丢了」。
 */
const REASSEMBLE_STALE_MS = 10_000;

/**
 * 插件槽的实时数据：serverName → slotId → 槽数据（`pluginSlot.data` 推送的当前值）。
 *
 * 推送是 live-only：只在当前订阅代际里有效，快照到达即清空，不参与冷恢复。
 */
export type PluginSlotData = Record<string, Record<string, Record<string, unknown>>>;

/**
 * 一帧 → 新快照（纯函数，便于单测）：
 * snapshot 帧整体替换；deltas 帧逐条 apply（`row.delta` 就是流式文本追加）。
 *
 * 调用方必须先滤掉 `pluginSlot.data`：它不是快照状态。协议侧若尚未认识这个 op，
 * 未知 op 会落到 `applyConversationDelta` 的 switch 之外返回 undefined，
 * 进而把整个快照变成 undefined。
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
  /** 每个 incomplete 逻辑帧的首次见到时刻：超过窗口还没凑齐就视为分片丢失。 */
  private readonly pendingSince = new Map<string, number>();
  private snapshotValue: ConversationSnapshot | null = null;
  private pluginSlotsValue: PluginSlotData = {};
  private disposed = false;
  private sessionId: string | null = null;
  /** 只读订阅模式（子会话消息流）：start 走 readOnly 通道、stop 定向取消。 */
  private readOnly = false;
  /** 最后一次成功 apply 的帧时间：运行中的看门狗用它判「流是否还在动」。 */
  private lastAppliedAt: number | null = null;
  private resyncing = false;

  constructor(client: ConversationFeedClient) {
    this.client = client;
    this.offNotification = client.onNotification((notification) =>
      this.onNotification(notification),
    );
  }

  get snapshot(): ConversationSnapshot | null {
    return this.snapshotValue;
  }

  /** 插件主动推的槽数据；快照帧会把它清空（live-only）。 */
  get pluginSlots(): PluginSlotData {
    return this.pluginSlotsValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 订阅某个会话；首帧快照到达时 `snapshot` 就有了。
   * readOnly：给面板里的子会话消息流用——独立 connectionId，不动主订阅槽。 */
  async start(sessionId: string, options?: { readOnly?: boolean }): Promise<void> {
    this.sessionId = sessionId;
    this.lastAppliedAt = null;
    this.readOnly = options?.readOnly === true;
    if (this.readOnly && this.client.subscribeReadOnly) {
      await this.client.subscribeReadOnly(sessionId);
      return;
    }
    this.readOnly = false;
    await this.client.subscribeConversation(sessionId);
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.offNotification();
    this.pendingWires.clear();
    this.pendingSince.clear();
    this.listeners.clear();
    try {
      if (this.readOnly && this.sessionId && this.client.unsubscribeReadOnly) {
        await this.client.unsubscribeReadOnly(this.sessionId);
      } else {
        await this.client.unsubscribeConversation();
      }
    } catch {
      // 连接已断开时取消订阅失败不影响本地状态。
    }
  }

  /** 快照是否已经太久没有新帧（running 看门狗用；从未收到过帧也算陈旧）。 */
  staleMs(): number | null {
    if (this.disposed || this.lastAppliedAt === null) return null;
    return Date.now() - this.lastAppliedAt;
  }

  /**
   * 对账：强制让内核重发一帧快照。增量帧丢失后客户端的行状态会永久落后
   * （行卡在 streaming/pendingApproval → 停止键卡死），快照重放即自愈。
   */
  async resync(force = true): Promise<void> {
    if (this.disposed || this.resyncing || !this.sessionId) return;
    this.resyncing = true;
    try {
      await this.client.resyncConversation(force);
    } catch {
      // 对账失败不致命：下一帧或下一次看门狗再试。
    } finally {
      this.resyncing = false;
    }
  }

  private onNotification(notification: KernelNotification): void {
    if (this.disposed) return;
    if (notification.method !== KERNEL_METHODS.conversationFrame) return;
    const wire = notification.params as WireLike;
    // 多订阅（主会话 + 面板里的只读子会话）时按 topic 路由：没有这层过滤，
    // 子会话的帧会混进主会话的重组器把行状态污染掉。
    if (
      this.sessionId !== null &&
      typeof wire.topic === "string" &&
      wire.topic !== `conversation/${this.sessionId}`
    ) {
      return;
    }
    const id = typeof wire.logicalFrameId === "string" ? wire.logicalFrameId : "unknown";
    const buffered = this.pendingWires.get(id) ?? [];
    buffered.push(wire);
    if (!this.pendingSince.has(id)) this.pendingSince.set(id, Date.now());
    this.pendingWires.set(id, buffered);

    const result = reassembleTopicWireFrames(
      buffered as never,
      conversationTopicFrameSchema as never,
    );
    if (result.kind === "incomplete") {
      this.checkPendingStale();
      return; // 等其余分片。
    }
    this.pendingWires.delete(id);
    this.pendingSince.delete(id);
    if (result.kind === "rejected") {
      // 校验不过的帧不进状态：这里的旧实现只等「下一帧」——丢一个带行状态迁移的分片
      // 行就永久卡在旧状态（停止键卡死的真因）。现在立刻对账重取快照。
      void this.resync(true);
      return;
    }
    this.apply(result.frame as unknown as ConversationTopicFrame);
    this.checkPendingStale();
  }

  /** 有分片超过 REASSEMBLE_STALE_MS 还没凑齐：视为传输丢失，清掉并对账。 */
  private checkPendingStale(): void {
    if (this.pendingWires.size === 0) return;
    const now = Date.now();
    let stale = false;
    for (const [id, since] of this.pendingSince) {
      if (now - since > REASSEMBLE_STALE_MS) {
        this.pendingWires.delete(id);
        this.pendingSince.delete(id);
        stale = true;
      }
    }
    if (stale) void this.resync(true);
  }

  private apply(frame: ConversationTopicFrame): void {
    this.lastAppliedAt = Date.now();
    const payload = frame.payload;
    if (payload.kind === "snapshot") {
      // 槽推送是 live-only：冷开/重订阅的快照不能把上一代际的推送复活。
      this.pluginSlotsValue = {};
      this.snapshotValue = payload.snapshot as ConversationSnapshot;
      this.emit();
      return;
    }

    // `pluginSlot.data` 不属于会话快照：先收集到 pluginSlots，再把它从快照增量里滤掉。
    // （shared-extract 已把它注册成 no-op；滤掉是为了让 live-only 推送不参与快照归约。）
    const deltas = payload.deltas as ConversationDelta[];
    const slotsChanged = this.applyPluginSlotDeltas(deltas);
    const conversationDeltas = deltas.filter((delta) => delta.op !== "pluginSlot.data");
    const next = applyConversationFrame(this.snapshotValue, {
      ...frame,
      payload: { kind: "deltas", deltas: conversationDeltas },
    });
    if (next) this.snapshotValue = next;
    // 纯槽帧也要通知订阅者；没有快照且只有被丢弃的增量时保持安静。
    if (next || slotsChanged) this.emit();
  }

  /** 把一帧里的槽推送合并进 map；同一 server/slot 的后到值覆盖先到的。 */
  private applyPluginSlotDeltas(deltas: readonly ConversationDelta[]): boolean {
    let changed = false;
    for (const delta of deltas) {
      if (delta.op !== "pluginSlot.data") continue;
      this.pluginSlotsValue = {
        ...this.pluginSlotsValue,
        [delta.serverName]: {
          ...(this.pluginSlotsValue[delta.serverName] ?? {}),
          [delta.slot]: delta.data,
        },
      };
      changed = true;
    }
    return changed;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
