// 抽屉会话列表的日历分组与标题搜索。
// 规则来源 dsh-Go app/lib/state/drawer_view_state.dart：今天 / 昨天 / 本周（周一起）/ 更早。
import { describe, expect, it } from "vitest";
import type { KernelSessionSummary } from "@nibi-go/kernel-session";

import {
  filterSessionsByTitle,
  groupSessionsByDay,
  sessionDayOf,
} from "../src/components/sessionGroups";

// 2026-11-15 是周日；本周一 = 11-09。
const now = new Date(2026, 10, 15, 12, 0, 0);

function session(overrides: Partial<KernelSessionSummary>): KernelSessionSummary {
  return {
    sessionId: overrides.sessionId ?? "s",
    title: overrides.title ?? "",
    ...overrides,
  } as KernelSessionSummary;
}

describe("sessionDayOf", () => {
  it("今天 / 昨天 / 本周 / 更早按本地日历切", () => {
    expect(sessionDayOf(new Date(2026, 10, 15, 0, 5).getTime(), now)).toBe("today");
    expect(sessionDayOf(new Date(2026, 10, 14, 23, 59).getTime(), now)).toBe("yesterday");
    expect(sessionDayOf(new Date(2026, 10, 9, 9, 0).getTime(), now)).toBe("thisWeek");
    expect(sessionDayOf(new Date(2026, 10, 8, 23, 0).getTime(), now)).toBe("earlier");
  });

  it("未来时间算今天，没有时间算更早", () => {
    expect(sessionDayOf(new Date(2026, 10, 16, 8, 0).getTime(), now)).toBe("today");
    expect(sessionDayOf(0, now)).toBe("earlier");
  });
});

describe("groupSessionsByDay", () => {
  it("组顺序固定，组内保留传入顺序", () => {
    const groups = groupSessionsByDay(
      [
        session({ sessionId: "a", title: "今天 A", updatedAt: new Date(2026, 10, 15, 9, 0).getTime() }),
        session({ sessionId: "b", title: "今天 B", updatedAt: new Date(2026, 10, 15, 8, 0).getTime() }),
        session({ sessionId: "c", title: "昨天", updatedAt: new Date(2026, 10, 14, 9, 0).getTime() }),
        session({ sessionId: "d", title: "本周", updatedAt: new Date(2026, 10, 10, 9, 0).getTime() }),
        session({ sessionId: "e", title: "更早", updatedAt: new Date(2026, 10, 1, 9, 0).getTime() }),
      ],
      now,
    );

    expect(groups.map((group) => group.day)).toEqual([
      "today",
      "yesterday",
      "thisWeek",
      "earlier",
    ]);
    expect(groups[0]?.items.map((item) => item.sessionId)).toEqual(["a", "b"]);
    expect(groups[0]?.label).toBe("今天");
  });

  it("空列表没有分组", () => {
    expect(groupSessionsByDay([], now)).toEqual([]);
  });
});

describe("filterSessionsByTitle", () => {
  const sessions = [
    session({ sessionId: "1", title: "Hello World" }),
    session({ sessionId: "2", title: "" }),
    session({ sessionId: "3", title: "预算表" }),
  ];

  it("大小写不敏感，空标题按“新对话”匹配", () => {
    expect(filterSessionsByTitle(sessions, "hello").map((item) => item.sessionId)).toEqual(["1"]);
    expect(filterSessionsByTitle(sessions, "新对话").map((item) => item.sessionId)).toEqual(["2"]);
    expect(filterSessionsByTitle(sessions, "预算").map((item) => item.sessionId)).toEqual(["3"]);
  });

  it("空查询返回原列表，未命中返回空", () => {
    expect(filterSessionsByTitle(sessions, "   ")).toHaveLength(3);
    expect(filterSessionsByTitle(sessions, "找不到")).toEqual([]);
  });
});
