import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ComposerCatalogItem } from "../src/composer/catalog";
import {
  groupMessageMenuItems,
  MESSAGE_POPUP_DIRECT_LIMIT,
  MESSAGE_POPUP_PINNED_COUNT,
  pluginSourceLabel,
  splitMessageMenuItems,
} from "../src/composer/messageMenu";

function makeAction(
  id: string,
  title: string,
  pluginId: string,
  pluginName?: string,
): ComposerCatalogItem {
  return {
    id: `message:${pluginId}:${id}`,
    group: "message",
    source: "plugin",
    title,
    detail: `${pluginName ?? pluginId} · 引用这条消息`,
    pluginId,
    ...(pluginName ? { pluginName } : {}),
    token: { kind: "command", value: `${pluginId}-${id}` },
  };
}

describe("splitMessageMenuItems", () => {
  it("动作数 ≤ 4 时全部直出且不折叠", () => {
    expect(splitMessageMenuItems([])).toEqual({
      direct: [],
      overflowCount: 0,
      hasOverflow: false,
    });

    const four = [
      makeAction("a1", "润色", "p1", "写作插件"),
      makeAction("a2", "缩写", "p1", "写作插件"),
      makeAction("a3", "提炼待办", "p1", "写作插件"),
      makeAction("a4", "转图表", "p2", "图表插件"),
    ];
    expect(four).toHaveLength(MESSAGE_POPUP_DIRECT_LIMIT);
    const res = splitMessageMenuItems(four);
    expect(res.hasOverflow).toBe(false);
    expect(res.overflowCount).toBe(0);
    expect(res.direct.map((item) => item.title)).toEqual(["润色", "缩写", "提炼待办", "转图表"]);
  });

  it("动作数 > 4 时浮层只直出前 3 项，其余收进更多抽屉", () => {
    const items = [
      makeAction("a1", "润色", "p1", "写作插件"),
      makeAction("a2", "缩写", "p1", "写作插件"),
      makeAction("a3", "转表格", "p2", "表格插件"),
      makeAction("a4", "转幻灯片", "p3", "PPT 插件"),
      makeAction("a5", "转 PDF", "p4", "PDF 插件"),
    ];
    const res = splitMessageMenuItems(items);
    expect(res.hasOverflow).toBe(true);
    expect(res.direct).toHaveLength(MESSAGE_POPUP_PINNED_COUNT);
    expect(res.direct.map((item) => item.title)).toEqual(["润色", "缩写", "转表格"]);
    expect(res.overflowCount).toBe(2);
  });
});

describe("groupMessageMenuItems & pluginSourceLabel", () => {
  it("按所属插件分组并保持用户配置的首见顺序，同时支持按动作名或插件名过滤", () => {
    const items = [
      makeAction("a1", "润色表达", "writer", "写作助手"),
      makeAction("b1", "生成图表", "viz", "图表与可视化"),
      makeAction("a2", "提炼待办", "writer", "写作助手"),
      makeAction("c1", "导出文档", "docx"),
    ];
    const names = new Map<string, string>([["docx", "Word 文档"]]);

    const grouped = groupMessageMenuItems(items, names);
    expect(grouped.map((g) => ({ title: g.groupTitle, count: g.items.length }))).toEqual([
      { title: "写作助手", count: 2 },
      { title: "图表与可视化", count: 1 },
      { title: "Word 文档", count: 1 },
    ]);

    expect(groupMessageMenuItems(items, names, "图表").map((g) => g.groupTitle)).toEqual([
      "图表与可视化",
    ]);
    expect(groupMessageMenuItems(items, names, "word").map((g) => g.groupTitle)).toEqual([
      "Word 文档",
    ]);
    expect(groupMessageMenuItems(items, names, "不存在的词")).toEqual([]);
  });

  it("pluginSourceLabel 依次回退 pluginName → map → detail → pluginId", () => {
    const names = new Map<string, string>([["p.map", "来自映射"]]);
    expect(pluginSourceLabel(makeAction("1", "动作", "p.direct", "显式名称"), names)).toBe(
      "显式名称",
    );
    expect(pluginSourceLabel(makeAction("1", "动作", "p.map"), names)).toBe("来自映射");
    expect(
      pluginSourceLabel({
        id: "m:1",
        group: "message",
        source: "plugin",
        title: "动作",
        detail: "详情前缀 · 引用这条消息",
        pluginId: "p.detail",
        token: { kind: "command", value: "cmd" },
      }),
    ).toBe("详情前缀");
  });
});

describe("首页长按消息菜单防回归接线", () => {
  it("首页消息浮层限制高度可滚动，并通过防键盘闪现导航跳转自定义设置", () => {
    const indexSrc = readFileSync(new URL("../src/app/index.tsx", import.meta.url), "utf8");
    expect(indexSrc).toContain("styles.msgCoreBar");
    expect(indexSrc).toContain("styles.msgPluginScroll");
    expect(indexSrc).toContain("messageMenuPartition.hasOverflow");
    expect(indexSrc).toContain("<MessageActionsSheet");
    expect(indexSrc).toContain('router.push("/settings/composer")');
  });
});
