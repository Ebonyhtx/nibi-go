// NIBI-GO 应用内更新安装器 JS 绑定（A4）。
// 职责：文件 SHA-256（流式，避免大文件进 JS 内存）+ 断点续传下载 + 调起系统 PackageInstaller。
// 权限：REQUEST_INSTALL_PACKAGES（模块 manifest 声明）；首次安装会弹"允许安装未知应用"。
import { requireNativeModule } from "expo-modules-core";

export interface ApkDownloadProgress {
  loaded: number;
  /** 服务端未给总大小时为 null。 */
  total: number | null;
}

export interface ApkDownloadResult {
  path: string;
  verified: boolean;
}

interface NativeProgressEvent {
  loaded: number;
  total: number;
}

interface NibiUpdaterNativeModule {
  sha256File(path: string): string | null;
  installApk(path: string): boolean;
  downloadApk(
    urls: string[],
    destination: string,
    sha256: string,
    expectedSize: number,
  ): Promise<{ path: string; verified: boolean }>;
  cancelDownload(): void;
  addListener(
    eventName: "onDownloadProgress",
    listener: (event: NativeProgressEvent) => void,
  ): { remove(): void };
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

/**
 * 原生断点续传下载 APK：按 urls 顺序尝试，写 `<destination>.part`，完成后校验 SHA-256。
 * 模块缺失时抛错，调用方可回退到 JS 下载。
 */
export async function downloadApk(
  urls: readonly string[],
  destination: string,
  sha256: string,
  expectedSize: number,
  onProgress?: (progress: ApkDownloadProgress) => void,
): Promise<ApkDownloadResult> {
  const module = getNative();
  if (!module) throw new Error("NibiUpdater native module unavailable");
  const subscription = onProgress
    ? module.addListener("onDownloadProgress", (event) => {
        const loaded = Number(event.loaded);
        const total = Number(event.total);
        onProgress({
          loaded: Number.isFinite(loaded) ? loaded : 0,
          total: Number.isFinite(total) && total > 0 ? total : null,
        });
      })
    : null;
  try {
    const result = await module.downloadApk([...urls], destination, sha256, expectedSize);
    return { path: result.path, verified: result.verified === true };
  } finally {
    subscription?.remove();
  }
}

/** 取消当前原生下载；模块缺失时静默忽略。 */
export function cancelApkDownload(): void {
  try {
    getNative()?.cancelDownload();
  } catch {
    // 模块缺失/已结束都无需处理。
  }
}
