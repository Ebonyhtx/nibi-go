// 标准 npm 公共源客户端与纯 JS MCP 包验货逻辑（纯 TS，无 RN/Expo 依赖，Node 侧可单测）。
//
// - 支持按「国内源（registry.npmmirror.com）/ 国外源（registry.npmjs.org）」查询与自动回退；
// - 解析用户输入（包名、带版本 spec、或 npmjs.com 链接）；
// - 预检 package.json：拦截不兼容系统、高危安装脚本、原生编译标志，解析确定性的 JS bin 入口；
// - 为安装后的纯 JS npm MCP 生成标准 `nibi-go.plugin.json` 与 `.nibi-plugin/plugin.json`。

import type { NpmEnvSpec } from "@nibi-go/market-index";

import { pickText } from "../i18n";

export type NpmMarketRegion = "cn" | "global";

export const CN_NPM_REGISTRIES = [
  "https://registry.npmmirror.com",
  "https://registry.npmjs.org",
] as const;

export const GLOBAL_NPM_REGISTRIES = [
  "https://registry.npmjs.org",
  "https://registry.npmmirror.com",
] as const;

export function npmRegistriesForRegion(region: NpmMarketRegion): readonly string[] {
  return region === "cn" ? CN_NPM_REGISTRIES : GLOBAL_NPM_REGISTRIES;
}

const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u;
const NATIVE_SCRIPT_HINT_RE = /\b(?:node-gyp|prebuild-install|cmake-js|napi-build|node-pre-gyp|gyp\s+rebuild)\b/iu;

export type ParsedNpmSpec =
  | { ok: true; name: string; version?: string }
  | { ok: false; reason: string };

/** 解析用户输入的 npm 包名 / spec / npmjs.com 链接。 */
export function parseNpmSpec(rawInput: string): ParsedNpmSpec {
  let text = rawInput.trim();
  if (!text) {
    return {
      ok: false,
      reason: pickText(
        "请输入 npm 包名（例如 @modelcontextprotocol/server-sequential-thinking）",
        "Enter an npm package name (e.g. @modelcontextprotocol/server-sequential-thinking)",
      ),
    };
  }

  // 兼容粘贴 npmjs.com / npmmirror.com 网页链接
  const webMatch =
    /^https?:\/\/(?:www\.)?(?:npmjs\.com|npmmirror\.com)\/package\/((?:@[^/\s?#]+\/)?[^/\s?#]+)(?:\/v\/([^\s?#]+))?/iu.exec(
      text,
    );
  if (webMatch) {
    text = webMatch[2] ? `${webMatch[1]}@${webMatch[2]}` : webMatch[1]!;
  }
  // 兼容 `npm:pkg@ver` 或 `npx -y pkg`
  text = text.replace(/^npm:/iu, "").replace(/^npx\s+(?:-y\s+)?/iu, "").trim();

  let name = text;
  let version: string | undefined;
  if (text.startsWith("@")) {
    const slash = text.indexOf("/");
    if (slash < 2) {
      return { ok: false, reason: pickText(`npm 包名不合法：${text}`, `Invalid npm package name: ${text}`) };
    }
    const at = text.indexOf("@", slash + 1);
    if (at > slash) {
      name = text.slice(0, at);
      version = text.slice(at + 1);
    }
  } else {
    const at = text.indexOf("@");
    if (at > 0) {
      name = text.slice(0, at);
      version = text.slice(at + 1);
    }
  }

  name = name.trim();
  if (!NPM_NAME_RE.test(name) || name.length > 214 || name.includes("..")) {
    return { ok: false, reason: pickText(`npm 包名不合法：${name}`, `Invalid npm package name: ${name}`) };
  }
  if (version !== undefined) {
    version = version.trim();
    if (version === "latest") {
      version = undefined;
    } else if (!VERSION_RE.test(version)) {
      return {
        ok: false,
        reason: pickText(
          `请填写精确版本号或留空取最新版（不支持范围写法：${version}）`,
          `Specify an exact version or leave blank for latest (ranges not supported: ${version})`,
        ),
      };
    }
  }
  return { ok: true, name, ...(version ? { version } : {}) };
}

/** 根据 npm 包名生成稳定的 NIBI-GO 插件 ID（符合 ID_RE，≤64 字符）。 */
export function npmPluginIdFor(packageName: string): string {
  const normalized = packageName
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/\//gu, ".")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "");
  const base = `npm.${normalized}`;
  if (base.length <= 64) return base;
  // 超长时保留尾部区分度 + 简短哈希
  let hash = 2166136261;
  for (let i = 0; i < packageName.length; i += 1) {
    hash ^= packageName.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36).slice(0, 6);
  return `${base.slice(0, 57).replace(/[^a-z0-9]+$/u, "")}-${suffix}`;
}

/** 根据 npm 包名推导合法 MCP 服务器名（/^[a-z][a-z0-9_]{1,31}$/）。 */
export function mcpServerNameFor(packageName: string, override?: string): string {
  if (override && /^[a-z][a-z0-9_]{1,31}$/u.test(override)) return override;
  const unscoped = packageName.includes("/") ? packageName.split("/")[1]! : packageName;
  const cleaned = unscoped
    .toLowerCase()
    .replace(/^(?:mcp-server-|server-|mcp-)/u, "")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  const prefixed = /^[a-z]/u.test(cleaned) ? cleaned : `mcp_${cleaned || "tool"}`;
  const trimmed = prefixed.slice(0, 32).replace(/_+$/u, "");
  return trimmed.length >= 2 ? trimmed : "mcp_pkg";
}

export type NpmMobileSuitability = "recommended" | "desktop-only" | "library";

export interface NpmSearchHit {
  name: string;
  version: string;
  description: string;
  author: string;
  date?: string;
  keywords: string[];
  homepage?: string;
  repository?: string;
  looksLikeMcp: boolean;
  /** 手机端适配判定：library=纯 SDK/开发框架库、desktop-only=依赖桌面浏览器或系统。 */
  suitability: NpmMobileSuitability;
  /** 若 suitability === "desktop-only"，展示给用户的简短兼容提醒。 */
  mobileHint?: string;
}

export type PublicBrowseChannelId =
  | "featured"
  | "popular"
  | "official-mcp"
  | "search"
  | "map"
  | "weather"
  | "dev"
  | "chart"
  | "skills";

export interface PublicBrowseChannel {
  id: PublicBrowseChannelId;
  label: string;
  labelEn: string;
  /** 实时 npm 浏览词（单主题词以同时兼容 npmmirror 与 npmjs）；null 表示本地精选/技能频道。 */
  query: string | null;
  /** 频道说明（展示在列表顶部）。 */
  subtitle: string;
  subtitleEn: string;
}

/** 公开市场「可逛」分类频道（全部采用国内 npmmirror 与国外 npmjs 均稳定出流的单主题查询）。 */
export const PUBLIC_BROWSE_CHANNELS: readonly PublicBrowseChannel[] = [
  {
    id: "featured",
    label: "精选",
    labelEn: "Featured",
    query: null,
    subtitle: "验签公开插件 + 手机实测可用的纯 JS MCP 与技能包",
    subtitleEn: "Signed public plugins + mobile-tested pure-JS MCPs & skill packs",
  },
  {
    id: "popular",
    label: "热门 MCP",
    labelEn: "Popular MCP",
    query: "mcp-server",
    subtitle: "按实时热度浏览 npm 开源 MCP 服务器",
    subtitleEn: "Browse popular open-source MCP servers on npm",
  },
  {
    id: "official-mcp",
    label: "MCP 生态",
    labelEn: "Ecosystem",
    query: "modelcontextprotocol server",
    subtitle: "Model Context Protocol 官方与主流社区服务器",
    subtitleEn: "Official and community Model Context Protocol servers",
  },
  {
    id: "search",
    label: "搜索抓取",
    labelEn: "Search & Web",
    query: "mcp search",
    subtitle: "联网搜索、网页抓取与资讯检索 MCP",
    subtitleEn: "Web search, fetching, and information retrieval MCPs",
  },
  {
    id: "map",
    label: "地图出行",
    labelEn: "Maps & Travel",
    query: "mcp map",
    subtitle: "地图导航、POI 检索与出行服务 MCP",
    subtitleEn: "Maps, POI lookup, and navigation MCPs",
  },
  {
    id: "weather",
    label: "天气生活",
    labelEn: "Weather & Life",
    query: "mcp weather",
    subtitle: "天气预报与日常实用工具 MCP",
    subtitleEn: "Weather forecasts and everyday utility MCPs",
  },
  {
    id: "dev",
    label: "开发数据",
    labelEn: "Dev & Data",
    query: "mcp database",
    subtitle: "数据库、云服务与开发辅助 MCP",
    subtitleEn: "Databases, cloud APIs, and developer MCPs",
  },
  {
    id: "chart",
    label: "图表文档",
    labelEn: "Charts & Docs",
    query: "mcp chart",
    subtitle: "数据可视化、思维导图与文档处理 MCP",
    subtitleEn: "Charts, diagrams, and document-processing MCPs",
  },
  {
    id: "skills",
    label: "技能包",
    labelEn: "Skill Packs",
    query: null,
    subtitle: "无需外部密钥、离线即装即用的开源提示词技能包",
    subtitleEn: "Offline-ready open-source prompt skill packs — no API keys needed",
  },
];

const LIBRARY_EXACT_NAMES = new Set([
  "mcp",
  "mcp-server",
  "mcp-proxy",
  "fastmcp",
  "mcp-framework",
  "mcp-evals",
  "ai",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/core",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/server",
  "@modelcontextprotocol/node",
  "@modelcontextprotocol/inspector",
  "@modelcontextprotocol/inspector-server",
  "@modelcontextprotocol/inspector-client",
]);

const LIBRARY_NAME_RE =
  /(?:^|\/)(?:nestjs-mcp|mcp-sdk|mcp-client|mcp-framework|mcp-inspector|mcp-evals|create-mcp|ai-sdk)/iu;
const LIBRARY_DESC_RE =
  /\b(?:typescript\s+sdk|sdk\s+for\s+(?:the\s+)?model\s+context\s+protocol|framework\s+for\s+building\s+mcp|inspector\s+for\s+mcp)\b/iu;

const DESKTOP_BROWSER_RE =
  /\b(?:playwright|puppeteer|chrome-devtools|devtools-mcp|selenium|chromedriver|webdriver)\b/iu;
const DESKTOP_OS_RE =
  /\b(?:applescript|osascript|macos-mcp|mac-mcp|xcode-mcp|iterm-mcp|windows-mcp|win32-mcp|uiautomation|xdotool|desktop-commander|electron-mcp)\b/iu;

/** 判断一条 npm 搜索结果在 Android 手机端 NIBI-GO 中的适配度。 */
export function classifyNpmHit(pkg: {
  name: string;
  description?: string;
  keywords?: readonly string[];
}): { suitability: NpmMobileSuitability; mobileHint?: string } {
  const nameLower = pkg.name.trim().toLowerCase();
  const desc = (pkg.description ?? "").trim();
  const haystack = `${nameLower} ${desc} ${(pkg.keywords ?? []).join(" ")}`.toLowerCase();

  if (
    LIBRARY_EXACT_NAMES.has(nameLower) ||
    nameLower.startsWith("@ai-sdk/") ||
    nameLower.startsWith("@assistant-ui/") ||
    LIBRARY_NAME_RE.test(nameLower) ||
    LIBRARY_DESC_RE.test(desc)
  ) {
    return { suitability: "library" };
  }
  if (DESKTOP_BROWSER_RE.test(haystack)) {
    return {
      suitability: "desktop-only",
      mobileHint: pickText("需桌面浏览器，手机端通常无法运行", "Requires a desktop browser — usually won't run on mobile"),
    };
  }
  if (DESKTOP_OS_RE.test(haystack)) {
    return {
      suitability: "desktop-only",
      mobileHint: pickText("依赖桌面系统环境，手机端不适用", "Depends on desktop OS APIs — not supported on mobile"),
    };
  }
  return { suitability: "recommended" };
}

export interface NpmPackageVersionMeta {
  name: string;
  version: string;
  description?: string;
  license?: string;
  homepage?: string;
  bin?: string | Record<string, string>;
  main?: string;
  os?: string[];
  scripts?: Record<string, string>;
  gypfile?: boolean;
  binary?: unknown;
  dist?: {
    integrity?: string;
    tarball?: string;
    unpackedSize?: number;
    fileCount?: number;
  };
  /** 实际命中的 registry（供原生安装直接复用同一镜像源）。 */
  registry: string;
}

export interface NpmSearchResult {
  ok: true;
  hits: NpmSearchHit[];
  /** 源站返回的总匹配数。 */
  total: number;
  /** 本页起始偏移。 */
  from: number;
  /** 源站原始返回条数（用于翻页累加，不受客户端过滤影响）。 */
  rawCount: number;
  /** 是否还有下一页可加载。 */
  hasMore: boolean;
  registry: string;
}

export interface NpmErrorResult {
  ok: false;
  reason: string;
}

const SEARCH_TIMEOUT_MS = 12_000;
const META_TIMEOUT_MS = 15_000;

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const MAX_BROWSE_OFFSET = 200;

/** 实时搜索或分页浏览 npm 公共源（优先当前地区镜像，失败自动切换备用源）。 */
export async function searchNpmPackages(
  query: string,
  region: NpmMarketRegion,
  options: {
    size?: number;
    from?: number;
    /** 浏览频道开启：过滤纯 SDK/开发框架库，并把需桌面环境的包排到本页末尾。 */
    filterLibraries?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<NpmSearchResult | NpmErrorResult> {
  const trimmed = query.trim();
  const from = Math.max(0, Math.floor(options.from ?? 0));
  if (!trimmed) {
    return {
      ok: true,
      hits: [],
      total: 0,
      from,
      rawCount: 0,
      hasMore: false,
      registry: npmRegistriesForRegion(region)[0]!,
    };
  }
  const size = Math.min(25, Math.max(1, options.size ?? 15));
  const registries = npmRegistriesForRegion(region);
  let lastError = pickText("网络请求失败", "Network request failed");

  for (const registry of registries) {
    const url = `${registry}/-/v1/search?text=${encodeURIComponent(trimmed)}&size=${size}&from=${from}`;
    try {
      const { status, json } = await fetchJsonWithTimeout(url, SEARCH_TIMEOUT_MS, options.signal);
      if (status < 200 || status >= 300 || typeof json !== "object" || json === null) {
        lastError = `HTTP ${status}`;
        continue;
      }
      const objects = Array.isArray((json as { objects?: unknown }).objects)
        ? ((json as { objects: unknown[] }).objects as Array<Record<string, unknown>>)
        : [];
      const rawTotal = (json as { total?: unknown }).total;
      const total = typeof rawTotal === "number" && Number.isFinite(rawTotal) ? rawTotal : objects.length;
      const recommended: NpmSearchHit[] = [];
      const secondary: NpmSearchHit[] = [];
      for (const item of objects) {
        const pkg =
          typeof item.package === "object" && item.package !== null
            ? (item.package as Record<string, unknown>)
            : null;
        if (!pkg || typeof pkg.name !== "string" || typeof pkg.version !== "string") continue;
        const description = typeof pkg.description === "string" ? pkg.description.trim() : "";
        const keywords = Array.isArray(pkg.keywords)
          ? pkg.keywords.filter((kw): kw is string => typeof kw === "string")
          : [];
        const authorObj =
          typeof pkg.author === "object" && pkg.author !== null
            ? (pkg.author as Record<string, unknown>)
            : null;
        const publisherObj =
          typeof pkg.publisher === "object" && pkg.publisher !== null
            ? (pkg.publisher as Record<string, unknown>)
            : null;
        const author =
          (typeof authorObj?.name === "string" && authorObj.name.trim()) ||
          (typeof publisherObj?.username === "string" && publisherObj.username.trim()) ||
          (typeof pkg.scope === "string" && pkg.scope !== "unscoped" ? `@${pkg.scope}` : "npm");
        const links =
          typeof pkg.links === "object" && pkg.links !== null
            ? (pkg.links as Record<string, unknown>)
            : null;
        const haystack = `${pkg.name} ${description} ${keywords.join(" ")}`.toLowerCase();
        const looksLikeMcp =
          haystack.includes("mcp") ||
          haystack.includes("modelcontextprotocol") ||
          haystack.includes("model-context-protocol");
        const { suitability, mobileHint } = classifyNpmHit({
          name: pkg.name,
          description,
          keywords,
        });
        if (options.filterLibraries && suitability === "library") continue;
        const hit: NpmSearchHit = {
          name: pkg.name,
          version: pkg.version,
          description,
          author,
          ...(typeof pkg.date === "string" ? { date: pkg.date } : {}),
          keywords: keywords.slice(0, 6),
          ...(typeof links?.homepage === "string" ? { homepage: links.homepage } : {}),
          ...(typeof links?.repository === "string" ? { repository: links.repository } : {}),
          looksLikeMcp,
          suitability,
          ...(mobileHint ? { mobileHint } : {}),
        };
        if (options.filterLibraries && suitability === "desktop-only") {
          secondary.push(hit);
        } else {
          recommended.push(hit);
        }
      }
      const hits = options.filterLibraries ? [...recommended, ...secondary] : recommended;
      const rawCount = objects.length;
      const nextFrom = from + rawCount;
      const hasMore = rawCount > 0 && nextFrom < total && nextFrom < MAX_BROWSE_OFFSET;
      return { ok: true, hits, total, from, rawCount, hasMore, registry };
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, reason: pickText("已取消", "Cancelled") };
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, reason: pickText(`搜索 npm 失败：${lastError}`, `npm search failed: ${lastError}`) };
}

/** 从 npm 镜像拉取指定包（或最新版）的 package.json 元数据与 dist.integrity。 */
export async function fetchNpmPackageMetadata(
  packageName: string,
  version: string | undefined,
  region: NpmMarketRegion,
  options: { signal?: AbortSignal } = {},
): Promise<{ ok: true; meta: NpmPackageVersionMeta } | NpmErrorResult> {
  const registries = npmRegistriesForRegion(region);
  const tagOrVersion = version?.trim() || "latest";
  let lastError = pickText("网络请求失败", "Network request failed");

  for (const registry of registries) {
    const url = `${registry}/${packageName}/${encodeURIComponent(tagOrVersion)}`;
    try {
      const { status, json } = await fetchJsonWithTimeout(url, META_TIMEOUT_MS, options.signal);
      if (status === 404) {
        return {
          ok: false,
          reason: pickText(
            `在 npm 上找不到 ${packageName}@${tagOrVersion}`,
            `Package ${packageName}@${tagOrVersion} not found on npm`,
          ),
        };
      }
      if (status < 200 || status >= 300 || typeof json !== "object" || json === null) {
        lastError = `HTTP ${status}`;
        continue;
      }
      const doc = json as Record<string, unknown>;
      if (typeof doc.name !== "string" || typeof doc.version !== "string") {
        lastError = pickText("registry 返回格式不完整", "Incomplete registry metadata");
        continue;
      }
      const dist =
        typeof doc.dist === "object" && doc.dist !== null
          ? (doc.dist as Record<string, unknown>)
          : undefined;
      return {
        ok: true,
        meta: {
          name: doc.name,
          version: doc.version,
          ...(typeof doc.description === "string" ? { description: doc.description } : {}),
          ...(typeof doc.license === "string" ? { license: doc.license } : {}),
          ...(typeof doc.homepage === "string" ? { homepage: doc.homepage } : {}),
          ...(typeof doc.bin === "string" || (typeof doc.bin === "object" && doc.bin !== null)
            ? { bin: doc.bin as string | Record<string, string> }
            : {}),
          ...(typeof doc.main === "string" ? { main: doc.main } : {}),
          ...(Array.isArray(doc.os)
            ? { os: doc.os.filter((item): item is string => typeof item === "string") }
            : {}),
          ...(typeof doc.scripts === "object" && doc.scripts !== null
            ? { scripts: doc.scripts as Record<string, string> }
            : {}),
          ...(doc.gypfile === true ? { gypfile: true } : {}),
          ...(doc.binary !== undefined ? { binary: doc.binary } : {}),
          ...(dist
            ? {
                dist: {
                  ...(typeof dist.integrity === "string" ? { integrity: dist.integrity } : {}),
                  ...(typeof dist.tarball === "string" ? { tarball: dist.tarball } : {}),
                  ...(typeof dist.unpackedSize === "number"
                    ? { unpackedSize: dist.unpackedSize }
                    : {}),
                  ...(typeof dist.fileCount === "number" ? { fileCount: dist.fileCount } : {}),
                },
              }
            : {}),
          registry,
        },
      };
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, reason: pickText("已取消", "Cancelled") };
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    ok: false,
    reason: pickText(`获取 npm 元数据失败：${lastError}`, `Failed to fetch npm metadata: ${lastError}`),
  };
}

export type NpmInspectResult =
  | {
      ok: true;
      /** 相对 `node_modules/<packageName>/` 的 JS 入口路径（无前导 `./`）。 */
      relativeEntry: string;
      /** 相对插件根目录的入口路径（`node_modules/<packageName>/...`）。 */
      pluginEntry: string;
      warnings: string[];
    }
  | { ok: false; reason: string };

function normalizeRelativeScript(raw: string): string | null {
  const cleaned = raw.trim().replace(/^\.\//u, "").replace(/\\/gu, "/");
  if (!cleaned || cleaned.startsWith("/") || cleaned.split("/").includes("..")) return null;
  if (/\.(?:node|so|dylib|dll|exe|sh|bat|cmd|ps1|py)$/iu.test(cleaned)) return null;
  return cleaned;
}

/**
 * 预检/终检一个 npm 包的 package.json：
 * - 拒绝非 Linux 专属包、原生编译包（node-gyp/prebuild/gypfile）；
 * - 市场严格模式下拒绝任何 preinstall/install/postinstall 脚本；
 * - 解析纯 JS MCP 入口（bin 优先，main 兜底）。
 */
export function inspectNpmPackageJson(
  pkg: {
    name?: string;
    bin?: string | Record<string, string>;
    main?: string;
    os?: string[];
    scripts?: Record<string, string>;
    gypfile?: boolean;
    binary?: unknown;
  },
  options: { packageName: string; preferredBin?: string; strictInstallScripts?: boolean },
): NpmInspectResult {
  const warnings: string[] = [];

  if (Array.isArray(pkg.os) && pkg.os.length > 0) {
    const positives = pkg.os.filter((entry) => !entry.startsWith("!"));
    const negatives = pkg.os.filter((entry) => entry.startsWith("!"));
    const bannedLinux = negatives.includes("!linux") || negatives.includes("!android");
    const allowedLinux =
      positives.length === 0 || positives.includes("linux") || positives.includes("android");
    if (bannedLinux || !allowedLinux) {
      return {
        ok: false,
        reason: pickText(
          `该 npm 包仅支持 ${pkg.os.join(", ")}，不兼容 Android 手机端`,
          `This npm package only supports ${pkg.os.join(", ")} and is incompatible with Android`,
        ),
      };
    }
  }

  if (pkg.gypfile === true || pkg.binary !== undefined) {
    return {
      ok: false,
      reason: pickText(
        "该 npm 包声明了原生编译配置（gypfile/binary），手机端仅支持纯 JS 包",
        "This package declares native compilation (gypfile/binary); mobile only supports pure-JS packages",
      ),
    };
  }

  const scripts = pkg.scripts ?? {};
  for (const hook of ["preinstall", "install", "postinstall"] as const) {
    const body = typeof scripts[hook] === "string" ? scripts[hook]!.trim() : "";
    if (!body) continue;
    if (NATIVE_SCRIPT_HINT_RE.test(body)) {
      return {
        ok: false,
        reason: pickText(
          `该 npm 包在 ${hook} 中依赖原生编译（${body.slice(0, 60)}），手机端不支持`,
          `This package runs native build commands in ${hook} (${body.slice(0, 60)}), unsupported on mobile`,
        ),
      };
    }
    if (options.strictInstallScripts) {
      return {
        ok: false,
        reason: pickText(
          `市场包不允许包含 ${hook} 安装脚本`,
          `Marketplace packages cannot include ${hook} install scripts`,
        ),
      };
    }
    warnings.push(
      pickText(
        `已通过 --ignore-scripts 跳过 ${hook} 脚本`,
        `Skipped ${hook} script with --ignore-scripts`,
      ),
    );
  }

  let candidate: string | null = null;
  if (typeof pkg.bin === "string") {
    candidate = normalizeRelativeScript(pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === "object") {
    const entries = Object.entries(pkg.bin).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].trim().length > 0,
    );
    if (options.preferredBin && typeof pkg.bin[options.preferredBin] === "string") {
      candidate = normalizeRelativeScript(pkg.bin[options.preferredBin]!);
    } else if (entries.length === 1) {
      candidate = normalizeRelativeScript(entries[0]![1]);
    } else if (entries.length > 1) {
      const unscoped = options.packageName.includes("/")
        ? options.packageName.split("/")[1]!
        : options.packageName;
      const byName = entries.find(([key]) => key === unscoped || key === options.packageName);
      const jsFirst = entries.find(([, val]) => /\.(?:m|c)?js$/iu.test(val));
      candidate = normalizeRelativeScript((byName ?? jsFirst ?? entries[0]!)![1]);
    }
  }
  if (!candidate && typeof pkg.main === "string") {
    candidate = normalizeRelativeScript(pkg.main);
  }
  if (!candidate) {
    return {
      ok: false,
      reason: pickText(
        "该 npm 包未声明可用的 JavaScript bin/main 入口（可能不是命令行 MCP 服务器）",
        "This package does not declare a runnable JS bin/main entry (may not be a CLI MCP server)",
      ),
    };
  }

  return {
    ok: true,
    relativeEntry: candidate,
    pluginEntry: `node_modules/${options.packageName}/${candidate}`,
    warnings,
  };
}

/** 根据 npm MCP 入口路径（`node_modules/<pkg>/...`）反推 npm 包名（用于兼容旧版已装包缺少 sourceMeta 的场景）。 */
export function inferNpmPackageFromEntry(entry?: string): string | undefined {
  if (!entry) return undefined;
  const match = /^node_modules\/(@[^/\s]+\/[^/\s]+|[^/\s]+)\//u.exec(entry.trim());
  const candidate = match?.[1];
  return candidate && NPM_NAME_RE.test(candidate) ? candidate : undefined;
}

/** 合法插件环境变量名（与 plugin-contract 的 ENV_VAR_RE 对齐：大写字母开头，2–64 位）。 */
export const PLUGIN_ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/u;

/** 高危系统/运行时环境变量黑名单：无论自动探测还是手动新增均禁止覆盖。 */
const BLOCKED_PLUGIN_ENV_NAMES = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "SHELL",
  "TMP",
  "TEMP",
  "TMPDIR",
  "NIBIGO_SETTINGS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "OPENSSL_CONF",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "CLASSPATH",
  "PYTHONPATH",
]);

const BLOCKED_PLUGIN_ENV_PREFIXES = ["LD_", "DYLD_", "NIBIGO_"] as const;

/** 自动探测时的噪音变量黑名单（仅跳过自动建议，用户仍可在需要时手动配置）。 */
const IGNORED_DETECTED_ENV_NAMES = new Set([
  "NODE_ENV",
  "NODE_DEBUG",
  "NODE_NO_WARNINGS",
  "NODE_DISABLE_COLORS",
  "NODE_VERSION",
  "NPM_VERSION",
  "UV_THREADPOOL_SIZE",
  "DEBUG",
  "VERBOSE",
  "SILENT",
  "QUIET",
  "CI",
  "TEST",
  "ENV",
  "PORT",
  "HOST",
  "HOSTNAME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "FTP_PROXY",
  "TZ",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TERM_PROGRAM",
  "COLORTERM",
  "FORCE_COLOR",
  "NO_COLOR",
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "COLUMNS",
  "LINES",
  "USER",
  "USERNAME",
  "LOGNAME",
  "USERPROFILE",
  "HOMEPATH",
  "HOMEDRIVE",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "OS",
  "OSTYPE",
  "HOSTTYPE",
  "PLATFORM",
  "ARCH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "LOG_LEVEL",
  "JEST_WORKER_ID",
  "VITEST",
  "GITHUB_ACTIONS",
  "GITHUB_WORKFLOW",
  "GITHUB_RUN_ID",
  "GITHUB_SHA",
  "GITHUB_REF",
  "GITHUB_REPOSITORY",
  "GITHUB_EVENT_NAME",
  "GITHUB_WORKSPACE",
  "GITLAB_CI",
  "JENKINS_URL",
  "TRAVIS",
  "CIRCLECI",
  "BUILDKITE",
  "VERCEL",
  "NETLIFY",
  "DOCKER",
  "KUBERNETES_SERVICE_HOST",
  "INIT_CWD",
  "COREPACK_ENABLE_STRICT",
  "GOPATH",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "FOO",
  "BAR",
  "BAZ",
  "KEY",
  "VALUE",
  "NAME",
  "STRING",
  "TRUE",
  "FALSE",
  "NULL",
  "UNDEFINED",
]);

const IGNORED_DETECTED_ENV_PREFIXES = [
  "NODE_",
  "NPM_",
  "LC_",
  "XDG_",
  "ANDROID_",
  "V8_",
  "RUNNER_",
  "ACTIONS_",
  "NIBI_",
  "ZCODE_",
  "ELECTRON_",
  "CHROME_",
  "PLAYWRIGHT_",
  "PUPPETEER_",
  "YOUR_",
  "EXAMPLE_",
] as const;

export function isBlockedPluginEnvName(name: string): boolean {
  if (BLOCKED_PLUGIN_ENV_NAMES.has(name)) return true;
  return BLOCKED_PLUGIN_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isIgnoredDetectedEnvName(name: string): boolean {
  if (!PLUGIN_ENV_NAME_RE.test(name)) return true;
  if (isBlockedPluginEnvName(name)) return true;
  if (IGNORED_DETECTED_ENV_NAMES.has(name)) return true;
  return IGNORED_DETECTED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export type ValidatedPluginEnvName =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/** 校验用户输入的自定义环境变量名。 */
export function validatePluginEnvName(rawName: string): ValidatedPluginEnvName {
  const name = rawName.trim();
  if (!name) {
    return {
      ok: false,
      reason: pickText("请输入环境变量名（如 AMAP_KEY）", "Enter an env variable name (e.g. API_KEY)"),
    };
  }
  if (!PLUGIN_ENV_NAME_RE.test(name)) {
    return {
      ok: false,
      reason: pickText(
        "变量名须以大写字母开头，仅含大写字母、数字和下划线（2–64 位）",
        "Must start with an uppercase letter and use only A-Z, 0-9, and _ (2-64 chars)",
      ),
    };
  }
  if (isBlockedPluginEnvName(name)) {
    return {
      ok: false,
      reason: pickText(
        `环境变量 ${name} 属于系统保留项，不允许覆盖`,
        `${name} is a reserved system variable and cannot be overridden`,
      ),
    };
  }
  return { ok: true, name };
}

const MAX_SCAN_TEXT_CHARS = 512 * 1024;

function pushDetectedEnv(name: string, seen: Set<string>, out: string[]): void {
  if (seen.has(name) || isIgnoredDetectedEnvName(name)) return;
  seen.add(name);
  out.push(name);
}

/** 从 JS/MJS/CJS/TS 源码中提取读取的 `process.env.*` 环境变量名（按出现顺序去重）。 */
export function extractEnvVarsFromJs(source: string): string[] {
  const text = source.length > MAX_SCAN_TEXT_CHARS ? source.slice(0, MAX_SCAN_TEXT_CHARS) : source;
  const seen = new Set<string>();
  const found: string[] = [];

  // 1) process.env.VAR_NAME / process?.env?.VAR_NAME / Bun.env.VAR_NAME
  const dotRe = /\b(?:process|Bun)\??\.env\??\.([A-Z][A-Z0-9_]{1,63})\b/gu;
  let match: RegExpExecArray | null;
  while ((match = dotRe.exec(text)) !== null) {
    if (match[1]) pushDetectedEnv(match[1], seen, found);
  }

  // 2) process.env["VAR_NAME"] / process?.env?.['VAR_NAME']
  const bracketRe =
    /\b(?:process|Bun)\??\.env(?:\?\.)?\[\s*["']([A-Z][A-Z0-9_]{1,63})["']\s*\]/gu;
  while ((match = bracketRe.exec(text)) !== null) {
    if (match[1]) pushDetectedEnv(match[1], seen, found);
  }

  // 3) const { VAR_A, VAR_B = "x", VAR_C: local } = process.env
  const destructRe = /\{([^{}]{1,400})\}\s*=\s*process\??\.env\b/gu;
  while ((match = destructRe.exec(text)) !== null) {
    const body = match[1] ?? "";
    for (const part of body.split(",")) {
      const token = part.trim().replace(/^\.\.\./u, "");
      const key = token.split(/[:=]/u)[0]?.trim() ?? "";
      if (key) pushDetectedEnv(key, seen, found);
    }
  }

  return found;
}

/** 从 README / Markdown 文档中提取 MCP 配置块里的 `env` 键与 `process.env.*` 引用。 */
export function extractEnvVarsFromReadme(markdown: string): string[] {
  const text =
    markdown.length > MAX_SCAN_TEXT_CHARS ? markdown.slice(0, MAX_SCAN_TEXT_CHARS) : markdown;
  const seen = new Set<string>();
  const found: string[] = [];

  for (const name of extractEnvVarsFromJs(text)) {
    pushDetectedEnv(name, seen, found);
  }

  // 标准 MCP JSON 配置片段：`"env": { "AMAP_KEY": "your-key" }`
  const envBlockRe = /"env"\s*:\s*\{([^{}]{1,2000})\}/gu;
  let match: RegExpExecArray | null;
  while ((match = envBlockRe.exec(text)) !== null) {
    const body = match[1] ?? "";
    const keyRe = /"([A-Z][A-Z0-9_]{1,63})"\s*:/gu;
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyRe.exec(body)) !== null) {
      if (keyMatch[1]) pushDetectedEnv(keyMatch[1], seen, found);
    }
  }

  // `export AMAP_KEY=...` 或独立行 `AMAP_KEY=...`
  const assignRe = /(?:^|\n)[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]{1,63})=(?:[^\n]*)/gu;
  while ((match = assignRe.exec(text)) !== null) {
    if (match[1]) pushDetectedEnv(match[1], seen, found);
  }

  return found;
}

/** 从 `.env.example` / `.env.sample` 提取环境变量名。 */
export function extractEnvVarsFromDotEnv(content: string): string[] {
  const text =
    content.length > MAX_SCAN_TEXT_CHARS ? content.slice(0, MAX_SCAN_TEXT_CHARS) : content;
  const seen = new Set<string>();
  const found: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]{1,63})\s*=/u.exec(trimmed);
    if (match?.[1]) pushDetectedEnv(match[1], seen, found);
  }
  return found;
}

/** 合并显式声明与包内 JS / `.env.example` / README 扫描出的环境变量规格（上限 8 项）。 */
export function detectNpmEnvSpecs(sources: {
  jsFiles?: readonly string[];
  envExampleFiles?: readonly string[];
  readmeFiles?: readonly string[];
  explicit?: readonly NpmEnvSpec[];
  maxCount?: number;
}): NpmEnvSpec[] {
  const limit = Math.max(0, Math.min(8, sources.maxCount ?? 8));
  const out: NpmEnvSpec[] = [];
  const seen = new Set<string>();

  for (const item of sources.explicit ?? []) {
    if (out.length >= limit) break;
    const name = item.name.trim();
    if (!PLUGIN_ENV_NAME_RE.test(name) || isBlockedPluginEnvName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ ...item, name });
  }

  const detectedNames: string[] = [];
  for (const source of sources.jsFiles ?? []) {
    detectedNames.push(...extractEnvVarsFromJs(source));
  }
  for (const envFile of sources.envExampleFiles ?? []) {
    detectedNames.push(...extractEnvVarsFromDotEnv(envFile));
  }
  for (const readme of sources.readmeFiles ?? []) {
    detectedNames.push(...extractEnvVarsFromReadme(readme));
  }

  for (const name of detectedNames) {
    if (out.length >= limit) break;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      title: name,
      description: pickText(
        `自动探测的环境变量（${name}），填写后新开会话生效`,
        `Auto-detected env variable (${name}); takes effect in new sessions`,
      ),
      placeholder: pickText(`填写 ${name}`, `Enter ${name}`).slice(0, 64),
    });
  }

  return out;
}

/** 合并插件设置映射（runtime.envMap）与用户自定义环境变量（customEnv），产出 MCP 子进程启动 env。 */
export function resolvePluginMcpEnv(params: {
  settings: Readonly<Record<string, string | boolean>>;
  envMap?: Readonly<Record<string, string>>;
  customEnv?: Readonly<Record<string, string>>;
}): Array<{ name: string; value: string }> {
  const env: Array<{ name: string; value: string }> = [];
  if (Object.keys(params.settings).length > 0) {
    env.push({ name: "NIBIGO_SETTINGS", value: JSON.stringify(params.settings) });
  }

  const values = new Map<string, string>();
  if (params.envMap) {
    for (const [settingId, envName] of Object.entries(params.envMap)) {
      if (!PLUGIN_ENV_NAME_RE.test(envName) || isBlockedPluginEnvName(envName)) continue;
      const raw = params.settings[settingId];
      if (raw === undefined) continue;
      const asText = String(raw).trim();
      if (asText.length > 0 && !asText.includes("\0")) {
        values.set(envName, asText);
      }
    }
  }
  if (params.customEnv) {
    for (const [envName, raw] of Object.entries(params.customEnv)) {
      if (!PLUGIN_ENV_NAME_RE.test(envName) || isBlockedPluginEnvName(envName)) continue;
      const asText = raw.trim();
      if (asText.length > 0 && !asText.includes("\0")) {
        values.set(envName, asText);
      }
    }
  }

  for (const [name, value] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    env.push({ name, value });
  }
  return env;
}

/** 计算插件已声明或自动探测但尚未填值的环境变量名列表（用于 UI 待配置提醒）。 */
export function missingEnvVarNames(params: {
  settings: Readonly<Record<string, string | boolean>>;
  envMap?: Readonly<Record<string, string>>;
  customEnv?: Readonly<Record<string, string>>;
  detectedEnvVars?: readonly string[];
}): string[] {
  const expected: string[] = [];
  const seen = new Set<string>();
  const addExpected = (name: string) => {
    if (!PLUGIN_ENV_NAME_RE.test(name) || isBlockedPluginEnvName(name) || seen.has(name)) return;
    seen.add(name);
    expected.push(name);
  };
  for (const envName of Object.values(params.envMap ?? {})) addExpected(envName);
  for (const envName of params.detectedEnvVars ?? []) addExpected(envName);

  const filled = new Set<string>();
  for (const [settingId, envName] of Object.entries(params.envMap ?? {})) {
    const raw = params.settings[settingId];
    if (raw !== undefined && String(raw).trim().length > 0) filled.add(envName);
  }
  for (const [envName, raw] of Object.entries(params.customEnv ?? {})) {
    if (raw.trim().length > 0) filled.add(envName);
  }

  return expected.filter((name) => !filled.has(name));
}

/** 为已安装的纯 JS npm MCP 包生成 NIBI-GO 宿主清单（`nibi-go.plugin.json`）与内核元数据。 */
export function buildNpmPluginManifest(params: {
  id: string;
  name: string;
  version: string;
  description?: string;
  packageName: string;
  pluginEntry: string;
  serverName?: string;
  args?: readonly string[];
  env?: readonly NpmEnvSpec[];
  alwaysLoad?: boolean;
  timeoutMs?: number;
}): { hostManifest: Record<string, unknown>; kernelManifest: Record<string, unknown> } {
  const serverName = mcpServerNameFor(params.packageName, params.serverName);
  const envMap: Record<string, string> = {};
  const settings: Array<Record<string, unknown>> = [];
  const seenSettingIds = new Set<string>();

  for (const item of params.env ?? []) {
    if (settings.length >= 8) break;
    const envName = item.name.trim();
    if (!PLUGIN_ENV_NAME_RE.test(envName) || isBlockedPluginEnvName(envName)) continue;
    const settingId = envName.toLowerCase().replace(/[^a-z0-9_]+/gu, "_").slice(0, 64);
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(settingId) || seenSettingIds.has(settingId)) continue;
    seenSettingIds.add(settingId);
    envMap[settingId] = envName;
    const title = (item.title.trim() || envName).slice(0, 64);
    const description = item.description?.trim().slice(0, 120);
    const placeholder = (item.placeholder?.trim() || pickText(`填写 ${envName}`, `Enter ${envName}`)).slice(0, 64);
    settings.push({
      id: settingId,
      title,
      type: "text",
      ...(description ? { description } : {}),
      placeholder,
      maxLength: 512,
    });
  }

  const hostManifest: Record<string, unknown> = {
    schemaVersion: 1,
    id: params.id,
    name: params.name.slice(0, 64),
    version: params.version,
    ...(params.description ? { description: params.description.slice(0, 280) } : {}),
    caps: ["slots.v1", "mcp.v1"],
    runtime: {
      type: "mcp",
      serverName,
      entry: params.pluginEntry,
      ...(params.args && params.args.length > 0 ? { args: [...params.args] } : {}),
      ...(Object.keys(envMap).length > 0 ? { envMap } : {}),
      alwaysLoad: params.alwaysLoad ?? true,
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
    },
    ...(settings.length > 0 ? { settings } : {}),
  };

  const kernelManifest: Record<string, unknown> = {
    name: params.id,
    ...(params.description ? { description: params.description.slice(0, 280) } : {}),
  };

  return { hostManifest, kernelManifest };
}
