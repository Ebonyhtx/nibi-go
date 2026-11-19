// 离屏导航前收起输入法。
//
// Android 上只 Keyboard.dismiss() 只收键盘、不移焦点；新页面转场时系统会按焦点把
// 输入法再弹一下。顺序必须是 blur → dismiss → navigate。这里做成纯函数，入口统一调用，
// 并由 test/leave.test.ts 做顺序与接线回归守卫。

export interface LeaveComposerActions {
  /** 先让输入框失焦；没有可失焦的输入框时省略。 */
  blur?: () => void;
  /** 再收键盘。 */
  dismiss: () => void;
  /** 最后导航。 */
  navigate: () => void;
}

export function leaveComposerForNavigation({
  blur,
  dismiss,
  navigate,
}: LeaveComposerActions): void {
  try {
    blur?.();
  } catch {
    // 输入框可能已经卸载；不能因此挡住导航。
  }
  try {
    dismiss();
  } catch {
    // 转场期间键盘 API 可能抛错；导航仍然要发生。
  }
  navigate();
}

/** 目标页 focus 时的兜底：只收键盘，不碰其它状态。 */
export function dismissKeyboardOnFocus(dismiss: () => void): void {
  try {
    dismiss();
  } catch {
    // 输入法未连接时忽略。
  }
}
