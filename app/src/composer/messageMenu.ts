// 长按消息菜单的分层收敛逻辑（纯 TS，Node 可单测）：
//
// 当用户安装大量带 `message.actions` 的插件时，长按浮层不能无限拉高：
// - ≤ 4 项：全部在浮层直接露出；
// - > 4 项：浮层只露最靠前的 3 项，其余统一收进「更多插件动作」按插件分组的底部 Sheet；
// - ≥ 8 项：底部 Sheet 顶部自动显示搜索过滤框。

import type { ComposerCatalogItem } from "./catalog";

export const MESSAGE_POPUP_DIRECT_LIMIT = 4;
export const MESSAGE_POPUP_PINNED_COUNT = 3;
export const MESSAGE_SHEET_SEARCH_THRESHOLD = 8;

export interface MessageMenuPartition {
  /** 直接显示在长按浮层里的插件动作（最多 4 项，有溢出时为前 3 项）。 */
  direct: ComposerCatalogItem[];
  /** 被折叠进「更多插件动作」的剩余条数（无溢出时为 0）。 */
  overflowCount: number;
  hasOverflow: boolean;
}

export interface MessageMenuGroup {
  groupKey: string;
  groupTitle: string;
  items: ComposerCatalogItem[];
}

/** 将启用的消息动作切分为「浮层直出」与「是否溢出收进更多抽屉」。 */
export function splitMessageMenuItems(
  items: readonly ComposerCatalogItem[],
): MessageMenuPartition {
  if (items.length <= MESSAGE_POPUP_DIRECT_LIMIT) {
    return {
      direct: [...items],
      overflowCount: 0,
      hasOverflow: false,
    };
  }
  return {
    direct: items.slice(0, MESSAGE_POPUP_PINNED_COUNT),
    overflowCount: items.length - MESSAGE_POPUP_PINNED_COUNT,
    hasOverflow: true,
  };
}

/** 提取消息动作所属插件的可读来源名（用于在浮层右侧和分组标题区分同名命令）。 */
export function pluginSourceLabel(
  item: ComposerCatalogItem,
  pluginNames?: ReadonlyMap<string, string>,
): string {
  if (item.pluginName && item.pluginName.trim().length > 0) {
    return item.pluginName.trim();
  }
  if (item.pluginId) {
    const mapped = pluginNames?.get(item.pluginId);
    if (mapped && mapped.trim().length > 0) return mapped.trim();
  }
  if (item.detail) {
    const head = item.detail.split(" · ")[0]?.trim();
    if (
      head &&
      head !== "插件" &&
      head !== "引用这条消息" &&
      head !== "Plugin" &&
      head !== "Quote this message"
    ) {
      return head;
    }
  }
  if (item.pluginId) return item.pluginId;
  return item.source === "nibi" ? "NIBI" : "Plugin";
}

/** 按插件归属分组消息动作，并支持按命令标题或插件名做不区分大小写过滤。 */
export function groupMessageMenuItems(
  items: readonly ComposerCatalogItem[],
  pluginNames?: ReadonlyMap<string, string>,
  filterQuery = "",
): MessageMenuGroup[] {
  const needle = filterQuery.trim().toLowerCase();
  const groupOrder: string[] = [];
  const buckets = new Map<string, MessageMenuGroup>();

  for (const item of items) {
    const sourceTitle = pluginSourceLabel(item, pluginNames);
    if (needle.length > 0) {
      const hay = `${item.title} ${sourceTitle} ${item.detail ?? ""} ${item.pluginId ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    const groupKey = item.pluginId ?? (item.source === "nibi" ? "__nibi__" : "__plugin__");
    let bucket = buckets.get(groupKey);
    if (!bucket) {
      bucket = { groupKey, groupTitle: sourceTitle, items: [] };
      buckets.set(groupKey, bucket);
      groupOrder.push(groupKey);
    }
    bucket.items.push(item);
  }

  return groupOrder.map((key) => buckets.get(key)!);
}
