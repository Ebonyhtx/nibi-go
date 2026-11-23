// 应用级双语切换入口（简体中文 / English）。
// 组件内优先使用 useI18n()：切语言时所有已挂载屏幕/弹层即时刷新，无需重启；
// 非 React 模块（内核 hook、工具标签、插件安装器、目录表等）使用 pickText / getCurrentLocale。

import { useCallback } from "react";

import {
  getCurrentLocale,
  setLanguageMode,
  useLanguageMode,
  useLocale,
  type LanguageMode,
  type Locale,
} from "./preferences";

export {
  detectSystemLocale,
  getCachedLanguagePreferences,
  getCurrentLocale,
  LANGUAGE_DEFAULTS,
  loadLanguagePreferences,
  normalizeLanguagePreferences,
  normalizeSystemLocale,
  resetLanguagePreferencesForTest,
  resolveLocale,
  saveLanguagePreferences,
  setLanguageMode,
  subscribeLanguagePreferences,
  useLanguageMode,
  useLocale,
  type LanguageMode,
  type LanguagePreferences,
  type Locale,
} from "./preferences";

/** 按当前（或显式传入）语言二选一。 */
export function pickText<T = string>(zh: T, en: T, locale: Locale = getCurrentLocale()): T {
  return locale === "en-US" ? en : zh;
}

/** 简明模板插值：`format("已选 {n} 项", { n: 3 })`。 */
export function formatText(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

export interface I18nApi {
  locale: Locale;
  isEn: boolean;
  mode: LanguageMode;
  setMode: (mode: LanguageMode) => Promise<void>;
  /** 按当前生效语言选择中文或英文值。 */
  pick: <T = string>(zh: T, en: T) => T;
}

/** 响应式双语钩子：语言偏好变化时自动触发重渲染。 */
export function useI18n(): I18nApi {
  const mode = useLanguageMode();
  const locale = useLocale();
  const isEn = locale === "en-US";
  const pick = useCallback(<T = string>(zh: T, en: T): T => (isEn ? en : zh), [isEn]);
  return {
    locale,
    isEn,
    mode,
    setMode: setLanguageMode,
    pick,
  };
}
