// 声明式视图 v1：组件目录 + 预算 + 降级 + 数据绑定求值。
//
// 插件只能画这些组件（文字/行/列/卡/徽标/分隔/进度/列表/按钮/间距）。样式只到语义层
// （tone/style），不接受任意色值/字号——避免插件拼出像系统授权或警告的界面。
//
// 不可信的输入一律走这里：节点数/深度/字节预算超了丢整条卡；不认识的组件换成 v1 替身
// 并在 issues 里留证据，绝不让一条坏视图带走整帧会话。

import type {
  Binding,
  ContractIssue,
  SlotData,
  ViewBudget,
  ViewListItem,
  ViewNode,
  ViewText,
  ViewTone,
  ViewKind,
} from "./types";
import { VIEW_BUDGETS } from "./types";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const BINDING_RE = /^data(?:\.[A-Za-z0-9_-]+)*$/u;
const MAX_TEXT_CHARS = 1_000;
const MAX_CHILDREN = { row: 8, column: 12, card: 12 } as const;
const MAX_LIST_ITEMS = 20;

const TEXT_STYLES = new Set(["title", "body", "caption", "mono", "label"]);
const TONES = new Set(["default", "sub", "faint", "brand", "ok", "warn", "danger"]);
const BUTTON_STYLES = new Set(["primary", "secondary", "danger"]);

export interface ViewReadResult {
  view: ViewNode | null;
  issues: ContractIssue[];
  /** 有组件被替换/丢弃时为 true；UI 可以显示“已降级”。 */
  degraded: boolean;
  bytes: number;
  nodes: number;
  depth: number;
}

interface BudgetCursor {
  budget: ViewBudget;
  nodes: number;
  depth: number;
  degraded: boolean;
  /** 节点预算超了：整条视图作废（不是截断）。 */
  aborted: boolean;
  issues: ContractIssue[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function textValue(raw: unknown): ViewText | null {
  if (typeof raw === "string" && raw.length <= MAX_TEXT_CHARS) return raw;
  if (isObject(raw) && typeof raw.$ === "string" && BINDING_RE.test(raw.$)) {
    return { $: raw.$ };
  }
  return null;
}

function toneValue(raw: unknown): ViewTone | undefined {
  return typeof raw === "string" && TONES.has(raw) ? (raw as ViewTone) : undefined;
}

function gapValue(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.max(0, Math.min(4, Math.round(raw)));
}

function placeholder(type: string, cursor: BudgetCursor, path: string): ViewNode {
  cursor.degraded = true;
  cursor.issues.push({ path, message: `不认识的视图组件 "${type}"，已降级为文字` });
  return { type: "text", text: `[不支持的组件: ${type}]`, style: "caption", tone: "faint" };
}

/** `tabs`/`gallery` 这类 v2 组件的替身：v1 没有标签页/画廊，摊平成列或列表。 */
function adaptNode(
  raw: Record<string, unknown>,
  type: string,
  cursor: BudgetCursor,
  path: string,
  depth: number,
): ViewNode | null {
  if (type === "tabs") {
    cursor.degraded = true;
    cursor.issues.push({ path, message: "tabs 在 v1 里摊平为纵向排列" });
    const children: ViewNode[] = [];
    const tabs = Array.isArray(raw.tabs) ? raw.tabs : [];
    for (const [index, tab] of tabs.slice(0, MAX_CHILDREN.column).entries()) {
      if (!isObject(tab)) continue;
      const label = textValue(tab.label);
      if (label) children.push({ type: "text", text: label, style: "label" });
      if (Array.isArray(tab.children)) {
        for (const [childIndex, child] of tab.children.entries()) {
          const node = sanitize(child, cursor, `${path}/tabs/${index}/children/${childIndex}`, depth + 1);
          if (node) children.push(node);
        }
      }
    }
    return children.length > 0
      ? { type: "column", gap: 2, children }
      : { type: "text", text: "[空标签页]", style: "caption", tone: "faint" };
  }
  if (type === "gallery") {
    cursor.degraded = true;
    cursor.issues.push({ path, message: "gallery 在 v1 里降级为列表" });
    const items = Array.isArray(raw.items) ? raw.items : [];
    return {
      type: "list",
      items: items.slice(0, MAX_LIST_ITEMS).flatMap((item) => {
        if (isObject(item)) {
          const label = textValue(item.label ?? item.title ?? item.alt);
          const value = textValue(item.value);
          return label ? [{ label, ...(value ? { value } : {}) }] : [];
        }
        const label = textValue(item);
        return label ? [{ label }] : [];
      }),
      empty: "没有内容",
    };
  }
  return placeholder(type, cursor, path);
}

function sanitize(
  raw: unknown,
  cursor: BudgetCursor,
  path: string,
  depth: number,
): ViewNode | null {
  if (cursor.aborted) return null;
  cursor.nodes += 1;
  cursor.depth = Math.max(cursor.depth, depth);
  if (cursor.nodes > cursor.budget.nodes) {
    cursor.aborted = true;
    cursor.issues.push({
      path,
      message: `视图节点超过预算（${cursor.budget.nodes}），本卡不渲染`,
    });
    return null;
  }
  if (!isObject(raw) || typeof raw.type !== "string") {
    cursor.issues.push({ path, message: "视图节点必须是带 type 的对象" });
    return null;
  }
  if (depth > cursor.budget.depth) {
    cursor.degraded = true;
    cursor.issues.push({ path, message: `视图层级超过 ${cursor.budget.depth} 层` });
    return { type: "text", text: "[视图层级过深]", style: "caption", tone: "faint" };
  }
  const type = raw.type;
  switch (type) {
    case "text": {
      const text = textValue(raw.text);
      if (text === null) {
        cursor.issues.push({ path: `${path}/text`, message: "text 必须是字符串或数据绑定" });
        return null;
      }
      const style =
        typeof raw.style === "string" && TEXT_STYLES.has(raw.style)
          ? (raw.style as "title" | "body" | "caption" | "mono" | "label")
          : undefined;
      const maxLines =
        typeof raw.maxLines === "number" && Number.isFinite(raw.maxLines)
          ? Math.max(1, Math.min(6, Math.round(raw.maxLines)))
          : undefined;
      return {
        type,
        text,
        ...(style ? { style } : {}),
        ...(toneValue(raw.tone) ? { tone: toneValue(raw.tone) } : {}),
        ...(maxLines ? { maxLines } : {}),
      };
    }
    case "row":
    case "column":
    case "card": {
      const limit = MAX_CHILDREN[type];
      const rawChildren = Array.isArray(raw.children) ? raw.children : [];
      if (rawChildren.length > limit) {
        cursor.degraded = true;
        cursor.issues.push({
          path: `${path}/children`,
          message: `${type} 最多 ${limit} 个子节点，已丢弃多出的 ${rawChildren.length - limit} 个`,
        });
      }
      const children: ViewNode[] = [];
      for (const [index, child] of rawChildren.slice(0, limit).entries()) {
        const node = sanitize(child, cursor, `${path}/children/${index}`, depth + 1);
        if (node) children.push(node);
      }
      if (type === "row") {
        const align =
          raw.align === "center" || raw.align === "between" ? raw.align : undefined;
        return {
          type,
          ...(gapValue(raw.gap) !== undefined ? { gap: gapValue(raw.gap) } : {}),
          ...(align ? { align } : {}),
          children,
        };
      }
      if (type === "column") {
        return {
          type,
          ...(gapValue(raw.gap) !== undefined ? { gap: gapValue(raw.gap) } : {}),
          children,
        };
      }
      const title = textValue(raw.title);
      return {
        type,
        ...(title ? { title } : {}),
        children,
      };
    }
    case "badge": {
      const text = textValue(raw.text);
      if (text === null) {
        cursor.issues.push({ path: `${path}/text`, message: "badge.text 不合法" });
        return null;
      }
      return { type, text, ...(toneValue(raw.tone) ? { tone: toneValue(raw.tone) } : {}) };
    }
    case "divider":
      return { type };
    case "progress": {
      const value = raw.value;
      if (typeof value === "number" && Number.isFinite(value)) {
        const label = textValue(raw.label);
        return {
          type,
          value: Math.max(0, Math.min(100, value)),
          ...(label ? { label } : {}),
        };
      }
      if (isObject(value) && typeof value.$ === "string" && BINDING_RE.test(value.$)) {
        const label = textValue(raw.label);
        return {
          type,
          value: { $: value.$ },
          ...(label ? { label } : {}),
        };
      }
      cursor.issues.push({ path: `${path}/value`, message: "progress.value 必须是 0-100 或数据绑定" });
      return null;
    }
    case "list": {
      const empty = typeof raw.empty === "string" ? raw.empty.slice(0, 200) : undefined;
      const itemsObject = isObject(raw.items) ? (raw.items as Record<string, unknown>) : null;
      if (itemsObject && typeof itemsObject.$ === "string") {
        const $ = itemsObject.$;
        if (!BINDING_RE.test($)) {
          cursor.issues.push({ path: `${path}/items`, message: "items 绑定路径不合法" });
          return null;
        }
        return { type, items: { $ }, ...(empty ? { empty } : {}) };
      }
      if (!Array.isArray(raw.items)) {
        cursor.issues.push({ path: `${path}/items`, message: "list.items 必须是数组或数据绑定" });
        return null;
      }
      if (raw.items.length > MAX_LIST_ITEMS) {
        cursor.degraded = true;
        cursor.issues.push({
          path: `${path}/items`,
          message: `list 最多 ${MAX_LIST_ITEMS} 项，已截断`,
        });
      }
      const items: ViewListItem[] = [];
      for (const item of raw.items.slice(0, MAX_LIST_ITEMS)) {
        if (typeof item === "string") {
          items.push({ label: item });
          continue;
        }
        if (!isObject(item)) continue;
        const label = textValue(item.label);
        if (!label) continue;
        const value = textValue(item.value);
        items.push({
          label,
          ...(value ? { value } : {}),
          ...(toneValue(item.tone) ? { tone: toneValue(item.tone) } : {}),
        });
      }
      return { type, items, ...(empty ? { empty } : {}) };
    }
    case "button": {
      const label = textValue(raw.label);
      const action = typeof raw.action === "string" ? raw.action : "";
      if (!label || !ID_RE.test(action)) {
        cursor.issues.push({ path, message: "button 需要 label 与合法 action id" });
        return null;
      }
      const style =
        typeof raw.style === "string" && BUTTON_STYLES.has(raw.style)
          ? (raw.style as "primary" | "secondary" | "danger")
          : undefined;
      return { type, label, action, ...(style ? { style } : {}) };
    }
    case "spacer":
      return {
        type,
        ...(typeof raw.size === "number"
          ? { size: Math.max(1, Math.min(4, Math.round(raw.size))) }
          : {}),
      };
    default:
      return adaptNode(raw, type, cursor, path, depth);
  }
}

/** 解析一个视图；超预算返回 `view: null`（调用方按“无卡/无面板”处理）。 */
export function readView(raw: unknown, kind: ViewKind): ViewReadResult {
  const budget = VIEW_BUDGETS[kind];
  const cursor: BudgetCursor = {
    budget,
    nodes: 0,
    depth: 0,
    degraded: false,
    aborted: false,
    issues: [],
  };
  const view = sanitize(raw, cursor, "", 1);
  if (cursor.aborted) {
    return {
      view: null,
      issues: cursor.issues,
      degraded: cursor.degraded,
      bytes: 0,
      nodes: cursor.nodes,
      depth: cursor.depth,
    };
  }
  const bytes = view ? utf8Length(JSON.stringify(view)) : 0;
  if (view && bytes > budget.bytes) {
    cursor.issues.push({
      path: "",
      message: `视图 ${bytes} 字节超过 ${kind} 预算 ${budget.bytes} 字节`,
    });
    return { view: null, issues: cursor.issues, degraded: cursor.degraded, bytes, nodes: cursor.nodes, depth: cursor.depth };
  }
  return {
    view,
    issues: cursor.issues,
    degraded: cursor.degraded,
    bytes,
    nodes: cursor.nodes,
    depth: cursor.depth,
  };
}

/** 绑定求值：路径只认 `data.` 开头；缺值返回 undefined。 */
export function readBinding(data: SlotData, binding: Binding): unknown {
  const path = binding.$.split(".").slice(1);
  let current: unknown = data.data;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** 字面量里的 `{{data.x.y}}` 插值；绑定对象不在字符串分支里出现。 */
export function resolveText(value: ViewText, data: SlotData): string {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*(data(?:\.[A-Za-z0-9_-]+)*)\s*\}\}/gu, (_match, path: string) => {
      return stringify(readBinding(data, { $: path }));
    });
  }
  return stringify(readBinding(data, value));
}

export type RenderedListItem = { label: string; value?: string; tone?: ViewTone };

export type RenderedViewNode =
  | {
      type: "text";
      text: string;
      style?: "title" | "body" | "caption" | "mono" | "label";
      tone?: ViewTone;
      maxLines?: number;
    }
  | { type: "row"; gap?: number; align?: "start" | "center" | "between"; children: RenderedViewNode[] }
  | { type: "column"; gap?: number; children: RenderedViewNode[] }
  | { type: "card"; title?: string; children: RenderedViewNode[] }
  | { type: "badge"; text: string; tone?: ViewTone }
  | { type: "divider" }
  | { type: "progress"; value: number; label?: string }
  | { type: "list"; items: RenderedListItem[]; empty?: string }
  | { type: "button"; label: string; action: string; style?: "primary" | "secondary" | "danger" }
  | { type: "spacer"; size?: number };

/** 把已校验的视图按宿主数据求值；不修改输入。 */
export function resolveView(view: ViewNode, data: SlotData): RenderedViewNode {
  switch (view.type) {
    case "text":
      return {
        type: "text",
        text: resolveText(view.text, data),
        ...(view.style ? { style: view.style } : {}),
        ...(view.tone ? { tone: view.tone } : {}),
        ...(view.maxLines ? { maxLines: view.maxLines } : {}),
      };
    case "row":
    case "column":
      return {
        type: view.type,
        ...(view.gap === undefined ? {} : { gap: view.gap }),
        ...(view.type === "row" && view.align ? { align: view.align } : {}),
        children: view.children.map((child) => resolveView(child, data)),
      };
    case "card": {
      const title = view.title === undefined ? undefined : resolveText(view.title, data);
      return {
        type: "card",
        ...(title ? { title } : {}),
        children: view.children.map((child) => resolveView(child, data)),
      };
    }
    case "badge":
      return { type: "badge", text: resolveText(view.text, data), ...(view.tone ? { tone: view.tone } : {}) };
    case "divider":
      return { type: "divider" };
    case "progress": {
      const rawValue = typeof view.value === "number" ? view.value : Number(readBinding(data, view.value));
      const value = Number.isFinite(rawValue) ? Math.max(0, Math.min(100, rawValue)) : 0;
      return {
        type: "progress",
        value,
        ...(view.label ? { label: resolveText(view.label, data) } : {}),
      };
    }
    case "list": {
      const rawItems = Array.isArray(view.items) ? view.items : readBinding(data, view.items);
      const items: RenderedListItem[] = [];
      if (Array.isArray(rawItems)) {
        for (const item of rawItems.slice(0, MAX_LIST_ITEMS)) {
          if (typeof item === "string" || typeof item === "number") {
            items.push({ label: String(item) });
            continue;
          }
          if (!isObject(item)) continue;
          const label = resolveText(textValue(item.label) ?? "", data);
          const value = item.value === undefined ? undefined : resolveText(textValue(item.value) ?? "", data);
          items.push({
            label,
            ...(value ? { value } : {}),
            ...(toneValue(item.tone) ? { tone: toneValue(item.tone) } : {}),
          });
        }
      }
      return { type: "list", items, ...(view.empty ? { empty: view.empty } : {}) };
    }
    case "button":
      return {
        type: "button",
        label: resolveText(view.label, data),
        action: view.action,
        ...(view.style ? { style: view.style } : {}),
      };
    case "spacer":
      return { type: "spacer", ...(view.size === undefined ? {} : { size: view.size }) };
  }
}
