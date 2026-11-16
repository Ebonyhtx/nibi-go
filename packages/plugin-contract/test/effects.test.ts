import { describe, expect, it } from "vitest";

import { readEffects } from "../src";

describe("readEffects", () => {
  it("接受白名单内的效果", () => {
    const { effects, issues } = readEffects(
      [
        { kind: "insert", text: "继续" },
        { kind: "toast", text: "好了" },
        { kind: "open", panel: "status" },
        { kind: "refresh" },
      ],
      "/effects",
    );
    expect(issues).toEqual([]);
    expect(effects.map((effect) => effect.kind)).toEqual(["insert", "toast", "open", "refresh"]);
  });

  it("超过 4 个只保留前 4 个", () => {
    const { effects, issues } = readEffects(
      Array.from({ length: 6 }, () => ({ kind: "toast", text: "x" })),
      "/effects",
    );
    expect(effects).toHaveLength(4);
    expect(issues.some((issue) => issue.message.includes("最多 4 个"))).toBe(true);
  });

  it("坏的一条只丢这一条", () => {
    const { effects, issues } = readEffects(
      [
        { kind: "insert", text: "" },
        { kind: "toast", text: "好的" },
        { kind: "unknown" },
      ],
      "/effects",
    );
    expect(effects).toEqual([{ kind: "toast", text: "好的" }]);
    expect(issues).toHaveLength(2);
  });

  it("link 只收无凭据 https", () => {
    const { effects } = readEffects(
      [
        { kind: "link", url: "http://example.com" },
        { kind: "link", url: "https://user:pass@example.com" },
        { kind: "link", url: "https://example.com/help" },
      ],
      "/effects",
    );
    expect(effects).toEqual([{ kind: "link", url: "https://example.com/help" }]);
  });

  it("command 不能叫 permission", () => {
    const { effects } = readEffects(
      [
        { kind: "command", name: "permission" },
        { kind: "command", name: "insert" },
      ],
      "/effects",
    );
    expect(effects).toEqual([{ kind: "command", name: "insert" }]);
  });

  it("非数组输入不抛错", () => {
    expect(readEffects("oops", "/effects").effects).toEqual([]);
    expect(readEffects(null, "/effects").effects).toEqual([]);
  });
});