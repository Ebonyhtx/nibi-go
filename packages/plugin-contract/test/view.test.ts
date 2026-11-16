import { describe, expect, it } from "vitest";

import {
  resolveText,
  resolveView,
  readView,
  utf8Length,
  type SlotData,
  type ViewNode,
} from "../src";

const data: SlotData = {
  data: {
    host: { appVersion: "0.1.0", model: "mock-model" },
    tool: { structured: { city: "北京", temperature: 24 } },
  },
};

describe("readView", () => {
  it("保留合法组件并算出预算计数", () => {
    const result = readView(
      {
        type: "card",
        title: { $: "data.tool.structured.city" },
        children: [
          { type: "text", text: "晴", style: "title" },
          { type: "badge", text: { $: "data.tool.structured.temperature" }, tone: "brand" },
        ],
      },
      "toolCard",
    );
    expect(result.view).not.toBeNull();
    expect(result.issues).toEqual([]);
    expect(result.nodes).toBe(3);
    expect(result.depth).toBe(2);
  });

  it("未知组件降级为文字并标记 degraded", () => {
    const result = readView(
      { type: "column", children: [{ type: "chart", data: [1, 2, 3] }] },
      "panel",
    );
    expect(result.degraded).toBe(true);
    expect(JSON.stringify(result.view)).toContain("不支持的组件: chart");
    expect(result.issues.some((issue) => issue.message.includes("chart"))).toBe(true);
  });

  it("v2 tabs 摊平成 v1 列", () => {
    const result = readView(
      {
        type: "tabs",
        tabs: [
          { label: "概览", children: [{ type: "text", text: "第一页" }] },
          { label: "详情", children: [{ type: "text", text: "第二页" }] },
        ],
      },
      "panel",
    );
    expect(result.degraded).toBe(true);
    const text = JSON.stringify(result.view);
    expect(text).toContain("概览");
    expect(text).toContain("第一页");
    expect(text).toContain("第二页");
  });

  it("tabs 展开按父节点深度算，不把后面的 tab 误判为过深", () => {
    const tab = (label: string) => ({
      label,
      children: [
        {
          type: "row",
          children: [{ type: "text", text: `${label}内容` }],
        },
      ],
    });
    const result = readView(
      { type: "tabs", tabs: [tab("一"), tab("二"), tab("三"), tab("四")] },
      "panel",
    );
    expect(result.view).not.toBeNull();
    expect(result.issues.some((issue) => issue.message.includes("层级"))).toBe(false);
  });

  it("节点预算超了整条视图不渲染", () => {
    // column 自身限制 12 个子节点，但每个子节点还能再带 4 个孙节点，总数会超过工具卡 40。
    const children = Array.from({ length: 12 }, () => ({
      type: "column",
      children: Array.from({ length: 4 }, (_, index) => ({ type: "text", text: `行 ${index}` })),
    }));
    const result = readView({ type: "column", children }, "toolCard");
    expect(result.view).toBeNull();
    expect(result.issues.some((issue) => issue.message.includes("节点超过预算"))).toBe(true);
  });

  it("字节预算超了整条视图不渲染", () => {
    const children = Array.from({ length: 20 }, () => ({
      type: "text",
      // 每个 1000 字：20 个就超过工具卡 8KiB。
      text: "字".repeat(1_000),
    }));
    const result = readView({ type: "column", children }, "toolCard");
    expect(result.view).toBeNull();
    expect(result.issues.some((issue) => issue.message.includes("字节"))).toBe(true);
  });

  it("拒绝非对象/缺 type", () => {
    expect(readView("nope", "panel").view).toBeNull();
    expect(readView({ text: "x" }, "panel").view).toBeNull();
  });

  it("utf8Length 按 UTF-8 字节计数", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("中文")).toBe(6);
    expect(utf8Length("🦉")).toBe(4);
  });
});

describe("resolveView", () => {
  it("求值绑定与字面量插值", () => {
    const view: ViewNode = {
      type: "column",
      children: [
        { type: "text", text: { $: "data.host.model" } },
        { type: "text", text: "版本 {{data.host.appVersion}}" },
      ],
    };
    const rendered = resolveView(view, data);
    expect(rendered.type).toBe("column");
    if (rendered.type !== "column") return;
    expect(rendered.children[0]).toMatchObject({ text: "mock-model" });
    expect(rendered.children[1]).toMatchObject({ text: "版本 0.1.0" });
  });

  it("缺值求成空字符串，不抛错", () => {
    expect(resolveText({ $: "data.host.missing.deep" }, data)).toBe("");
    expect(resolveText("前缀 {{data.nope}}", data)).toBe("前缀 ");
  });

  it("list 绑定到数组并裁到 20 项", () => {
    const view: ViewNode = {
      type: "list",
      items: { $: "data.rows" },
    };
    const rendered = resolveView(view, { data: { rows: Array.from({ length: 30 }, (_, i) => `r${i}`) } });
    expect(rendered.type).toBe("list");
    if (rendered.type !== "list") return;
    expect(rendered.items).toHaveLength(20);
    expect(rendered.items[0]).toEqual({ label: "r0" });
  });

  it("progress 绑定夹到 0-100", () => {
    const low = resolveView({ type: "progress", value: { $: "data.pct" } }, { data: { pct: -5 } });
    const high = resolveView({ type: "progress", value: { $: "data.pct" } }, { data: { pct: 140 } });
    expect(low).toMatchObject({ value: 0 });
    expect(high).toMatchObject({ value: 100 });
  });
});