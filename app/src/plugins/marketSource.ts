// 插件市场公开源配置（NIBI-GO 手机独立市场，与桌面端 CDN/索引彻底隔离）：
//
// 用户可在市场顶部一键切换「国内源 / 国外源」：
// - 国内源（cn）：
//   * 目录索引（Ebonyhtx/nibi-go-market）：优先 jsDelivr / Fastly 公共镜像，GitHub Raw 兜底；
//   * 标准 npm MCP 包：优先淘宝 npmmirror（registry.npmmirror.com），官方 npmjs 兜底；
// - 国外源（global）：
//   * 目录索引：优先 GitHub Raw，jsDelivr 兜底；
//   * 标准 npm MCP 包：优先官方 npm（registry.npmjs.org），npmmirror 兜底。
// 无论走哪个镜像源，索引仍须通过内置 Ed25519 公钥验签，ZIP 包验 SHA-256，npm 包验 SRI integrity。

import { File, Paths } from "expo-file-system";

import { pickText } from "../i18n";
import { npmRegistriesForRegion, type NpmMarketRegion } from "./npmRegistry";

export type MarketRegion = NpmMarketRegion;

export const CN_MARKET_INDEX_URLS = [
  "https://cdn.jsdelivr.net/gh/Ebonyhtx/nibi-go-market@main/index.json",
  "https://fastly.jsdelivr.net/gh/Ebonyhtx/nibi-go-market@main/index.json",
  "https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/index.json",
] as const;

export const GLOBAL_MARKET_INDEX_URLS = [
  "https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/index.json",
  "https://cdn.jsdelivr.net/gh/Ebonyhtx/nibi-go-market@main/index.json",
] as const;

/** 默认导出国内源列表以兼容旧调用点。 */
export const MARKET_INDEX_URLS = CN_MARKET_INDEX_URLS;
export const MARKET_INDEX_URL = MARKET_INDEX_URLS[0];

export function marketIndexUrlsForRegion(region: MarketRegion): readonly string[] {
  return region === "cn" ? CN_MARKET_INDEX_URLS : GLOBAL_MARKET_INDEX_URLS;
}

export function npmRegistryForRegion(region: MarketRegion): string {
  return npmRegistriesForRegion(region)[0]!;
}

export { npmRegistriesForRegion };

export function marketRegionLabel(region: MarketRegion): string {
  return region === "cn" ? pickText("国内源", "CN Mirror") : pickText("国外源", "Global");
}

/**
 * 把索引或个人源里的插件包下载地址按当前「国内源 / 国外源」展开为按优先级排列的候选 URL 列表：
 * - GitHub Raw / 旧 dl.nibistudio.cn 市场路径 → 国内源优先 jsDelivr + Fastly，国外源优先 GitHub Raw；
 * - npm / npmmirror tarball → 国内源优先 registry.npmmirror.com，国外源优先 registry.npmjs.org。
 */
export function resolvePackageDownloadUrls(url: string, region: MarketRegion): string[] {
  const trimmed = url.trim();
  if (!trimmed) return [];

  // 1) 旧 dl.nibistudio.cn/nibi-go-market/<path> 映射到公开仓库路径
  const legacyCdnMatch = /^https?:\/\/dl\.nibistudio\.cn\/nibi-go-market\/(.+)$/i.exec(trimmed);
  if (legacyCdnMatch) {
    const relPath = legacyCdnMatch[1]!;
    return buildGithubCandidateUrls("Ebonyhtx", "nibi-go-market", "main", relPath, region);
  }

  // 2) GitHub Raw: https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
  const ghRawMatch = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i.exec(
    trimmed,
  );
  if (ghRawMatch) {
    const [, owner, repo, ref, relPath] = ghRawMatch;
    return buildGithubCandidateUrls(owner!, repo!, ref!, relPath!, region);
  }

  // 3) jsDelivr GitHub: https://(cdn|fastly).jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>
  const jsdMatch =
    /^https?:\/\/(?:cdn|fastly)\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@([^/]+)\/(.+)$/i.exec(trimmed);
  if (jsdMatch) {
    const [, owner, repo, ref, relPath] = jsdMatch;
    return buildGithubCandidateUrls(owner!, repo!, ref!, relPath!, region);
  }

  // 4) npm / npmmirror tarball
  if (
    trimmed.startsWith("https://registry.npmjs.org/") ||
    trimmed.startsWith("https://registry.npmmirror.com/")
  ) {
    const suffix = trimmed.replace(/^https:\/\/registry\.(?:npmjs\.org|npmmirror\.com)\//, "");
    const cnUrl = `https://registry.npmmirror.com/${suffix}`;
    const globalUrl = `https://registry.npmjs.org/${suffix}`;
    return region === "cn" ? [cnUrl, globalUrl] : [globalUrl, cnUrl];
  }

  return [trimmed];
}

function buildGithubCandidateUrls(
  owner: string,
  repo: string,
  ref: string,
  relPath: string,
  region: MarketRegion,
): string[] {
  const jsdCdn = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${relPath}`;
  const jsdFastly = `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${ref}/${relPath}`;
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${relPath}`;
  return region === "cn" ? [jsdCdn, jsdFastly, raw] : [raw, jsdCdn, jsdFastly];
}

const PREFS_FILE = "nibi-market-prefs.json";

function prefsFile(): File {
  return new File(Paths.document, PREFS_FILE);
}

let cachedRegion: MarketRegion = "cn";

export function currentMarketRegion(): MarketRegion {
  return cachedRegion;
}

export async function loadMarketRegion(): Promise<MarketRegion> {
  try {
    const file = prefsFile();
    if (!file.exists) return cachedRegion;
    const raw = JSON.parse(await file.text()) as { region?: unknown };
    if (raw.region === "cn" || raw.region === "global") {
      cachedRegion = raw.region;
    }
  } catch {
    // 读不到偏好时沿用默认国内源
  }
  return cachedRegion;
}

export async function saveMarketRegion(region: MarketRegion): Promise<void> {
  cachedRegion = region;
  try {
    const file = prefsFile();
    if (!file.exists) file.create();
    await file.write(JSON.stringify({ region }));
  } catch {
    // 持久化失败不阻塞内存态切换
  }
}
