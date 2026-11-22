// 原生线性马达触觉反馈：服从设备偏好 `hapticsEnabled` 与 Android 系统触感总开关，
// 测试/无原生模块环境下静默降级，不弹报错。
import { triggerPhoneHaptic, type PhoneHapticKind } from "nibi-phone";

import { getCachedDevicePreferences } from "../settings/devicePreferences";

export type HapticKind = PhoneHapticKind;

const MIN_INTERVAL_MS = 18;
let lastAt = 0;

/** 触发一次轻量原生触觉；高频连续刻度自动节流，避免连震发糊。 */
export function haptic(kind: HapticKind): void {
  if (!getCachedDevicePreferences().hapticsEnabled) return;
  const now = Date.now();
  if (now - lastAt < MIN_INTERVAL_MS) return;
  lastAt = now;
  triggerPhoneHaptic(kind);
}
