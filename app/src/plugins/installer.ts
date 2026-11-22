// 市场与个人插件的安装/更新/卸载：
// - 标准 ZIP（支持 nibi-go.plugin.json、.nibi-plugin/.claude-plugin/.codex-plugin/plugin.json、纯 skills/commands）：
//   下载 → sha256 → 解包与原生二进制拦截 → 清单适配与核验 → 原子替换目录；
// - 标准 npm MCP 包（纯 JS）：
//   按国内/国外镜像拉取元数据与预检 → 随包内置 Node/npm `--ignore-scripts` 安装到 staging →
//   原生二进制扫描与 integrity 校验 → 生成宿主/内核清单 → 原子替换目录。
//
// 目录布局与内置插件一致：filesDir/plugins/<id>/...
// 安装失败不动现有目录（staging → 替换，旧目录先移到 .trash 再删）。

import { Directory, File, Paths } from "expo-file-system";
import { unzipSync } from "fflate";
import { installNpmPackageNative } from "nibi-kernel-host";

import {
  verifyPackageDigest,
  type MarketPluginEntry,
  type NpmEnvSpec,
} from "@nibi-go/market-index";
import { readPluginManifest, type PluginManifest } from "@nibi-go/plugin-contract";

import { fetchBytesWithProgress } from "./fetchBytes";
import { ensureLicenseLoaded, pluginLicenseDecision } from "./license";
import {
  currentMarketRegion,
  resolvePackageDownloadUrls,
  type MarketRegion,
} from "./marketSource";
import {
  buildNpmPluginManifest,
  fetchNpmPackageMetadata,
  inspectNpmPackageJson,
  npmPluginIdFor,
  parseNpmSpec,
} from "./npmRegistry";
import { forgetInstalledPlugin, recordInstalledPlugin } from "./paid";
import {
  inspectPluginArchive,
  MANIFEST_FILE,
  STANDARD_MANIFEST_PATHS,
} from "./packageFiles";
import { BUNDLED_PLUGINS } from "./samples";
import { hostProfile, synthesizeKernelFilesForManifest } from "./store";

const PLUGINS_DIR = "plugins";
const SOURCE_META_FILE = ".nibi-go-source.json";
const MAX_PERSONAL_ARCHIVE_BYTES = 16 * 1024 * 1024;

export interface PluginSourceMeta {
  kind: "nibi-go" | "standard" | "skill-bundle" | "npm";
  kernelName?: string;
  npmPackage?: string;
  npmVersion?: string;
  integrity?: string;
  registry?: string;
  origin?: "market" | "personal" | "npm-search" | "local-zip";
  installedAt: string;
}

export type InstallOutcome =
  | { ok: true; dir: string; manifest: PluginManifest; warnings?: string[] }
  | { ok: false; reason: string };

function pluginsRoot(): Directory {
  return new Directory(Paths.document, PLUGINS_DIR);
}

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//u, "");
}

/** 安装目录名直接用插件 id（id 已由索引/清单 schema 限制为安全字符）。 */
export function pluginDirOf(entry: Pick<MarketPluginEntry, "id">): string {
  return entry.id;
}

/** 已安装插件的清单（没有/读不出返回 null）。 */
export function readInstalledManifest(dir: string): PluginManifest | null {
  try {
    const pluginDir = new Directory(pluginsRoot(), dir);
    const file = new File(pluginDir, MANIFEST_FILE);
    if (!file.exists) return null;
    const parsed = readPluginManifest(JSON.parse(file.textSync()), hostProfile(), dir);
    return parsed.status === "ready" ? parsed.manifest : null;
  } catch {
    return null;
  }
}

function safeDeleteDir(dir: Directory): void {
  if (!dir.exists) return;
  try {
    dir.delete();
  } catch {
    // 清理失败不覆盖主错误。
  }
}

/**
 * 校验并原子落盘一份 ZIP 插件包字节（市场包、标准跨端包与个人本地/直链 ZIP 共用）。
 */
export async function installPluginArchiveBytes(
  bytes: Uint8Array,
  options: {
    expectedId?: string;
    expectedVersion?: string;
    expectedSha256?: string;
    paid?: boolean;
    origin?: PluginSourceMeta["origin"];
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

  let rawManifest: Record<string, unknown>;
  try {
    const parsedJson: unknown = JSON.parse(inspection.manifestText);
    if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
      return { ok: false, reason: "插件清单不是合法 JSON 对象" };
    }
    rawManifest = parsedJson as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: `清单解析失败：${error instanceof Error ? error.message : String(error)}` };
  }

  // 标准包/纯技能包在按市场索引安装时，将宿主侧 id/version 与索引对齐（内核侧仍保留标准 plugin.json 中的 name）。
  const effectiveManifestRaw: Record<string, unknown> =
    inspection.formatKind === "nibi-go"
      ? rawManifest
      : {
          ...rawManifest,
          ...(options.expectedId ? { id: options.expectedId } : {}),
          ...(options.expectedVersion ? { version: options.expectedVersion } : {}),
        };

  const candidateId =
    options.expectedId ??
    (typeof effectiveManifestRaw.id === "string" ? effectiveManifestRaw.id.trim() : "");
  if (!candidateId || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(candidateId)) {
    return { ok: false, reason: "插件清单缺少合法的 id 字段" };
  }
  if (BUNDLED_PLUGINS.some((plugin) => plugin.dir === candidateId)) {
    return { ok: false, reason: "与内置插件目录冲突" };
  }

  const parsed = readPluginManifest(effectiveManifestRaw, hostProfile(), candidateId);
  if (parsed.status !== "ready") {
    return { ok: false, reason: `清单不可用：${parsed.reason ?? "未知原因"}` };
  }
  if (options.expectedId && parsed.manifest.id !== options.expectedId) {
    return { ok: false, reason: `清单 id（${parsed.manifest.id}）与索引不一致` };
  }
  if (
    inspection.formatKind === "nibi-go" &&
    options.expectedVersion &&
    parsed.manifest.version !== options.expectedVersion
  ) {
    return { ok: false, reason: `清单版本（${parsed.manifest.version}）与索引不一致` };
  }

  const dir = parsed.manifest.id;
  const root = pluginsRoot();
  root.create({ intermediates: true, idempotent: true });
  const staging = new Directory(root, `.staging-${dir}-${Date.now()}`);
  const target = new Directory(root, dir);
  const trash = new Directory(root, `.trash-${dir}-${Date.now()}`);

  try {
    staging.create({ intermediates: true, idempotent: true });
    for (const file of inspection.files) {
      const destination = new File(staging, file.path);
      destination.create({ intermediates: true, overwrite: true });
      destination.write(file.bytes);
    }

    // 写入合成文件（例如标准包的宿主映射清单、纯技能包的 `.nibi-plugin/plugin.json`）。
    const hasStandardManifest =
      inspection.files.some((file) =>
        (STANDARD_MANIFEST_PATHS as readonly string[]).includes(file.path),
      ) ||
      inspection.synthesizedFiles.some((file) =>
        (STANDARD_MANIFEST_PATHS as readonly string[]).includes(file.path),
      );
    for (const synth of inspection.synthesizedFiles) {
      const content =
        synth.path === MANIFEST_FILE
          ? `${JSON.stringify(effectiveManifestRaw, null, 2)}\n`
          : synth.content;
      const destination = new File(staging, synth.path);
      destination.create({ intermediates: true, overwrite: true });
      destination.write(content);
    }

    // 原生 nibi-go 插件若带 skills/commands 但未自带 `.nibi-plugin/plugin.json`，自动补齐给内核发现。
    if (inspection.formatKind === "nibi-go" && !hasStandardManifest) {
      const kernelFiles = synthesizeKernelFilesForManifest(effectiveManifestRaw, dir);
      for (const kf of kernelFiles) {
        const destination = new File(staging, kf.path);
        destination.create({ intermediates: true, overwrite: true });
        destination.write(kf.content);
      }
    }

    const sourceMeta: PluginSourceMeta = {
      kind: inspection.formatKind,
      ...(inspection.kernelName ? { kernelName: inspection.kernelName } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      installedAt: new Date().toISOString(),
    };
    const metaFile = new File(staging, SOURCE_META_FILE);
    metaFile.create({ intermediates: true, overwrite: true });
    metaFile.write(`${JSON.stringify(sourceMeta, null, 2)}\n`);

    if (target.exists) target.move(trash);
    staging.move(target);
    safeDeleteDir(trash);
  } catch (error) {
    safeDeleteDir(staging);
    return { ok: false, reason: `写入失败：${error instanceof Error ? error.message : String(error)}` };
  }

  await recordInstalledPlugin(dir, parsed.manifest.version, Boolean(options.paid)).catch(() => {
    // 记录失败不影响已落盘的插件；门禁仍可从市场快照取 paid。
  });
  return { ok: true, dir, manifest: parsed.manifest };
}

/** 安装一个标准纯 JS npm MCP 包（市场 npm 条目与个人/搜索安装共用）。 */
export async function installNpmPlugin(params: {
  packageName: string;
  version?: string;
  expectedId?: string;
  displayName?: string;
  description?: string;
  expectedIntegrity?: string;
  bin?: string;
  args?: readonly string[];
  env?: readonly NpmEnvSpec[];
  serverName?: string;
  alwaysLoad?: boolean;
  timeoutMs?: number;
  strictInstallScripts?: boolean;
  paid?: boolean;
  origin?: PluginSourceMeta["origin"];
  region?: MarketRegion;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}): Promise<InstallOutcome> {
  const region = params.region ?? currentMarketRegion();
  const dir = params.expectedId ?? npmPluginIdFor(params.packageName);
  if (BUNDLED_PLUGINS.some((plugin) => plugin.dir === dir)) {
    return { ok: false, reason: "与内置插件目录冲突" };
  }

  params.onStatus?.(`正在读取 ${params.packageName} 元数据…`);
  const metaResult = await fetchNpmPackageMetadata(params.packageName, params.version, region, {
    signal: params.signal,
  });
  if (!metaResult.ok) return { ok: false, reason: metaResult.reason };
  const meta = metaResult.meta;

  if (params.expectedIntegrity && meta.dist?.integrity && meta.dist.integrity !== params.expectedIntegrity) {
    return {
      ok: false,
      reason: `npm 包 integrity 与签名索引不一致（已拒绝安装）`,
    };
  }

  // 下载前预检：拦截系统不兼容、node-gyp / 原生编译脚本与无入口包。
  const precheck = inspectNpmPackageJson(meta, {
    packageName: meta.name,
    preferredBin: params.bin,
    strictInstallScripts: params.strictInstallScripts === true,
  });
  if (!precheck.ok) return { ok: false, reason: precheck.reason };

  const root = pluginsRoot();
  root.create({ intermediates: true, idempotent: true });
  const stagingName = `.staging-${dir}-${Date.now()}`;
  const staging = new Directory(root, stagingName);
  const target = new Directory(root, dir);
  const trash = new Directory(root, `.trash-${dir}-${Date.now()}`);

  try {
    staging.create({ intermediates: true, idempotent: true });
    const stagingPath = stripFileScheme(staging.uri);
    const integrityToCheck = params.expectedIntegrity ?? meta.dist?.integrity;

    params.onStatus?.(`正在通过内置 npm 安装 ${meta.name}@${meta.version}…`);
    const nativeOutcome = await installNpmPackageNative({
      packageName: meta.name,
      version: meta.version,
      registry: meta.registry,
      targetDir: stagingPath,
      expectedIntegrity: integrityToCheck,
    });
    if (!nativeOutcome.ok) {
      safeDeleteDir(staging);
      return { ok: false, reason: nativeOutcome.error ?? "内置 npm 安装失败" };
    }

    let installedPkgJson: Record<string, unknown> = meta as unknown as Record<string, unknown>;
    if (nativeOutcome.packageJson) {
      try {
        const parsedPkg: unknown = JSON.parse(nativeOutcome.packageJson);
        if (typeof parsedPkg === "object" && parsedPkg !== null && !Array.isArray(parsedPkg)) {
          installedPkgJson = parsedPkg as Record<string, unknown>;
        }
      } catch {
        // 用元数据兜底
      }
    }

    const postcheck = inspectNpmPackageJson(
      installedPkgJson as Parameters<typeof inspectNpmPackageJson>[0],
      {
        packageName: meta.name,
        preferredBin: params.bin,
        strictInstallScripts: params.strictInstallScripts === true,
      },
    );
    if (!postcheck.ok) {
      safeDeleteDir(staging);
      return { ok: false, reason: postcheck.reason };
    }

    const entryFile = new File(staging, postcheck.pluginEntry);
    if (!entryFile.exists) {
      safeDeleteDir(staging);
      return { ok: false, reason: `安装后缺少声明的入口脚本：${postcheck.pluginEntry}` };
    }

    const displayName = (
      params.displayName?.trim() ||
      (typeof installedPkgJson.name === "string" ? installedPkgJson.name : meta.name)
    ).slice(0, 64);
    const description =
      params.description?.trim() ||
      (typeof installedPkgJson.description === "string"
        ? installedPkgJson.description.trim()
        : meta.description);

    const { hostManifest, kernelManifest } = buildNpmPluginManifest({
      id: dir,
      name: displayName,
      version: nativeOutcome.resolvedVersion ?? meta.version,
      description,
      packageName: meta.name,
      pluginEntry: postcheck.pluginEntry,
      serverName: params.serverName,
      args: params.args,
      env: params.env,
      alwaysLoad: params.alwaysLoad,
      timeoutMs: params.timeoutMs,
    });

    const parsed = readPluginManifest(hostManifest, hostProfile(), dir);
    if (parsed.status !== "ready") {
      safeDeleteDir(staging);
      return { ok: false, reason: `生成的插件清单不可用：${parsed.reason ?? "未知原因"}` };
    }

    const hostFile = new File(staging, MANIFEST_FILE);
    hostFile.create({ intermediates: true, overwrite: true });
    hostFile.write(`${JSON.stringify(hostManifest, null, 2)}\n`);

    const kernelFile = new File(staging, ".nibi-plugin/plugin.json");
    kernelFile.create({ intermediates: true, overwrite: true });
    kernelFile.write(`${JSON.stringify(kernelManifest, null, 2)}\n`);

    const sourceMeta: PluginSourceMeta = {
      kind: "npm",
      kernelName: dir,
      npmPackage: meta.name,
      npmVersion: nativeOutcome.resolvedVersion ?? meta.version,
      ...(nativeOutcome.resolvedIntegrity ?? integrityToCheck
        ? { integrity: nativeOutcome.resolvedIntegrity ?? integrityToCheck }
        : {}),
      registry: meta.registry,
      origin: params.origin ?? "personal",
      installedAt: new Date().toISOString(),
    };
    const metaFile = new File(staging, SOURCE_META_FILE);
    metaFile.create({ intermediates: true, overwrite: true });
    metaFile.write(`${JSON.stringify(sourceMeta, null, 2)}\n`);

    if (target.exists) target.move(trash);
    staging.move(target);
    safeDeleteDir(trash);

    await recordInstalledPlugin(dir, parsed.manifest.version, Boolean(params.paid)).catch(() => {});
    return {
      ok: true,
      dir,
      manifest: parsed.manifest,
      ...(postcheck.warnings.length > 0 ? { warnings: postcheck.warnings } : {}),
    };
  } catch (error) {
    safeDeleteDir(staging);
    return {
      ok: false,
      reason: `npm 安装异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function installMarketPlugin(
  entry: MarketPluginEntry,
  options: {
    region?: MarketRegion;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number | null) => void;
    onStatus?: (message: string) => void;
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

  if (entry.package.format === "npm") {
    return installNpmPlugin({
      packageName: entry.package.name,
      version: entry.package.version,
      expectedId: entry.id,
      displayName: entry.name,
      description: entry.description,
      expectedIntegrity: entry.package.integrity,
      bin: entry.package.bin,
      args: entry.package.args,
      env: entry.package.env,
      serverName: entry.package.serverName,
      alwaysLoad: entry.package.alwaysLoad,
      timeoutMs: entry.package.timeoutMs,
      strictInstallScripts: true,
      paid: entry.paid !== undefined,
      origin: "market",
      region: options.region,
      signal: options.signal,
      onStatus: options.onStatus,
    });
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
    origin: "market",
  });
}

/** 从直链 ZIP URL 下载并安装个人插件（支持标准 .nibi-plugin/.claude-plugin/.codex-plugin/skills ZIP）。 */
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
  return installPluginArchiveBytes(bytes, { origin: "personal" });
}

/** 从 npm 包名/spec/链接安装个人或社区搜索到的纯 JS MCP 包。 */
export async function installPersonalNpmPlugin(
  rawSpec: string,
  options: {
    displayName?: string;
    description?: string;
    region?: MarketRegion;
    origin?: "personal" | "npm-search";
    signal?: AbortSignal;
    onStatus?: (message: string) => void;
  } = {},
): Promise<InstallOutcome> {
  const parsed = parseNpmSpec(rawSpec);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return installNpmPlugin({
    packageName: parsed.name,
    version: parsed.version,
    displayName: options.displayName,
    description: options.description,
    strictInstallScripts: false,
    origin: options.origin ?? "personal",
    region: options.region,
    signal: options.signal,
    onStatus: options.onStatus,
  });
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
