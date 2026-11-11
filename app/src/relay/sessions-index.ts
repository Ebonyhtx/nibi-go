// sessions-index 帧应用（纯函数，Node 可测）。
import type { SessionSummary, SessionsIndexTopicFrame } from "@nibi-go/shared-extract";

/** 快照整体替换；增量按 sessionId upsert/remove（列表排序由 UI 负责）。 */
export function applySessionsFrame(
  current: SessionSummary[],
  frame: SessionsIndexTopicFrame,
): SessionSummary[] {
  if (frame.payload.kind === "snapshot") return frame.payload.snapshot.sessions;
  let next = current;
  for (const delta of frame.payload.deltas) {
    if (delta.op === "session.upserted") {
      const exists = next.some((s) => s.sessionId === delta.session.sessionId);
      next = exists
        ? next.map((s) => (s.sessionId === delta.session.sessionId ? delta.session : s))
        : [...next, delta.session];
    } else {
      next = next.filter((s) => s.sessionId !== delta.sessionId);
    }
  }
  return next;
}
