// 插件撤回（下架）：从索引里移除条目，并把这次撤回追加进公开的 `yanked.json` 记录。
//
// 为什么需要它：索引只描述“当前可安装的版本”。发现安全问题、许可问题或包被篡改时，
// 光发新版本不够——旧版本还在原地址，客户端仍可安装。撤回把条目移出索引，客户端下次
// 刷新后不再提供安装/更新；已安装的本地副本不会被远程删除（客户端不做远程卸载）。
//
// 记录是公开、追加式的：谁在哪个 revision 因为什么被撤回，都能在仓库里查到。
// 撤回后同一 id 可以以**更高版本**重新提交（修复后回归），但不能用被撤回的版本号再发。
import { z } from "zod";

import type { MarketIndex } from "./types";

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u;

export const yankRecordSchema = z.object({
  id: z.string().regex(ID_RE),
  version: z.string().regex(VERSION_RE),
  /** 撤回理由（公开可读；不得包含内部信息，泄露门禁同样适用）。 */
  reason: z.string().min(1).max(500),
  /** 撤回时间（ISO 8601）。 */
  yankedAt: z.string().max(40),
  /** 撤回后索引的 revision（该 revision 起不再包含此版本）。 */
  revision: z.number().int().min(1),
});

export const yankLogSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(yankRecordSchema).max(10_000),
});

export type YankRecord = z.infer<typeof yankRecordSchema>;
export type YankLog = z.infer<typeof yankLogSchema>;

export function emptyYankLog(): YankLog {
  return { schemaVersion: 1, entries: [] };
}

export type YankTarget = {
  id: string;
  /** 指定版本；不填则以当前索引里的版本为准。指定后必须与当前版本一致。 */
  version?: string;
  reason: string;
};

export type ApplyYankResult =
  | { ok: true; index: MarketIndex; record: YankRecord }
  | { ok: false; reason: string };

/** 把一条撤回应用到索引上（revision +1）；不签名、不写盘。 */
export function applyYank(
  index: MarketIndex,
  target: YankTarget,
  now: string = new Date().toISOString(),
): ApplyYankResult {
  const reason = target.reason.trim();
  if (!reason) return { ok: false, reason: "撤回理由不能为空" };
  if (reason.length > 500) return { ok: false, reason: "撤回理由不能超过 500 字" };

  const entry = index.plugins.find((plugin) => plugin.id === target.id);
  if (!entry) return { ok: false, reason: `索引里没有 ${target.id}` };
  if (target.version !== undefined && target.version !== entry.version) {
    return {
      ok: false,
      reason: `版本不一致：索引里是 ${entry.version}，撤回指定 ${target.version}（请刷新后重试）`,
    };
  }

  const nextIndex: MarketIndex = {
    ...index,
    revision: index.revision + 1,
    generatedAt: now,
    plugins: index.plugins.filter((plugin) => plugin.id !== target.id),
  };
  return {
    ok: true,
    index: nextIndex,
    record: {
      id: entry.id,
      version: entry.version,
      reason,
      yankedAt: now,
      revision: nextIndex.revision,
    },
  };
}

/** 解析 yanked.json；形状不合法返回 null。 */
export function parseYankLog(input: unknown): YankLog | null {
  const parsed = yankLogSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export type YankLogProblem = { index: number; message: string };

/**
 * 撤回记录的跨文件一致性（CI 与发布工具共用）：
 * - 同一条 (id, version) 只能撤回一次；
 * - 记录按 revision 严格递增追加；
 * - 当前索引里不得仍有与撤回记录同 (id, version) 的条目；
 *   同 id 的更高版本可以回归。
 */
export function checkYankLog(log: YankLog, index: MarketIndex): YankLogProblem[] {
  const problems: YankLogProblem[] = [];
  const seen = new Set<string>();
  let previousRevision = 0;
  log.entries.forEach((entry, position) => {
    const key = `${entry.id}@${entry.version}`;
    if (seen.has(key)) problems.push({ index: position, message: `${key} 重复撤回` });
    seen.add(key);
    if (entry.revision <= previousRevision) {
      problems.push({
        index: position,
        message: `${key} 的 revision 不是递增（${previousRevision} → ${entry.revision}）`,
      });
    }
    previousRevision = Math.max(previousRevision, entry.revision);
    const live = index.plugins.find((plugin) => plugin.id === entry.id);
    if (live && live.version === entry.version) {
      problems.push({ index: position, message: `${key} 已撤回，但当前索引里仍是这个版本` });
    }
  });
  return problems;
}
