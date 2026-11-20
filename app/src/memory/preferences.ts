// 本机记忆开关（GO 的自动记忆是设备级、所有会话共享；不是桌面端的“按工作区记忆”）。
//
// 持久化方式与会话显示配置一致：`.nibi/nibi-memory.json` + 内存缓存 + 订阅。
// 文件缺失/损坏时回到默认值（开启，保持升级前的实际行为），绝不向 UI 抛错。

import { Directory, File, Paths } from "expo-file-system";

export interface MemoryPreferences {
  version: 1;
  /** 新会话是否读取并更新本机记忆；已打开的会话在会话物化时读取，重开后生效。 */
  enabled: boolean;
}

export const MEMORY_DEFAULTS: MemoryPreferences = {
  version: 1,
  enabled: true,
};

const FILE_NAME = "nibi-memory.json";
const DIRECTORY = ".nibi";
let cached: MemoryPreferences | null = null;
const listeners = new Set<(preferences: MemoryPreferences) => void>();

function preferenceFile(): File {
  new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
  return new File(Paths.document, DIRECTORY, FILE_NAME);
}

export function normalizeMemoryPreferences(raw: unknown): MemoryPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...MEMORY_DEFAULTS };
  }
  const value = raw as { enabled?: unknown };
  return {
    version: 1,
    enabled: typeof value.enabled === "boolean" ? value.enabled : MEMORY_DEFAULTS.enabled,
  };
}

export async function loadMemoryPreferences(): Promise<MemoryPreferences> {
  if (cached) return cached;
  let raw: unknown;
  try {
    const file = preferenceFile();
    if (file.exists) raw = JSON.parse(await file.text());
  } catch {
    raw = undefined;
  }
  cached = normalizeMemoryPreferences(raw);
  return cached;
}

/** 内核建会话时会同步问 Host 要偏好：不能等异步读盘，先用缓存/默认值。 */
export function getCachedMemoryPreferences(): MemoryPreferences {
  return cached ?? { ...MEMORY_DEFAULTS };
}

export async function saveMemoryPreferences(
  preferences: MemoryPreferences,
): Promise<void> {
  cached = preferences;
  for (const listener of listeners) listener(preferences);
  try {
    await preferenceFile().write(`${JSON.stringify(preferences, null, 2)}\n`);
  } catch (error) {
    console.warn("[nibigo] 保存记忆设置失败", error);
  }
}

export function subscribeMemoryPreferences(
  listener: (preferences: MemoryPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
