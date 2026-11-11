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
  notes?: string;
  apkUrl: string;
  sha256?: string;
  size?: number;
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
