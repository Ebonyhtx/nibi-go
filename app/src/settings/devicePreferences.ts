// 设备级本地偏好：任务通知 / 通知声音 / 任务运行时保持唤醒 / 界面动效。
// 对齐桌面客户端「常规」组里的对应项（keepAwake、任务通知、通知声音、界面动效），
// 持久化方式与外观偏好同一套：`.nibi/nibi-device.json` + 内存缓存 + 订阅；
// 读写失败回落默认值，绝不向 UI 抛错。

import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";

export interface DevicePreferences {
  version: 1;
  /** 回合完成/待审批等系统通知（仅后台/锁屏会弹，前台不影响）。 */
  taskNotifications: boolean;
  /** 通知提示音（关闭后仅静默提醒；依赖任务通知开启）。 */
  notificationSound: boolean;
  /** 任务运行时保持唤醒（桌面 keepAwakeWhileRunning 的移植语义）。 */
  keepAwakeWhileRunning: boolean;
  /** 界面动效（关闭后入场/按压动画直出终态；系统「减少动画」优先于本开关）。 */
  motionEnabled: boolean;
  /** 触感反馈（发送、开关、抽屉越阈、长按菜单等线性马达微震；服从系统触感总开关）。 */
  hapticsEnabled: boolean;
  /** 后台状态气泡：后台会话/手机操控时悬浮提醒（需悬浮窗权限）。 */
  statusBubble: boolean;
}

export const DEVICE_DEFAULTS: DevicePreferences = {
  version: 1,
  taskNotifications: true,
  notificationSound: true,
  keepAwakeWhileRunning: false,
  motionEnabled: true,
  hapticsEnabled: true,
  statusBubble: true,
};

const FILE_NAME = "nibi-device.json";
const DIRECTORY = ".nibi";
let cached: DevicePreferences | null = null;
const listeners = new Set<(preferences: DevicePreferences) => void>();

function preferenceFile(): File {
  new Directory(Paths.document, DIRECTORY).create({ intermediates: true, idempotent: true });
  return new File(Paths.document, DIRECTORY, FILE_NAME);
}

function normalize(raw: unknown): DevicePreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEVICE_DEFAULTS };
  }
  const value = raw as Record<string, unknown>;
  const bool = (key: string, fallback: boolean): boolean =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : fallback;
  return {
    version: 1,
    taskNotifications: bool("taskNotifications", DEVICE_DEFAULTS.taskNotifications),
    notificationSound: bool("notificationSound", DEVICE_DEFAULTS.notificationSound),
    keepAwakeWhileRunning: bool("keepAwakeWhileRunning", DEVICE_DEFAULTS.keepAwakeWhileRunning),
    motionEnabled: bool("motionEnabled", DEVICE_DEFAULTS.motionEnabled),
    hapticsEnabled: bool("hapticsEnabled", DEVICE_DEFAULTS.hapticsEnabled),
    statusBubble: bool("statusBubble", DEVICE_DEFAULTS.statusBubble),
  };
}

export async function loadDevicePreferences(): Promise<DevicePreferences> {
  if (cached) return cached;
  let raw: unknown;
  try {
    const file = preferenceFile();
    if (file.exists) raw = JSON.parse(await file.text());
  } catch {
    raw = undefined;
  }
  cached = normalize(raw);
  for (const listener of listeners) listener(cached);
  return cached;
}

export function getCachedDevicePreferences(): DevicePreferences {
  return cached ?? { ...DEVICE_DEFAULTS };
}

export async function saveDevicePreferences(preferences: DevicePreferences): Promise<void> {
  cached = preferences;
  for (const listener of listeners) listener(preferences);
  try {
    await preferenceFile().write(`${JSON.stringify(preferences, null, 2)}\n`);
  } catch (error) {
    console.warn("[nibigo] 保存设备偏好失败", error);
  }
}

/** 便捷部分更新（读-改-写）。 */
export async function updateDevicePreferences(
  patch: Partial<Omit<DevicePreferences, "version">>,
): Promise<void> {
  await saveDevicePreferences({ ...getCachedDevicePreferences(), ...patch });
}

function useDevicePreferences(): DevicePreferences {
  const [preferences, setPreferences] = useState(getCachedDevicePreferences());
  useEffect(() => subscribeDevicePreferences((next) => setPreferences(next)), []);
  return preferences;
}

export function subscribeDevicePreferences(
  listener: (preferences: DevicePreferences) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export { useDevicePreferences };
