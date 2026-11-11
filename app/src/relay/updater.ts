// 应用内更新 · RN 胶水层（网络 / 文件 / 原生安装）。
// 发布源：GitHub Releases（源码仓 Ebonyhtx/nibi-go，公开仓 → 匿名 API 可读）。
// RELEASE_REPO 可用 EXPO_PUBLIC_NIBI_RELEASE_REPO 覆盖（构建时烘入；换仓 = 重新出包）。
// 检查失败/无发布一律按"无更新"处理，不打扰用户。
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { installApk, sha256File } from "nibi-updater";

import { digestMatches, resolveUpdate, type GitHubRelease, type UpdateInfo } from "./updater-core";

export const RELEASE_REPO =
  process.env.EXPO_PUBLIC_NIBI_RELEASE_REPO?.trim() || "Ebonyhtx/nibi-go";

export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

/** 查询最新 Release；比当前新返回 UpdateInfo，否则 null（含 404/网络失败）。 */
export async function checkForUpdate(
  repo = RELEASE_REPO,
  current = currentAppVersion(),
): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as GitHubRelease;
    return resolveUpdate(release, current);
  } catch {
    return null;
  }
}

export interface DownloadResult {
  apkPath: string;
  verified: boolean;
}

/** 下载 APK 到缓存目录并做 SHA-256 校验（不匹配即丢弃并报错）。
 *  无摘要直接拒装（fail-closed）：GitHub 会为每个上传资产算 digest，缺失说明发布流程有问题。 */
export async function downloadUpdate(info: UpdateInfo): Promise<DownloadResult> {
  if (!info.sha256) {
    throw new Error("更新包缺少 SHA-256 摘要，已拒绝下载（发布侧需提供 asset digest）");
  }
  const target = `${FileSystem.cacheDirectory}nibi-go-${info.version}.apk`;
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  const result = await FileSystem.downloadAsync(info.apkUrl, target);
  if (result.status !== 200) throw new Error(`下载失败（HTTP ${result.status}）`);
  const actual = sha256File(result.uri);
  if (!actual) throw new Error("无法校验更新包（原生模块缺失）");
  const verified = digestMatches(info.sha256, actual);
  if (!verified) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw new Error("更新包校验失败，已丢弃");
  }
  return { apkPath: result.uri, verified };
}

/** 调起系统安装器（用户确认后完成安装）。 */
export async function installUpdate(apkPath: string): Promise<boolean> {
  return installApk(apkPath);
}
