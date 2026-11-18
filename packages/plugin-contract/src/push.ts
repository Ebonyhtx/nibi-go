// 插件推到槽的数据（`data.push`）：v1 的来源是 MCP 工具结果的 `_meta.nibiGo.push`。
//
// 为什么只做“随工具结果推送”：GO 插件跑在 MCP 子进程里，App 不执行插件代码。工具结果已经
// 由内核投影到 `display.ui.widgetMeta` 并随消息落库，所以插件在结果里带一份数据，App 就能把
// 它并进同一轮里该插件的槽（尤其是 `turn.note`），重启后也还在。没有请求的主动推送（计时器
// 每秒更新这类）需要一条从插件进程到 App 的常驻通道，不在 v1。
//
// 形状：`_meta: { "nibiGo": { "push": { "note": { "label": "..." } } } }`，
// 槽视图用 `{{data.push.note.label}}` 绑定。

/** 单次推送的序列化上限（避免插件用一条工具结果把快照撑大）。 */
export const SLOT_PUSH_MAX_BYTES = 16 * 1024;
/** 顶层键上限（槽按名字取用，不需要无限多的键）。 */
export const SLOT_PUSH_MAX_KEYS = 16;

export interface SlotPush {
  /** 解析出的推送数据；没有或不可用时为 undefined。 */
  push?: Record<string, unknown>;
  /** 被拒的原因（诊断用，App 不展示给用户）。 */
  issue?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 从工具结果的 `_meta` 里取插件推送。坏数据只返回 `issue`，不抛异常：
 * 一条坏结果不能让整帧会话或整轮脚注消失。
 */
export function readSlotPush(meta: unknown): SlotPush {
  const root = record(meta);
  if (!root) return {};
  const hook = record(root.nibiGo);
  if (!hook) return {};
  const push = record(hook.push);
  if (!push) return {};
  const keys = Object.keys(push);
  if (keys.length > SLOT_PUSH_MAX_KEYS) {
    return { issue: `push 顶层键超过 ${SLOT_PUSH_MAX_KEYS} 个` };
  }
  let size = 0;
  try {
    size = JSON.stringify(push).length;
  } catch {
    return { issue: "push 不能序列化" };
  }
  if (size > SLOT_PUSH_MAX_BYTES) {
    return { issue: `push 超过 ${SLOT_PUSH_MAX_BYTES} 字节` };
  }
  return { push };
}

/**
 * 同一轮里多个工具结果按到达顺序合并：后到的覆盖同名字段，不做递归合并
 * （深层结构只会放大快照，槽视图也用不上）。
 */
export function mergeSlotPush(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(previous ?? {}), ...incoming };
}
