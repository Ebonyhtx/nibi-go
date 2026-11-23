// 全局悬浮像素宠物气泡的 RN 胶水。
//
// 状态由 useKernelConversation 驱动（turn/rows + AppState + 手机工具在途信号 + 当前深浅色方案），
// 原生侧只按 pack.json 播放对应像素宠物小鸟动画，不做自动状态机。

import { Appearance } from "react-native";
import { canShowPhoneBubble, phoneToolsBusy, setPhoneBubbleState } from "nibi-phone";

import { getCachedAppearancePreferences } from "../appearance/preferences";
import { getCachedDevicePreferences } from "../settings/devicePreferences";

export type PhoneBubbleState =
  | "hidden"
  | "idle"
  | "thinking"
  | "working"
  | "carrying"
  | "running"
  | "tools"
  | "waiting"
  | "done"
  | "error";

function resolvedAppScheme(): "light" | "dark" {
  const mode = getCachedAppearancePreferences().mode;
  if (mode === "light" || mode === "dark") return mode;
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

/** 悬浮宠物是否可用（系统「显示在其他应用上层」已授权）。 */
export function canShowBubble(): boolean {
  return canShowPhoneBubble();
}

/** 驱动悬浮像素宠物气泡；「后台运行气泡」开关关掉时一律不发 hidden 之外的态。 */
export function setBubbleState(state: PhoneBubbleState): void {
  if (state !== "hidden" && !getCachedDevicePreferences().statusBubble) return;
  setPhoneBubbleState(state, resolvedAppScheme());
}

/** 原生侧当前是否有手机工具在执行（tools 状态的信号源；RN 侧 1s 轮询）。 */
export function phoneToolsActive(): boolean {
  return phoneToolsBusy();
}
