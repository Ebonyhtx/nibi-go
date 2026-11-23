// 抽屉会话列表的分组与搜索（对齐 dsh-Go drawer_view_state.dart 的日历分组）。
//
// 分组按本地日历日算：今天 / 昨天 / 本周（周一起）/ 更早；跨 DST 用 UTC 固定日轴，
// 避免“昨天”因夏令时 23/25 小时偏移被判错。列表进入分组前已按 updatedAt 倒序。
import type { KernelSessionSummary } from "@nibi-go/kernel-session";

import { pickText } from "../i18n";

export type SessionDay = "today" | "yesterday" | "thisWeek" | "earlier";

export const SESSION_DAY_LABELS: Record<SessionDay, string> = {
  get today() {
    return pickText("今天", "Today");
  },
  get yesterday() {
    return pickText("昨天", "Yesterday");
  },
  get thisWeek() {
    return pickText("本周", "This week");
  },
  get earlier() {
    return pickText("更早", "Earlier");
  },
};

export interface SessionGroup {
  day: SessionDay;
  label: string;
  items: KernelSessionSummary[];
}

function sessionTime(session: KernelSessionSummary): number {
  return session.updatedAt ?? session.createdAt ?? 0;
}

/** 一条会话属于哪个日历分组。`ms <= 0`（没有时间）归“更早”。 */
export function sessionDayOf(ms: number, now: Date): SessionDay {
  if (!Number.isFinite(ms) || ms <= 0) return "earlier";
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(ms);
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((today - day) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  // 周一为一周之始：getUTCDay() 里周日是 0，转成 Mon=0..Sun=6。
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - sinceMonday * 86_400_000;
  return day >= monday ? "thisWeek" : "earlier";
}

/** 按日历分组；组顺序固定（今天→更早），组内保留传入顺序。 */
export function groupSessionsByDay(
  sessions: readonly KernelSessionSummary[],
  now: Date = new Date(),
): SessionGroup[] {
  const buckets = new Map<SessionDay, KernelSessionSummary[]>();
  for (const session of sessions) {
    const day = sessionDayOf(sessionTime(session), now);
    const bucket = buckets.get(day);
    if (bucket) bucket.push(session);
    else buckets.set(day, [session]);
  }
  return (Object.keys(SESSION_DAY_LABELS) as SessionDay[])
    .filter((day) => (buckets.get(day)?.length ?? 0) > 0)
    .map((day) => ({
      day,
      label: SESSION_DAY_LABELS[day],
      items: buckets.get(day) ?? [],
    }));
}

/** 标题搜索：大小写不敏感；空标题按显示出来的“新对话”参与匹配。 */
export function filterSessionsByTitle(
  sessions: readonly KernelSessionSummary[],
  query: string,
): KernelSessionSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [...sessions];
  const fallbackTitle = pickText("新对话", "New chat");
  return sessions.filter((session) =>
    (session.title || fallbackTitle).toLocaleLowerCase().includes(needle),
  );
}
