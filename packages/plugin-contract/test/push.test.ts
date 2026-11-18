import { describe, expect, it } from "vitest";

import { mergeSlotPush, readSlotPush, SLOT_PUSH_MAX_BYTES } from "../src";

describe("readSlotPush", () => {
  it("取出 _meta.nibiGo.push", () => {
    const result = readSlotPush({
      nibiGo: { push: { note: { label: "已检查 3 段" }, count: 3 } },
    });
    expect(result.issue).toBeUndefined();
    expect(result.push).toEqual({ note: { label: "已检查 3 段" }, count: 3 });
  });

  it("没有推送时安静地返回空（老工具结果不受影响）", () => {
    expect(readSlotPush({}).push).toBeUndefined();
    expect(readSlotPush({ nibiGo: { other: true } }).push).toBeUndefined();
    expect(readSlotPush(null).push).toBeUndefined();
    expect(readSlotPush("x").push).toBeUndefined();
  });

  it("不是对象的 push 与数组都拒绝", () => {
    expect(readSlotPush({ nibiGo: { push: ["x"] } }).push).toBeUndefined();
    expect(readSlotPush({ nibiGo: { push: 3 } }).push).toBeUndefined();
  });

  it("顶层键太多时整条拒绝并留原因", () => {
    const push = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`k${index}`, index]),
    );
    const result = readSlotPush({ nibiGo: { push } });
    expect(result.push).toBeUndefined();
    expect(result.issue).toContain("顶层键");
  });

  it("超过字节上限时整条拒绝", () => {
    const result = readSlotPush({
      nibiGo: { push: { note: "x".repeat(SLOT_PUSH_MAX_BYTES) } },
    });
    expect(result.push).toBeUndefined();
    expect(result.issue).toContain("字节");
  });
});

describe("mergeSlotPush", () => {
  it("同一轮里后到的工具结果覆盖同名键", () => {
    expect(mergeSlotPush({ note: { label: "旧" }, keep: 1 }, { note: { label: "新" } })).toEqual({
      note: { label: "新" },
      keep: 1,
    });
  });

  it("第一次没有旧值时直接用新值", () => {
    expect(mergeSlotPush(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});