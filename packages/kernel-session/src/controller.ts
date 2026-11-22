// 会话界面的行状态容器：订阅 V4 快照，派生 UI 行与 turn 状态。
//
// 与 dsh-Go 的 chat_state/deriveRows 同构：状态只有一份（快照），行是派生结果；
// 行主键稳定，流式文本靠 `row.delta` 追加，UI 不需要自己拼增量。
import type { ConversationSnapshot } from "@nibi-go/shared-extract";

import type { ConversationFeed, PluginSlotData } from "./feed";
import { deriveRows, type ChatRow, type PendingPrompt } from "./rows";

/** 控制器只依赖“有快照、能订阅”这一面；测试里用假实现。 */
export interface ConversationSource {
  readonly snapshot: ConversationSnapshot | null;
  /** 插件槽实时数据（可选：没有实时订阅面的实现不需要提供）。 */
  readonly pluginSlots?: PluginSlotData;
  subscribe(listener: () => void): () => void;
}

const EMPTY_PLUGIN_SLOTS: PluginSlotData = {};

export type TurnState = "idle" | "running";

function snapshotRunning(snapshot: ConversationSnapshot | null): boolean {
  if (!snapshot) return false;
  // 内核投影的 control.phase 是权威状态机（running / prewarming vs completedSuccess /
  // completedInterrupted / error / draft）；优先认它，避免任何孤立行把停止键永久卡住。
  const phase = snapshot.control?.phase;
  if (typeof phase === "string") {
    return phase === "running" || phase === "prewarming";
  }
  return snapshot.rows.window.some((row) => {
    if (row.kind === "assistantText" || row.kind === "reasoning") {
      return row.state === "streaming";
    }
    if (row.kind === "toolCall") {
      return (
        row.status === "running" ||
        row.status === "inputStreaming" ||
        row.status === "pendingApproval"
      );
    }
    return false;
  });
}

/** 深比较小型纯 JSON 派生行：流式期间历史行未变时复用旧引用，避免整表 O(N) 重渲染。 */
function sameRowValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!sameRowValue(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object") {
    if (Array.isArray(b)) return false;
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
      if (!sameRowValue(objA[key], objB[key])) return false;
    }
    return true;
  }
  return false;
}

function stabilizeRows(previous: readonly ChatRow[], next: ChatRow[]): ChatRow[] {
  if (previous.length === 0 || next.length === 0) return next;
  const byKey = new Map<string, ChatRow>();
  for (const row of previous) byKey.set(row.key, row);
  let reused = false;
  const stabilized = next.map((row) => {
    const prior = byKey.get(row.key);
    if (prior && sameRowValue(prior, row)) {
      reused = true;
      return prior;
    }
    return row;
  });
  return reused ? stabilized : next;
}

export class ConversationController {
  private readonly source: ConversationSource;
  private readonly listeners = new Set<() => void>();
  private readonly offSource: () => void;
  private rowsValue: ChatRow[] = [];
  private turnValue: TurnState = "idle";
  private pendingValue: PendingPrompt[] = [];

  constructor(source: ConversationSource | ConversationFeed) {
    this.source = source;
    this.offSource = source.subscribe(() => this.recompute());
    this.recompute();
  }

  get rows(): readonly ChatRow[] {
    return this.rowsValue;
  }

  /** 当前快照（hook 用它判断乐观气泡是否已被内核回显）。 */
  get snapshot(): ConversationSnapshot | null {
    return this.source.snapshot;
  }

  /** 插件槽实时数据（serverName → slotId → data）；源没有这一面时为空。 */
  get pluginSlots(): PluginSlotData {
    return this.source.pluginSlots ?? EMPTY_PLUGIN_SLOTS;
  }

  /** 本机已发出、还没回显的提示（dsh-Go PendingRow）。 */
  setPending(pending: readonly PendingPrompt[]): void {
    this.pendingValue = [...pending];
    this.recompute();
  }

  get turn(): TurnState {
    return this.turnValue;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.offSource();
    this.listeners.clear();
  }

  private recompute(): void {
    const snapshot = this.source.snapshot;
    this.rowsValue = stabilizeRows(this.rowsValue, deriveRows(snapshot, this.pendingValue));
    this.turnValue = snapshotRunning(snapshot) ? "running" : "idle";
    for (const listener of this.listeners) listener();
  }
}
