// NIBI-GO 应用内更新安装器 JS 绑定（A4）。
// 职责：文件 SHA-256（流式，避免大文件进 JS 内存）+ 调起系统 PackageInstaller。
// 权限：REQUEST_INSTALL_PACKAGES（模块 manifest 声明）；首次安装会弹"允许安装未知应用"。
import { requireNativeModule } from "expo-modules-core";

interface NibiUpdaterNativeModule {
  sha256File(path: string): string | null;
  installApk(path: string): boolean;
}

let native: NibiUpdaterNativeModule | null = null;
let unavailable = false;

function getNative(): NibiUpdaterNativeModule | null {
  if (native) return native;
  if (unavailable) return null;
  try {
    native = requireNativeModule<NibiUpdaterNativeModule>("NibiUpdater");
    return native;
  } catch {
    unavailable = true;
    return null;
  }
}

/** 文件 SHA-256（hex）；模块缺失/读取失败返回 null。 */
export function sha256File(path: string): string | null {
  try {
    return getNative()?.sha256File(path) ?? null;
  } catch {
    return null;
  }
}

/** 调起系统安装器；模块缺失/文件不存在返回 false。 */
export function installApk(path: string): boolean {
  try {
    return getNative()?.installApk(path) ?? false;
  } catch {
    return false;
  }
}
