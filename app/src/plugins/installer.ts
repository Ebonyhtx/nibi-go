// 市场与个人插件的安装/更新/卸载：下载 → sha256 → 解包 → 清单校验 → 原子替换目录。
//
// 目录布局与内置插件一致：filesDir/plugins/<id>/nibi-go.plugin.json。
// 安装失败不动现有目录（staging → 替换，旧目录先移到 .trash 再删）。

import { Directory, File, Paths } from "expo-file-system";
import { unzipSync } from "fflate";

import { verifyPackageDigest, type MarketPluginEntry } from "@nibi-go/market-index";
import { readPluginManifest, type PluginManifest } from "@nibi-go/plugin-contract";

import { fetchBytesWithProgress } from "./fetchBytes";
import { ensureLicenseLoaded, pluginLicenseDecision } from "./license";
import {
  currentMarketRegion,
  resolvePackageDownloadUrls,
  type MarketRegion,
} from "./marketSource";
import { forgetInstalledPlugin, recordInstalledPlugin } from "./paid";
import { inspectPluginArchive } from "./packageFiles";
import { BUNDLED_PLUGINS } from "./samples";
import { hostProfile } from "./store";

const PLUGINS_DIR = "plugins";
const MAX_PERSONAL_ARCHIVE_BYTES = 16 * 1024 * 1024;

export type InstallOutcome =
  | { ok: true; dir: string; manifest: PluginManifest }
  | { ok: false; reason: string };

function pluginsRoot(): Directory {
  return new Directory(Paths.document, PLUGINS_DIR);
}

/** 安装目录名直接用插件 id（id 已由索引/清单 schema 限制为安全字符）。 */
export function pluginDirOf(entry: Pick<MarketPluginEntry, "id">): string {
  return entry.id;
}

/** 已安装插件的清单（没有/读不出返回 null）。 */
export function readInstalledManifest(dir: string): PluginManifest | null {
  try {
    const file = new File(pluginsRoot(), dir, "nibi-go.plugin.json");
    if (!file.exists) return null;
    const parsed = readPluginManifest(JSON.parse(file.textSync()), hostProfile(), dir);
    return parsed.status === "ready" ? parsed.manifest : null;
  } catch {
    return null;
  }
}

/**
 * 校验并原子落盘一份 ZIP 插件包字节（市场包与个人本地/直链 ZIP 共用同一套解包与清单校验）。
 */
export async function installPluginArchiveBytes(
  bytes: Uint8Array,
  options: {
    expectedId?: string;
    expectedVersion?: string;
    expectedSha256?: string;
    paid?: boolean;
  } = {},
): Promise<InstallOutcome> {
  if (options.expectedSha256 && !verifyPackageDigest(bytes, options.expectedSha256)) {
    return { ok: false, reason: "包摘要与索引不一致（已拒绝安装）" };
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    return { ok: false, reason: `解包失败：${error instanceof Error ? error.message : String(error)}` };
  }
  const inspection = inspectPluginArchive(entries);
  if (!inspection.ok) return { ok: false, reason: inspection.reason };

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(inspection.manifestText);
  } catch (error) {
    return { ok: false, reason: `清单解析失败：${error instanceof Error ? error.message : String(error)}` };
  }

  const candidateId =
    options.expectedId ??
    (typeof rawManifest === "object" &&
    rawManifest !== null &&
    typeof (rawManifest as { id?: unknown }).id === "string"
      ? (rawManifest as { id: string }).id.trim()
      : "");
  if (!candidateId || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(candidateId)) {
    return { ok: false, reason: "插件清单缺少合法的 id 字段" };
  }
  if (BUNDLED_PLUGINS.some((plugin) => plugin.dir === candidateId)) {
    return { ok: false, reason: "与内置插件目录冲突" };
  }

  const parsed = readPluginManifest(rawManifest, hostProfile(), candidateId);
  if (parsed.status !== "ready") {
    return { ok: false, reason: `清单不可用：${parsed.reason ?? "未知原因"}` };
  }
  if (options.expectedId && parsed.manifest.id !== options.expectedId) {
    return { ok: false, reason: `清单 id（${parsed.manifest.id}）与索引不一致` };
  }
  if (options.expectedVersion && parsed.manifest.version !== options.expectedVersion) {
    return { ok: false, reason: `清单版本（${parsed.manifest.version}）与索引不一致` };
  }

  const dir = parsed.manifest.id;
  const root = pluginsRoot();
  root.create({ intermediates: true, idempotent: true });
  const staging = new Directory(root, `.staging-${dir}`);
  const target = new Directory(root, dir);
  const trash = new Directory(root, `.trash-${dir}-${Date.now()}`);
  if (staging.exists) staging.delete();

  try {
    staging.create({ intermediates: true, idempotent: true });
    for (const file of inspection.files) {
      const destination = new File(staging, file.path);
      destination.create({ intermediates: true, overwrite: true });
      destination.write(file.bytes);
    }
    if (target.exists) target.move(trash);
    staging.move(target);
    if (trash.exists) trash.delete();
  } catch (error) {
    if (staging.exists) {
      try {
        staging.delete();
      } catch {
        // 清理失败不影响错误返回。
      }
    }
    return { ok: false, reason: `写入失败：${error instanceof Error ? error.message : String(error)}` };
  }

  await recordInstalledPlugin(dir, parsed.manifest.version, Boolean(options.paid)).catch(() => {
    // 记录失败不影响已落盘的插件；门禁仍可从市场快照取 paid。
  });
  return { ok: true, dir, manifest: parsed.manifest };
}

export async function installMarketPlugin(
  entry: MarketPluginEntry,
  options: {
    region?: MarketRegion;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number | null) => void;
  } = {},
): Promise<InstallOutcome> {
  if (entry.paid) {
    await ensureLicenseLoaded();
    const decision = pluginLicenseDecision(entry.id);
    if (!decision.allowed) return { ok: false, reason: `尚未完成账号授权：${decision.reason}` };
  }
  const dir = pluginDirOf(entry);
  if (BUNDLED_PLUGINS.some((plugin) => plugin.dir === dir)) {
    return { ok: false, reason: "与内置插件目录冲突" };
  }

  const candidateUrls = resolvePackageDownloadUrls(
    entry.package.url,
    options.region ?? currentMarketRegion(),
  );
  let bytes: Uint8Array | null = null;
  let lastError: unknown = null;
  for (const url of candidateUrls) {
    try {
      bytes = await fetchBytesWithProgress(url, entry.package.size + 64 * 1024, {
        signal: options.signal,
        onProgress: options.onProgress,
      });
      break;
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, reason: "已取消" };
      lastError = error;
    }
  }
  if (!bytes) {
    return {
      ok: false,
      reason: `下载失败：${lastError instanceof Error ? lastError.message : String(lastError ?? "无可用源")}`,
    };
  }

  return installPluginArchiveBytes(bytes, {
    expectedId: entry.id,
    expectedVersion: entry.version,
    expectedSha256: entry.package.sha256,
    paid: entry.paid !== undefined,
  });
}

/** 从直链 ZIP URL 下载并安装个人插件。 */
export async function installPersonalUrlPlugin(
  url: string,
  options: {
    region?: MarketRegion;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number | null) => void;
  } = {},
): Promise<InstallOutcome> {
  const candidateUrls = resolvePackageDownloadUrls(url, options.region ?? currentMarketRegion());
  let bytes: Uint8Array | null = null;
  let lastError: unknown = null;
  for (const candidate of candidateUrls) {
    try {
      bytes = await fetchBytesWithProgress(candidate, MAX_PERSONAL_ARCHIVE_BYTES, {
        signal: options.signal,
        onProgress: options.onProgress,
      });
      break;
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, reason: "已取消" };
      lastError = error;
    }
  }
  if (!bytes) {
    return {
      ok: false,
      reason: `下载失败：${lastError instanceof Error ? lastError.message : String(lastError ?? "无可用地址")}`,
    };
  }
  return installPluginArchiveBytes(bytes);
}

/** 卸载非内置插件（只删插件目录；启停状态/设置按 id 保留，重装后沿用）。 */
export async function uninstallMarketPlugin(dir: string): Promise<boolean> {
  if (BUNDLED_PLUGINS.some((plugin) => plugin.dir === dir)) return false;
  const target = new Directory(pluginsRoot(), dir);
  if (!target.exists) return false;
  target.delete();
  await forgetInstalledPlugin(dir).catch(() => {});
  return true;
}
