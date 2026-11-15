// 会话归档的纯函数（无 IO，vitest 直接测）。
//
// 内核没有「归档」这个存储概念（`deleteSession` 只有软删除），所以归档是 GO 本地的会话管理
// 状态：一份会话 ID 集合，持久化在 App 私有目录（archiveStore.ts）。主列表隐藏归档会话，
// 归档管理里可恢复或删除。
import type { KernelSessionSummary } from "@nibi-go/kernel-session";

export interface SessionSplit {
  /** 主列表：未归档。 */
  visible: KernelSessionSummary[];
  /** 归档管理：已归档。 */
  archived: KernelSessionSummary[];
}

/** 按归档集合把会话拆成两份，保持传入顺序（调用方已按 updatedAt 排好）。 */
export function splitSessions(
  sessions: readonly KernelSessionSummary[],
  archivedIds: ReadonlySet<string>,
): SessionSplit {
  const visible: KernelSessionSummary[] = [];
  const archived: KernelSessionSummary[] = [];
  for (const session of sessions) {
    if (archivedIds.has(session.sessionId)) archived.push(session);
    else visible.push(session);
  }
  return { visible, archived };
}
