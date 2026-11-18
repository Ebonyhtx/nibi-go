// 一轮里插件推到槽的数据（`data.push`）：从工具结果的 `_meta.nibiGo.push` 收集。
//
// 为什么按轮收集：`turn.note` 是“这一轮插件做了什么”的脚注，同一轮里后到的工具结果覆盖
// 同名键；上一个回合的推送不会漏到下一个回合。数据来自已落库的工具结果，重启后照样能算出来。

import { mergeSlotPush, readSlotPush } from "@nibi-go/plugin-contract";
import type { ChatRow, ChatToolRow } from "@nibi-go/kernel-session";

type Pushes = Map<string, Record<string, unknown>>;

function addTool(tool: ChatToolRow, into: Pushes): void {
  const pluginId = tool.display?.ui?.pluginId;
  const meta = tool.display?.ui?.widgetMeta;
  if (!pluginId || !meta) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(meta);
  } catch {
    return;
  }
  const { push } = readSlotPush(parsed);
  if (!push) return;
  into.set(pluginId, mergeSlotPush(into.get(pluginId), push));
}

function addRow(row: ChatRow, into: Pushes): void {
  switch (row.kind) {
    case "tool":
      addTool(row, into);
      return;
    case "toolGroup":
      for (const tool of row.tools) addTool(tool, into);
      return;
    case "process":
      for (const inner of row.rows) addRow(inner, into);
      return;
    default:
      return;
  }
}

/**
 * 每一轮（`turn` 行的 key）里各插件推给槽的数据，键是 MCP 服务器名（`display.ui.pluginId`）。
 * 没有推送的轮次不出现在结果里；没有 `turn` 行收尾的尾部推送也不返回（没有可显示的脚注）。
 */
export function collectTurnPushes(
  rows: readonly ChatRow[],
): Map<string, Map<string, Record<string, unknown>>> {
  const turns = new Map<string, Map<string, Record<string, unknown>>>();
  let current: Pushes = new Map();
  for (const row of rows) {
    if (row.kind === "turn") {
      if (current.size > 0) turns.set(row.key, new Map(current));
      current = new Map();
      continue;
    }
    addRow(row, current);
  }
  return turns;
}