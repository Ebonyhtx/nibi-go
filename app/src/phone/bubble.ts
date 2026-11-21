// 全局悬浮状态气泡的 RN 胶水。
//
// 状态完全由 useKernelConversation 驱动（turn/rows + AppState + 手机工具在途信号），
// 原生侧不做自动状态机。模块缺失、调用失败或没有「显示在其他应用上层」权限时
// 全部静默——气泡是提醒，不是关键路径。

import { canShowPhoneBubble, phoneToolsBusy, setPhoneBubbleState } from "nibi-phone";

export type PhoneBubbleState = "hidden" | "running" | "tools" | "waiting" | "done";

/** 悬浮气泡是否可用（系统「显示在其他应用上层」已授权）。 */
export function canShowBubble(): boolean {
  return canShowPhoneBubble();
}

/** 驱动悬浮状态气泡（hidden/running/tools/waiting/done）；失败静默。 */
export function setBubbleState(state: PhoneBubbleState): void {
  setPhoneBubbleState(state);
}

/** 原生侧当前是否有手机工具在执行（tools 状态的信号源；RN 侧 1s 轮询）。 */
export function phoneToolsActive(): boolean {
  return phoneToolsBusy();
}
