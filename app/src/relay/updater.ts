// 应用内更新 · RN 胶水层（网络 / 文件 / 原生安装）。
//
// 发布源：
// - 国内主源：dl.nibistudio.cn 上的签名清单 update.json + APK；
// - 全球兜底：GitHub Releases（源码仓 Ebonyhtx/nibi-go，公开仓 → 匿名 API 可读）。
// RELEASE_REPO / UPDATE_MANIFEST_URL 可用 EXPO_PUBLIC_* 覆盖（构建时烘入；换仓 = 重新出包）。
// 检查失败/无发布一律按"无更新"处理，不打扰用户；但 UI 会区分"检查失败"与"已是最新"。
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { verifyDetachedSignature } from "@nibi-go/market-index";
import { downloadApk, installApk, sha256File } from "nibi-updater";

import { pickText } from "../i18n";
import {
  digestMatches,
  parseUpdateManifest,
  resolveManifestUpdate,
  resolveUpdate,
  type GitHubRelease,
  type UpdateInfo,
} from "./updater-core";

export const RELEASE_REPO =
  process.env.EXPO_PUBLIC_NIBI_RELEASE_REPO?.trim() || "Ebonyhtx/nibi-go";

/** dl 上的签名清单；可用 EXPO_PUBLIC_NIBI_UPDATE_MANIFEST 覆盖成完整 URL。 */
export const UPDATE_MANIFEST_URL =
  process.env.EXPO_PUBLIC_NIBI_UPDATE_MANIFEST?.trim() ||
  "https://dl.nibistudio.cn/nibi-go-app/update.json";

const MANIFEST_TIMEOUT_MS = 5_000;
const GITHUB_TIMEOUT_MS = 8_000;
const MAX_MANIFEST_BYTES = 64 * 1024;

function allowedDownloadHosts(): Set<string> {
  const hosts = new Set([
    "dl.nibistudio.cn",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
  ]);
  try {
    hosts.add(new URL(UPDATE_MANIFEST_URL).hostname);
  } catch {
    // 自定义清单地址不合法时只保留固定白名单。
  }
  return hosts;
}

function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && allowedDownloadHosts().has(parsed.hostname);
  } catch {
    return false;
  }
}

export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

/** 当前安装包的 versionCode；开发/旧运行时可能拿不到，返回 0。 */
export function currentAppVersionCode(): number {
  const native = Number(Constants.nativeBuildVersion);
  if (Number.isInteger(native) && native > 0) return native;
  const configCode = Number(
    (Constants.expoConfig as { android?: { versionCode?: unknown } } | null)?.android?.versionCode,
  );
  return Number.isInteger(configCode) && configCode > 0 ? configCode : 0;
}

export type UpdateCheckResult =
  | { status: "update"; info: UpdateInfo; source: "cdn" | "github" }
  | { status: "none"; source: "cdn" | "github" }
  | { status: "error"; reason: string; details?: string };

/** 清单只有 1–2 KB；加时间戳避免边缘缓存把「有新版本」压成旧结果。 */
function withCacheBust(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json, text/plain" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 国内主源：签名清单 update.json + .sig。 */
async function checkCdn(
  currentVersion: string,
  currentVersionCode: number,
): Promise<UpdateCheckResult> {
  const response = await fetchWithTimeout(
    withCacheBust(UPDATE_MANIFEST_URL),
    MANIFEST_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error(pickText("更新清单超过大小上限", "Update manifest exceeds size limit"));
  }
  const bytes = new Uint8Array(buffer);

  const sigResponse = await fetchWithTimeout(
    withCacheBust(`${UPDATE_MANIFEST_URL}.sig`),
    MANIFEST_TIMEOUT_MS,
  );
  if (!sigResponse.ok) throw new Error(`签名 HTTP ${sigResponse.status}`);
  const signature = (await sigResponse.text()).trim();
  if (!verifyDetachedSignature(bytes, signature)) {
    throw new Error(pickText("更新清单签名校验失败", "Update manifest signature verification failed"));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(pickText("更新清单不是合法 JSON", "Update manifest is not valid JSON"));
  }
  const parsed = parseUpdateManifest(raw);
  if (!parsed.ok) throw new Error(parsed.reason);
  const info = resolveManifestUpdate(parsed.manifest, currentVersion, currentVersionCode);
  return info
    ? { status: "update", info, source: "cdn" }
    : { status: "none", source: "cdn" };
}

/** 全球兜底：GitHub Releases。 */
async function checkGitHub(
  repo: string,
  currentVersion: string,
): Promise<UpdateCheckResult> {
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/releases/latest`,
    GITHUB_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const release = (await response.json()) as GitHubRelease;
  const info = resolveUpdate(release, currentVersion);
  return info
    ? { status: "update", info, source: "github" }
    : { status: "none", source: "github" };
}

/**
 * 检查更新：dl 签名清单优先，失败才回退 GitHub。
 * 两者都失败返回 error（不再伪装成"已是最新"）。
 */
export async function checkForUpdate(
  repo = RELEASE_REPO,
  current = currentAppVersion(),
  currentVersionCode = currentAppVersionCode(),
): Promise<UpdateCheckResult> {
  const failures: string[] = [];
  try {
    return await checkCdn(current, currentVersionCode);
  } catch (error) {
    failures.push(`cdn: ${errorText(error)}`);
  }
  try {
    return await checkGitHub(repo, current);
  } catch (error) {
    failures.push(`github: ${errorText(error)}`);
  }
  return {
    status: "error",
    reason: pickText("检查更新失败：网络或更新源不可达", "Update check failed: network or source unavailable"),
    details: failures.join("; "),
  };
}

export interface DownloadResult {
  apkPath: string;
  verified: boolean;
}

export interface DownloadOptions {
  onProgress?: (progress: { loaded: number; total: number | null }) => void;
  signal?: AbortSignal;
}

function isCancelledError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "E_CANCELLED"
  );
}

/** 下载 APK 到缓存目录并做 SHA-256 校验（不匹配即丢弃并报错）。
 *  无摘要直接拒装（fail-closed）：发布清单未提供 sha256 时宁可失败。 */
export async function downloadUpdate(
  info: UpdateInfo,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  if (!info.sha256) {
    throw new Error(
      pickText(
        "更新包缺少 SHA-256 摘要，已拒绝下载（发布侧需提供 asset digest）",
        "Update package is missing a SHA-256 digest and was rejected (release must provide asset digest)",
      ),
    );
  }
  const target = `${FileSystem.cacheDirectory}nibi-go-${info.versionCode ?? info.version}.apk`;
  const urls = (info.urls.length > 0 ? info.urls : [info.apkUrl]).filter(isAllowedDownloadUrl);
  if (urls.length === 0) {
    throw new Error(
      pickText("更新包地址不在允许的下载域名内", "Update package URL is not on an allowed download host"),
    );
  }

  try {
    const nativeResult = await downloadApk(
      urls,
      target,
      info.sha256,
      info.size ?? 0,
      options.onProgress,
    );
    if (!nativeResult.verified) {
      throw new Error(pickText("更新包校验失败", "Update package verification failed"));
    }
    return { apkPath: nativeResult.path, verified: true };
  } catch (error) {
    if (isCancelledError(error)) {
      throw new Error(pickText("更新下载已取消", "Update download cancelled"));
    }
    // 原生模块缺失时退回 JS 下载；网络/校验失败也会走到这里，逐个源重试。
    if (__DEV__) console.warn("[nibigo] native update download failed", error);
    return downloadUpdateFallback(urls, target, info, options);
  }
}

async function downloadUpdateFallback(
  urls: string[],
  target: string,
  info: UpdateInfo,
  options: DownloadOptions,
): Promise<DownloadResult> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      const result = await FileSystem.downloadAsync(url, target);
      if (result.status !== 200) {
        throw new Error(
          pickText(`下载失败（HTTP ${result.status}）`, `Download failed (HTTP ${result.status})`),
        );
      }
      const actual = sha256File(result.uri);
      if (!actual) {
        throw new Error(
          pickText(
            "无法校验更新包（文件不可读）",
            "Unable to verify update package (file unreadable)",
          ),
        );
      }
      if (!digestMatches(info.sha256, actual)) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
        throw new Error(
          pickText("更新包校验失败，已丢弃", "Update package checksum verification failed and was discarded"),
        );
      }
      options.onProgress?.({ loaded: info.size ?? 0, total: info.size ?? null });
      return { apkPath: result.uri, verified: true };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 调起系统安装器（用户确认后完成安装）。 */
export async function installUpdate(apkPath: string): Promise<boolean> {
  return installApk(apkPath);
}
