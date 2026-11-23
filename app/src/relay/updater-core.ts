// 应用内更新 · 纯函数核心（Node 可测；不含网络/文件系统/原生调用）。
// 发布源：GitHub Releases（仓库与资产命名后续按实际发布方式调整；私有仓需要公开发布仓或
// 自建分发——分发方式决策前，本模块只做协议无关的解析与比较）。

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  /** 新式 API 提供：sha256:<hex>；旧式可能缺失。 */
  digest?: string | null;
  size?: number;
}

export interface GitHubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GitHubReleaseAsset[];
}

export interface UpdateInfo {
  version: string;
  /** Android versionCode；GitHub Release 路径可能没有。 */
  versionCode?: number;
  /** 低于该 versionCode 的客户端必须升级。 */
  minVersionCode?: number;
  notes?: string;
  /** 第一个下载地址（兼容旧调用点）；完整候选见 urls。 */
  apkUrl: string;
  urls: string[];
  sha256?: string;
  size?: number;
}

/** 签名清单 `update.json`：dl 主源与 GitHub 兜底共用同一份权威版本信息。 */
export interface UpdateManifest {
  schemaVersion: 1;
  kind: "nibi-go-app-update";
  generatedAt: string;
  version: string;
  versionCode: number;
  minVersionCode?: number;
  notes?: string;
  apk: {
    sha256: string;
    size: number;
    urls: string[];
  };
}

export type UpdateManifestParse =
  | { ok: true; manifest: UpdateManifest }
  | { ok: false; reason: string };

const SHA256_RE = /^[0-9a-fA-F]{64}$/u;
const MAX_APK_BYTES = 300 * 1024 * 1024;
const MAX_MANIFEST_URLS = 8;
const MAX_URL_LENGTH = 2048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failManifest(reason: string): UpdateManifestParse {
  return { ok: false, reason };
}

/** 解析并校验签名清单形状；网络/验签在调用方完成。 */
export function parseUpdateManifest(raw: unknown): UpdateManifestParse {
  if (!isRecord(raw)) return failManifest("清单不是 JSON 对象");
  if (raw.schemaVersion !== 1) return failManifest("schemaVersion 必须是 1");
  if (raw.kind !== "nibi-go-app-update") return failManifest("清单 kind 不匹配");
  if (typeof raw.version !== "string" || !parseVersion(raw.version)) {
    return failManifest("version 不是合法语义化版本");
  }
  if (!Number.isInteger(raw.versionCode) || (raw.versionCode as number) <= 0) {
    return failManifest("versionCode 必须是正整数");
  }
  if (
    raw.minVersionCode !== undefined &&
    (!Number.isInteger(raw.minVersionCode) || (raw.minVersionCode as number) <= 0)
  ) {
    return failManifest("minVersionCode 必须是正整数");
  }
  if (raw.notes !== undefined && (typeof raw.notes !== "string" || raw.notes.length > 8000)) {
    return failManifest("notes 过长或不是字符串");
  }
  if (!isRecord(raw.apk)) return failManifest("缺少 apk 对象");
  const apk = raw.apk;
  if (typeof apk.sha256 !== "string" || !SHA256_RE.test(apk.sha256)) {
    return failManifest("apk.sha256 必须是 64 位 hex");
  }
  if (
    !Number.isInteger(apk.size) ||
    (apk.size as number) <= 0 ||
    (apk.size as number) > MAX_APK_BYTES
  ) {
    return failManifest("apk.size 不合法");
  }
  if (!Array.isArray(apk.urls) || apk.urls.length === 0 || apk.urls.length > MAX_MANIFEST_URLS) {
    return failManifest("apk.urls 必须是 1–8 个地址");
  }
  const urls: string[] = [];
  for (const item of apk.urls) {
    if (typeof item !== "string" || item.length > MAX_URL_LENGTH) {
      return failManifest("apk.urls 含非法地址");
    }
    let parsed: URL;
    try {
      parsed = new URL(item);
    } catch {
      return failManifest("apk.urls 含非法地址");
    }
    if (parsed.protocol !== "https:") return failManifest("apk.urls 只接受 https");
    if (!urls.includes(item)) urls.push(item);
  }
  return {
    ok: true,
    manifest: {
      schemaVersion: 1,
      kind: "nibi-go-app-update",
      generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
      version: raw.version,
      versionCode: raw.versionCode as number,
      ...(raw.minVersionCode !== undefined
        ? { minVersionCode: raw.minVersionCode as number }
        : {}),
      ...(typeof raw.notes === "string" && raw.notes ? { notes: raw.notes } : {}),
      apk: {
        sha256: apk.sha256.toLowerCase(),
        size: apk.size as number,
        urls,
      },
    },
  };
}

/** 签名清单 → UpdateInfo；versionCode 未前进（或开发环境下的 semver 未前进）返回 null。 */
export function resolveManifestUpdate(
  manifest: UpdateManifest,
  currentVersion: string,
  currentVersionCode = 0,
): UpdateInfo | null {
  if (manifest.versionCode <= currentVersionCode) return null;
  // 开发/未知 versionCode 时再要求 semver 前进，避免把同版本重签当成更新。
  if (currentVersionCode <= 0) {
    const comparison = compareVersions(manifest.version, currentVersion);
    if (comparison === null || comparison <= 0) return null;
  }
  return {
    version: manifest.version,
    versionCode: manifest.versionCode,
    ...(manifest.minVersionCode !== undefined
      ? { minVersionCode: manifest.minVersionCode }
      : {}),
    ...(manifest.notes ? { notes: manifest.notes } : {}),
    apkUrl: manifest.apk.urls[0]!,
    urls: manifest.apk.urls,
    sha256: manifest.apk.sha256,
    size: manifest.apk.size,
  };
}

/** 解析 "v1.2.3" / "1.2.3" / "1.2.3-beta.1" → 数值段 + 预发布标记。 */
export function parseVersion(raw: string): { parts: number[]; prerelease: string | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(raw.trim());
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** 语义化比较：a>b 返回 1，相等 0，a<b 返回 -1；无法解析返回 null。 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i]! > right.parts[i]! ? 1 : -1;
  }
  // 正式版 > 预发布版（semver 约定）
  if (left.prerelease === null && right.prerelease !== null) return 1;
  if (left.prerelease !== null && right.prerelease === null) return -1;
  if (left.prerelease === right.prerelease) return 0;
  return left.prerelease! > right.prerelease! ? 1 : -1;
}

/** 从 release 里选 Android APK 资产（优先 arm64-v8a 命名，其次任意 .apk）。 */
export function selectApkAsset(release: GitHubRelease): GitHubReleaseAsset | null {
  const apks = (release.assets ?? []).filter((asset) => asset.name.toLowerCase().endsWith(".apk"));
  if (apks.length === 0) return null;
  return (
    apks.find((asset) => /arm64/i.test(asset.name)) ??
    apks.find((asset) => !/x86|universal|debug/i.test(asset.name)) ??
    apks[0]!
  );
}

/** release → UpdateInfo（若比 currentVersion 新）；解析失败/无资产返回 null。 */
export function resolveUpdate(
  release: GitHubRelease | null,
  currentVersion: string,
): UpdateInfo | null {
  if (!release || release.draft || release.prerelease) return null;
  const comparison = compareVersions(release.tag_name, currentVersion);
  if (comparison === null || comparison <= 0) return null;
  const asset = selectApkAsset(release);
  if (!asset) return null;
  return {
    version: release.tag_name.replace(/^v/, ""),
    ...(release.body ? { notes: release.body } : {}),
    apkUrl: asset.browser_download_url,
    urls: [asset.browser_download_url],
    ...(asset.digest?.startsWith("sha256:")
      ? { sha256: asset.digest.slice("sha256:".length).toLowerCase() }
      : {}),
    ...(typeof asset.size === "number" ? { size: asset.size } : {}),
  };
}

/** 校验下载文件摘要（hex，大小写不敏感）。**无期望值即判失败**（fail-closed）：
 *  发布通道没提供 sha256 时宁可拒装，也不放行未经校验的更新包。 */
export function digestMatches(expectedHex: string | undefined, actualHex: string): boolean {
  if (!expectedHex) return false;
  return expectedHex.trim().toLowerCase() === actualHex.trim().toLowerCase();
}
