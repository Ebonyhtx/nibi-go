// 插件提交（submissions/<id>-<version>.json）的形状与“合并进索引”的纯逻辑。
//
// 提交流程里第三方只提 zip + 这份元数据；维护者审核后用 scripts/market/publish-submission.mjs
// 把它合并进 index.json 并签名。合并规则与 CI 的 check-submissions 保持一致：
// 版本只能前进、同版本摘要不可变、包地址必须是市场仓 raw 前缀下的固定文件名。
import { z } from "zod";

import type { MarketIndex, MarketPluginEntry } from "./types";

export const MARKET_RAW_PREFIX = "https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

export const submissionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(ID_RE),
  name: z.string().min(1).max(64),
  version: z.string().regex(VERSION_RE),
  description: z.string().max(280).optional(),
  license: z.string().min(1).max(64),
  homepage: z.string().max(2048).optional(),
  source: z.string().max(2048).optional(),
  contact: z.string().min(1).max(200),
  /** 插件 id 的归属人；市场 CI 要求它等于 PR 作者，且 source 仓库属于同一账号。 */
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
  package: z.object({
    file: z.string().max(200),
    sha256: z.string().regex(SHA256_RE),
    size: z.number().int().positive().max(64 * 1024 * 1024),
  }),
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

/** 把一份已审核的提交合并进索引（revision +1）；不签名、不写盘。 */
export function applySubmission(
  index: MarketIndex,
  submission: PluginSubmission,
  now: string = new Date().toISOString(),
): ApplySubmissionResult {
  const expectedFile = packageFileFor(submission.id, submission.version);
  if (submission.package.file !== expectedFile) {
    return { ok: false, reason: `package.file 必须是 ${expectedFile}` };
  }
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
    if (cmp === 0 && existing.package.sha256 !== submission.package.sha256) {
      return { ok: false, reason: `同版本 ${submission.version} 的包摘要不可变` };
    }
    if (cmp === 0) {
      return { ok: true, index, entry: existing, unchanged: true };
    }
  }

  const publisherName = submission.publisher?.name ?? existing?.publisher;
  const publisherGithub = submission.publisher?.github ?? existing?.publisherGithub;
  const entry: MarketPluginEntry = {
    id: submission.id,
    name: submission.name,
    version: submission.version,
    ...(submission.description ? { description: submission.description } : {}),
    caps: submission.caps,
    ...(submission.runtime ? { runtime: submission.runtime } : {}),
    license: submission.license,
    ...(publisherName ? { publisher: publisherName } : {}),
    ...(publisherGithub ? { publisherGithub } : {}),
    package: {
      url: `${MARKET_RAW_PREFIX}${expectedFile}`,
      sha256: submission.package.sha256,
      size: submission.package.size,
      format: "zip",
    },
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
