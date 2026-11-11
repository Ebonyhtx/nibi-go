// NIBI-GO KeepAlive 前台服务 JS 绑定（A4）。
// 背景（Spike 2 实测）：Android 上切后台 ~1s 连接被 abort，JS 定时器暂停——
// 没有前台服务时远程连接无法在后台存活。本模块提供常驻通知 + START_STICKY 服务。
// 惰性 requireNativeModule：Expo Go 等无本模块的宿主静默降级（返回 false），不炸 import。
import { requireNativeModule } from "expo-modules-core";

interface NibiKeepaliveNativeModule {
  start(title: string, text: string): boolean;
  stop(): boolean;
  isRunning(): boolean;
}

let native: NibiKeepaliveNativeModule | null = null;
let unavailable = false;

function getNative(): NibiKeepaliveNativeModule | null {
  if (native) return native;
  if (unavailable) return null;
  try {
    native = requireNativeModule<NibiKeepaliveNativeModule>("NibiKeepalive");
    return native;
  } catch {
    // Expo Go / 未构建 dev-client：模块不存在
    unavailable = true;
    return null;
  }
}

/** 启动前台服务（幂等：重复调用只更新通知）。 */
export function startKeepAlive(
  title = "NIBI-GO 已连接",
  text = "保持与桌面的远程连接",
): boolean {
  try {
    return getNative()?.start(title, text) ?? false;
  } catch {
    return false;
  }
}

export function stopKeepAlive(): boolean {
  try {
    return getNative()?.stop() ?? false;
  } catch {
    return false;
  }
}

export function isKeepAliveRunning(): boolean {
  try {
    return getNative()?.isRunning() ?? false;
  } catch {
    return false;
  }
}
