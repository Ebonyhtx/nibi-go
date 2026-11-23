// 语言偏好（跟随系统 / 简体中文 / English）。
// 持久化方式与外观/记忆/设备偏好一致：`.nibi/nibi-language.json` + 内存缓存 + 订阅。
// 读写失败回落默认值（跟随系统），绝不向 UI 抛错；在纯 Node 单测环境下也会优雅退回内存态。

import { useEffect, useState } from "react";

export type LanguageMode = "system" | "zh-CN" | "en-US";
export type Locale = "zh-CN" | "en-US";

export interface LanguagePreferences {
  version: 1;
  mode: LanguageMode;
}

export const LANGUAGE_DEFAULTS: LanguagePreferences = {
  version: 1,
  mode: "system",
};

const FILE_NAME = "nibi-language.json";
const DIRECTORY = ".nibi";
let cached: LanguagePreferences | null = null;
const listeners = new Set<(preferences: LanguagePreferences) => void>();

/** 根据系统 locale 字符串归一到受支持的 Locale（中文簇 → zh-CN，其余 → en-US）。 */
export function normalizeSystemLocale(raw?: string | null): Locale {
  if (!raw || typeof raw !== "string") return "zh-CN";
  const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return "zh-CN";
  return normalized.startsWith("zh") ? "zh-CN" : "en-US";
}

/** 探测运行环境系统语言（优先 Intl，兼容 RN/Android/iOS 与纯 Node）。 */
export function detectSystemLocale(): Locale {
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) return normalizeSystemLocale(intlLocale);
  } catch {
    // 某些精简运行环境可能缺少 Intl.DateTimeFormat
  }
  return "zh-CN";
}

/** 解析最终生效语言：显式偏好优先，否则跟随系统语言。 */
export function resolveLocale(mode: LanguageMode, systemLocale?: string | null): Locale {
  if (mode === "zh-CN" || mode === "en-US") return mode;
  return systemLocale !== undefined ? normalizeSystemLocale(systemLocale) : detectSystemLocale();
}

export function normalizeLanguagePreferences(raw: unknown): LanguagePreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...LANGUAGE_DEFAULTS };
  }
  const value = raw as { mode?: unknown };
  const mode: LanguageMode =
    value.mode === "zh-CN" || value.mode === "en-US" || value.mode === "system"
      ? value.mode
      : LANGUAGE_DEFAULTS.mode;
  return { version: 1, mode };
}

async function readStoredLanguage(): Promise<unknown> {
  try {
    const { Directory, File, Paths } = await import("expo-file-system");
    new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
    const file = new File(Paths.document, DIRECTORY, FILE_NAME);
    if (!file.exists) return undefined;
    return JSON.parse(await file.text());
  } catch {
    return undefined;
  }
}

async function writeStoredLanguage(preferences: LanguagePreferences): Promise<void> {
  try {
    const { Directory, File, Paths } = await import("expo-file-system");
    new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
    const file = new File(Paths.document, DIRECTORY, FILE_NAME);
    await file.write(`${JSON.stringify(preferences, null, 2)}\n`);
  } catch (error) {
    // 纯 Node 单测无 expo-file-system 原生宿主时静默忽略，只在运行时记警告。
    if (typeof process === "undefined" || process.env.VITEST !== "true") {
      console.warn("[nibigo] 保存语言设置失败", error);
    }
  }
}

export async function loadLanguagePreferences(): Promise<LanguagePreferences> {
  if (cached) return cached;
  const raw = await readStoredLanguage();
  cached = normalizeLanguagePreferences(raw);
  for (const listener of listeners) listener(cached);
  return cached;
}

export function getCachedLanguagePreferences(): LanguagePreferences {
  return cached ?? { ...LANGUAGE_DEFAULTS };
}

export function getCurrentLocale(): Locale {
  return resolveLocale(getCachedLanguagePreferences().mode);
}

export async function saveLanguagePreferences(preferences: LanguagePreferences): Promise<void> {
  cached = normalizeLanguagePreferences(preferences);
  for (const listener of listeners) listener(cached);
  await writeStoredLanguage(cached);
}

export async function setLanguageMode(mode: LanguageMode): Promise<void> {
  await saveLanguagePreferences({ version: 1, mode });
}

/** 单测复位缓存用，业务代码不要调用。 */
export function resetLanguagePreferencesForTest(): void {
  cached = null;
}

export function subscribeLanguagePreferences(
  listener: (preferences: LanguagePreferences) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 响应式读取语言模式（system / zh-CN / en-US）。 */
export function useLanguageMode(): LanguageMode {
  const [mode, setMode] = useState<LanguageMode>(getCachedLanguagePreferences().mode);
  useEffect(() => subscribeLanguagePreferences((next) => setMode(next.mode)), []);
  return mode;
}

/** 响应式读取最终生效语言（zh-CN / en-US）。 */
export function useLocale(): Locale {
  const mode = useLanguageMode();
  return resolveLocale(mode);
}
