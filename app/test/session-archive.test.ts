// 会话归档的拆分规则（归档是 GO 本地状态，不写内核）。
import { describe, expect, it } from "vitest";
import type { KernelSessionSummary } from "@nibi-go/kernel-session";

import { splitSessions, formatBytes } from "../src/kernel/sessionArchive";

function session(id: string, title = id): KernelSessionSummary {
  return { sessionId: id, title } as KernelSessionSummary;
}

describe("splitSessions", () => {
  it("按归档集合拆成主列表与归档列表，保持传入顺序", () => {
    const all = [session("a"), session("b"), session("c")];
    const split = splitSessions(all, new Set(["b"]));
    expect(split.visible.map((s) => s.sessionId)).toEqual(["a", "c"]);
    expect(split.archived.map((s) => s.sessionId)).toEqual(["b"]);
  });

  it("空归档集合时全部可见", () => {
    const all = [session("a"), session("b")];
    const split = splitSessions(all, new Set());
    expect(split.visible).toHaveLength(2);
    expect(split.archived).toHaveLength(0);
  });

  it("归档集合里不存在的 id 被忽略", () => {
    const split = splitSessions([session("a")], new Set(["gone"]));
    expect(split.visible.map((s) => s.sessionId)).toEqual(["a"]);
    expect(split.archived).toHaveLength(0);
  });
});

describe("formatBytes", () => {
  it("按 1024 进位并保留一位小数", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe("3.5 GB");
  });
});
