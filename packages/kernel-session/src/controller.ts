// 会话界面的行状态容器：订阅 V4 快照，派生 UI 行与 turn 状态。
//
// 与 dsh-Go 的 chat_state/deriveRows 同构：状态只有一份（快照），行是派生结果；
// 行主键稳定，流式文本靠 `row.delta` 追加，UI 不需要自己拼增量。
import type { ConversationSnapshot } from "@nibi-go/shared-extract";

import type { ConversationFeed } from "./feed";
import { deriveRows, type ChatRow } from "./rows";

/** 控制器只依赖“有快照、能订阅”这一面；测试里用假实现。 */
export interface ConversationSource {
  readonly snapshot: ConversationSnapshot | null;
  subscribe(listener: () => void): () => void;
}

export type TurnState = "idle" | "running";

function snapshotRunning(snapshot: ConversationSnapshot | null): boolean {
  if (!snapshot) return false;
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

export class ConversationController {
  private readonly source: ConversationSource;
  private readonly listeners = new Set<() => void>();
  private readonly offSource: () => void;
  private rowsValue: ChatRow[] = [];
  private turnValue: TurnState = "idle";

  constructor(source: ConversationSource | ConversationFeed) {
    this.source = source;
    this.offSource = source.subscribe(() => this.recompute());
    this.recompute();
  }

  get rows(): readonly ChatRow[] {
    return this.rowsValue;
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
    this.rowsValue = deriveRows(snapshot);
    this.turnValue = snapshotRunning(snapshot) ? "running" : "idle";
    for (const listener of this.listeners) listener();
  }
}
