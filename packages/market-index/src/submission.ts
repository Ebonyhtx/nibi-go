// 插件提交（submissions/<id>-<version>.json）的形状与“合并进索引”的纯逻辑。
//
// 支持三种标准分发形态（与桌面端彻底隔离，仅服务 NIBI-GO 手机市场）：
// 1. 标准 npm MCP 包（format: "npm"，不向 Git 仓提交任何二进制）；
// 2. 外部 HTTPS ZIP（format: "zip" + url，例如作者 GitHub Releases 的标准 .nibi-plugin/.claude-plugin/.codex-plugin 包）；
// 3. 兼容旧版仓内 ZIP（file: "packages/<id>-<version>.zip"）。
import { z } from "zod";

import {
  npmEnvSpecSchema,
  packagePinDigest,
  type MarketIndex,
  type MarketPluginEntry,
  type MarketPluginPackage,
} from "./types";

export const MARKET_RAW_PREFIX = "https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const SRI_RE = /^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/u;
const SERVER_NAME_RE = /^[a-z][a-z0-9_]{1,31}$/u;

const httpsUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "必须是 https 地址");

const repoZipSubmissionPackageSchema = z.object({
  format: z.literal("zip").optional(),
  file: z.string().max(200),
  sha256: z.string().regex(SHA256_RE),
  size: z.number().int().positive().max(64 * 1024 * 1024),
});

const remoteZipSubmissionPackageSchema = z.object({
  format: z.literal("zip"),
  url: httpsUrlSchema,
  sha256: z.string().regex(SHA256_RE),
  size: z.number().int().positive().max(64 * 1024 * 1024),
});

const npmSubmissionPackageSchema = z.object({
  format: z.literal("npm"),
  name: z.string().min(1).max(214).regex(NPM_NAME_RE),
  version: z.string().regex(VERSION_RE).optional(),
  integrity: z.string().max(160).regex(SRI_RE),
  size: z.number().int().positive().max(64 * 1024 * 1024).optional(),
  bin: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => !value.includes("/") && !value.includes("\\") && value !== "..")
    .optional(),
  args: z
    .array(z.string().min(1).max(200).refine((value) => !value.includes("\0")))
    .max(16)
    .optional(),
  env: z.array(npmEnvSpecSchema).max(8).optional(),
  serverName: z.string().regex(SERVER_NAME_RE).optional(),
  alwaysLoad: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export const submissionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(ID_RE),
  name: z.string().min(1).max(64),
  version: z.string().regex(VERSION_RE),
  description: z.string().max(280).optional(),
  kind: z.enum(["mcp", "skill", "hybrid"]).optional(),
  license: z.string().min(1).max(64),
  homepage: httpsUrlSchema.optional(),
  source: httpsUrlSchema.optional(),
  contact: z.string().min(1).max(200),
  /** 插件 id 的归属人；第三方自主投稿时要求与 PR 作者一致。 */
  publisher: z
    .object({
      name: z.string().min(1).max(64),
      github: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u),
    })
    .optional(),
  caps: z.array(z.string().max(32)).max(16),
  runtime: z.enum(["node", "declarative"]).optional(),
  /** 付费条目不走公开提交流程。 */
  paid: z.never().optional(),
  package: z.union([
    npmSubmissionPackageSchema,
    remoteZipSubmissionPackageSchema,
    repoZipSubmissionPackageSchema,
  ]),
});

export type PluginSubmission = z.infer<typeof submissionSchema>;

export function packageFileFor(id: string, version: string): string {
  return `packages/${id}-${version}.zip`;
}

export type ApplySubmissionResult =
  | { ok: true; index: MarketIndex; entry: MarketPluginEntry; unchanged: boolean }
  | { ok: false; reason: string };

/** 比较版本号数字段（忽略 -/+ 后缀）。 */
function compareVersions(a: string, b: string): number {
  const core = (value: string) => value.split(/[-+]/u)[0]!.split(".").map((part) => Number(part) || 0);
  const left = core(a);
  const right = core(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function resolveSubmissionPackage(
  submission: PluginSubmission,
): { ok: true; pkg: MarketPluginPackage } | { ok: false; reason: string } {
  const raw = submission.package;
  if ("format" in raw && raw.format === "npm") {
    const pkgVersion = raw.version ?? submission.version;
    if (pkgVersion !== submission.version) {
      return {
        ok: false,
        reason: `npm package.version（${pkgVersion}）必须与提交版本（${submission.version}）一致`,
      };
    }
    return {
      ok: true,
      pkg: {
        format: "npm",
        name: raw.name,
        version: pkgVersion,
        integrity: raw.integrity,
        ...(raw.size !== undefined ? { size: raw.size } : {}),
        ...(raw.bin !== undefined ? { bin: raw.bin } : {}),
        ...(raw.args !== undefined ? { args: raw.args } : {}),
        ...(raw.env !== undefined ? { env: raw.env } : {}),
        ...(raw.serverName !== undefined ? { serverName: raw.serverName } : {}),
        ...(raw.alwaysLoad !== undefined ? { alwaysLoad: raw.alwaysLoad } : {}),
        ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs } : {}),
      },
    };
  }
  if ("url" in raw) {
    return {
      ok: true,
      pkg: {
        format: "zip",
        url: raw.url,
        sha256: raw.sha256,
        size: raw.size,
      },
    };
  }
  const expectedFile = packageFileFor(submission.id, submission.version);
  if (raw.file !== expectedFile) {
    return { ok: false, reason: `package.file 必须是 ${expectedFile}` };
  }
  return {
    ok: true,
    pkg: {
      format: "zip",
      url: `${MARKET_RAW_PREFIX}${expectedFile}`,
      sha256: raw.sha256,
      size: raw.size,
    },
  };
}

/** 把一份已审核的提交合并进索引（revision +1）；不签名、不写盘。 */
export function applySubmission(
  index: MarketIndex,
  submission: PluginSubmission,
  now: string = new Date().toISOString(),
): ApplySubmissionResult {
  const resolved = resolveSubmissionPackage(submission);
  if (!resolved.ok) return resolved;

  const existing = index.plugins.find((plugin) => plugin.id === submission.id);
  if (
    existing?.publisherGithub &&
    submission.publisher?.github?.toLowerCase() !== existing.publisherGithub.toLowerCase()
  ) {
    return {
      ok: false,
      reason: `插件 id ${submission.id} 归 @${existing.publisherGithub} 所有，不能由其他账号更新`,
    };
  }
  if (existing) {
    const cmp = compareVersions(submission.version, existing.version);
    if (cmp < 0) {
      return { ok: false, reason: `版本倒退：${existing.version} → ${submission.version}` };
    }
    if (cmp === 0 && packagePinDigest(existing.package) !== packagePinDigest(resolved.pkg)) {
      return { ok: false, reason: `同版本 ${submission.version} 的包摘要不可变` };
    }
    if (cmp === 0) {
      return { ok: true, index, entry: existing, unchanged: true };
    }
  }

  const publisherName = submission.publisher?.name ?? existing?.publisher;
  const publisherGithub = submission.publisher?.github ?? existing?.publisherGithub;
  const inferredRuntime =
    submission.runtime ?? (resolved.pkg.format === "npm" ? "node" : undefined);
  const inferredKind =
    submission.kind ?? (resolved.pkg.format === "npm" ? "mcp" : undefined);
  const entry: MarketPluginEntry = {
    id: submission.id,
    name: submission.name,
    version: submission.version,
    ...(submission.description ? { description: submission.description } : {}),
    ...(inferredKind ? { kind: inferredKind } : {}),
    caps: submission.caps,
    ...(inferredRuntime ? { runtime: inferredRuntime } : {}),
    license: submission.license,
    ...(submission.homepage ? { homepage: submission.homepage } : {}),
    ...(submission.source ? { source: submission.source } : {}),
    ...(publisherName ? { publisher: publisherName } : {}),
    ...(publisherGithub ? { publisherGithub } : {}),
    package: resolved.pkg,
  };

  const plugins = existing
    ? index.plugins.map((plugin) => (plugin.id === submission.id ? entry : plugin))
    : [...index.plugins, entry];
  return {
    ok: true,
    index: { ...index, revision: index.revision + 1, generatedAt: now, plugins },
    entry,
    unchanged: false,
  };
}
