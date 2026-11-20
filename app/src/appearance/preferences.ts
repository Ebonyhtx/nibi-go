// 外观偏好（跟随系统 / 浅色 / 墨夜深色）。
// 持久化方式与记忆/会话显示配置一致：`.nibi/nibi-appearance.json` + 内存缓存 + 订阅。
// 读写失败回落默认值（跟随系统），绝不向 UI 抛错；theme.ts 的 useNibiTheme 消费这里。

import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";

export type AppearanceMode = "system" | "light" | "dark";

export interface AppearancePreferences {
  version: 1;
  mode: AppearanceMode;
}

export const APPEARANCE_DEFAULTS: AppearancePreferences = {
  version: 1,
  mode: "system",
};

const FILE_NAME = "nibi-appearance.json";
const DIRECTORY = ".nibi";
let cached: AppearancePreferences | null = null;
const listeners = new Set<(preferences: AppearancePreferences) => void>();

function preferenceFile(): File {
  new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
  return new File(Paths.document, DIRECTORY, FILE_NAME);
}

export function normalizeAppearancePreferences(raw: unknown): AppearancePreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...APPEARANCE_DEFAULTS };
  }
  const value = raw as { mode?: unknown };
  const mode = value.mode === "light" || value.mode === "dark" ? value.mode : APPEARANCE_DEFAULTS.mode;
  return { version: 1, mode };
}

export async function loadAppearancePreferences(): Promise<AppearancePreferences> {
  if (cached) return cached;
  let raw: unknown;
  try {
    const file = preferenceFile();
    if (file.exists) raw = JSON.parse(await file.text());
  } catch {
    raw = undefined;
  }
  cached = normalizeAppearancePreferences(raw);
  return cached;
}

export function getCachedAppearancePreferences(): AppearancePreferences {
  return cached ?? { ...APPEARANCE_DEFAULTS };
}

export async function saveAppearancePreferences(
  preferences: AppearancePreferences,
): Promise<void> {
  cached = preferences;
  for (const listener of listeners) listener(preferences);
  try {
    await preferenceFile().write(`${JSON.stringify(preferences, null, 2)}\n`);
  } catch (error) {
    console.warn("[nibigo] 保存外观设置失败", error);
  }
}

export function subscribeAppearancePreferences(
  listener: (preferences: AppearancePreferences) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 响应式读取外观偏好（写入即刷新，主题钩子据此重渲染）。 */
export function useAppearanceMode(): AppearanceMode {
  const [mode, setMode] = useState<AppearanceMode>(getCachedAppearancePreferences().mode);
  useEffect(() => subscribeAppearancePreferences((next) => setMode(next.mode)), []);
  return mode;
}
