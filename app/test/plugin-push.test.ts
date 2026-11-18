import { describe, expect, it } from "vitest";

import type { ChatRow, ChatToolRow } from "@nibi-go/kernel-session";
import { collectTurnPushes } from "../src/plugins/push";

function tool(
  key: string,
  meta: unknown,
  pluginId = "nibigo-weather",
): ChatToolRow {
  return {
    kind: "tool",
    key,
    name: "weather_get",
    status: "completed",
    display: {
      kind: "mcp_tool",
      ui: {
        pluginId,
        ...(meta === undefined ? {} : { widgetMeta: JSON.stringify(meta) }),
      },
    },
  };
}

function turn(key: string): ChatRow {
  return { kind: "turn", key, rowId: 1, state: "completedSuccess", toolCalls: 1 };
}

const push = (label: string) => ({ nibiGo: { push: { note: { label } } } });

describe("collectTurnPushes", () => {
  it("把工具结果里的推送挂到这一轮的 turn 行上", () => {
    const turns = collectTurnPushes([tool("t1", push("北京 晴")), turn("turn1")]);
    expect(turns.get("turn1")?.get("nibigo-weather")).toEqual({ note: { label: "北京 晴" } });
  });

  it("同一轮里后到的工具结果覆盖同名键", () => {
    const turns = collectTurnPushes([
      tool("t1", push("第一次")),
      tool("t2", push("第二次")),
      turn("turn1"),
    ]);
    expect(turns.get("turn1")?.get("nibigo-weather")).toEqual({ note: { label: "第二次" } });
  });

  it("上一轮的推送不会漏到下一轮", () => {
    const turns = collectTurnPushes([
      tool("t1", push("上一轮")),
      turn("turn1"),
      turn("turn2"),
    ]);
    expect(turns.get("turn1")?.get("nibigo-weather")).toEqual({ note: { label: "上一轮" } });
    expect(turns.has("turn2")).toBe(false);
  });

  it("toolGroup 与 process 里的工具行也算", () => {
    const grouped: ChatRow = {
      kind: "toolGroup",
      key: "g1",
      running: false,
      tools: [tool("t1", push("组内"))],
    };
    const process: ChatRow = {
      kind: "process",
      key: "p1",
      toolCalls: 1,
      messages: 0,
      rows: [tool("t2", push("过程内"))],
    };
    const turns = collectTurnPushes([grouped, process, turn("turn1")]);
    expect(turns.get("turn1")?.get("nibigo-weather")).toEqual({ note: { label: "过程内" } });
  });

  it("坏 JSON 与没有推送的工具结果都不影响其它推送", () => {
    const broken: ChatToolRow = {
      ...tool("t0", undefined),
      display: { kind: "mcp_tool", ui: { pluginId: "nibigo-weather", widgetMeta: "{" } },
    };
    const other = tool("t9", { nibiGo: { push: { note: { label: "好的" } } } }, "nibigo-quick");
    const turns = collectTurnPushes([broken, other, turn("turn1")]);
    expect(turns.get("turn1")?.get("nibigo-weather")).toBeUndefined();
    expect(turns.get("turn1")?.get("nibigo-quick")).toEqual({ note: { label: "好的" } });
  });
});