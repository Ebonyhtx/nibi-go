// chat-core 状态容器：包装抽取件的 applyConversationDelta（协议语义的规范实现）。
// 宿主化改写不得引入额外分支（apply.ts 文件头约定）——本容器只负责持有快照与通知订阅者。
import {
  applyConversationDelta,
  applyConversationDeltas,
  type ConversationDelta,
  type ConversationSnapshot,
} from "@nibi-go/shared-extract";

export class ConversationStore {
  private current: ConversationSnapshot | null = null;
  private readonly listeners = new Set<() => void>();

  get snapshot(): ConversationSnapshot | null {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** 冷恢复/重连：整体替换快照（对齐水位由快照自带 seq/revision）。 */
  replaceSnapshot(snapshot: ConversationSnapshot): void {
    this.current = snapshot;
    this.emit();
  }

  /** 应用单条 delta；无快照时返回 false（调用方应先取得 snapshot）。 */
  applyDelta(delta: ConversationDelta): boolean {
    if (!this.current) return false;
    this.current = applyConversationDelta(this.current, delta);
    this.emit();
    return true;
  }

  applyDeltas(deltas: readonly ConversationDelta[]): boolean {
    if (!this.current) return false;
    this.current = applyConversationDeltas(this.current, deltas);
    this.emit();
    return true;
  }
}
