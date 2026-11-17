// 会话显示配置持久化：思考过程 / 工具调用的显示与自动折叠。
//
// 与 COMPOSE 配置同一套落盘方式：.nibi 下的 JSON 文件 + 内存缓存 + 订阅。
// 文件缺失或损坏时回落到默认值，绝不向 UI 抛错。

import { Directory, File, Paths } from "expo-file-system";

export interface ConversationPreferences {
  version: 1;
  /** 在消息流里展示模型的思考内容。 */
  showReasoning: boolean;
  /** 在消息流里展示工具调用摘要。 */
  showTools: boolean;
  /** 一轮结束后自动收起思考内容。 */
  autoCollapseReasoning: boolean;
  /** 一轮结束后自动收起工具调用详情。 */
  autoCollapseTools: boolean;
}

export type ConversationPreferenceKey = Exclude<keyof ConversationPreferences, "version">;

export const CONVERSATION_DEFAULTS: ConversationPreferences = {
  version: 1,
  showReasoning: true,
  showTools: true,
  autoCollapseReasoning: true,
  autoCollapseTools: true,
};

const FILE_NAME = "nibi-conversation.json";
const DIRECTORY = ".nibi";
let cached: ConversationPreferences | null = null;
const listeners = new Set<(preferences: ConversationPreferences) => void>();

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 缺字段按默认值补齐，非布尔值忽略；未知字段一律丢弃。 */
export function normalizeConversationPreferences(raw: unknown): ConversationPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...CONVERSATION_DEFAULTS };
  }
  const value = raw as Partial<Record<keyof ConversationPreferences, unknown>>;
  return {
    version: 1,
    showReasoning: boolOr(value.showReasoning, CONVERSATION_DEFAULTS.showReasoning),
    showTools: boolOr(value.showTools, CONVERSATION_DEFAULTS.showTools),
    autoCollapseReasoning: boolOr(
      value.autoCollapseReasoning,
      CONVERSATION_DEFAULTS.autoCollapseReasoning,
    ),
    autoCollapseTools: boolOr(value.autoCollapseTools, CONVERSATION_DEFAULTS.autoCollapseTools),
  };
}

function preferenceFile(): File {
  new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
  return new File(Paths.document, DIRECTORY, FILE_NAME);
}

export async function loadConversationPreferences(): Promise<ConversationPreferences> {
  if (cached) return cached;
  let raw: unknown;
  try {
    const file = preferenceFile();
    if (file.exists) raw = JSON.parse(await file.text());
  } catch {
    raw = undefined;
  }
  const preferences = normalizeConversationPreferences(raw);
  cached = preferences;
  return preferences;
}

export async function saveConversationPreferences(
  preferences: ConversationPreferences,
): Promise<void> {
  cached = preferences;
  for (const listener of listeners) listener(preferences);
  try {
    await preferenceFile().write(`${JSON.stringify(preferences, null, 2)}\n`);
  } catch (error) {
    console.warn("[nibigo] 保存会话显示配置失败", error);
  }
}

export function getCachedConversationPreferences(): ConversationPreferences | null {
  return cached;
}

export function subscribeConversationPreferences(
  listener: (preferences: ConversationPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
