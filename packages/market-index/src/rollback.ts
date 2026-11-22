// 防回滚：签名只证明“这份字节是我们发的”，不证明“它是最新的”——旧签名同样有效。
// 因此客户端持久化上次接受的 revision + 摘要，刷新时按下面的规则判断。
//
// 另外校验插件级不变量：同一个 id 的版本只能前进；同一 (id, version) 的包摘要不可变
// （版本不可变，重新打包必须发新版本）。
import { packagePinDigest, type MarketIndex } from "./types";

/** 客户端持久化的“上次接受的快照”。 */
export interface MarketSnapshotState {
  market: string;
  revision: number;
  /** 上次接受的 index.json 原始字节摘要（hex）。 */
  indexSha256: string;
}

export type MarketRefreshDecision =
  | { kind: "accept" }
  | { kind: "unchanged" }
  | {
      kind: "reject";
      reason: "market-mismatch" | "rollback" | "revision-conflict";
      message: string;
    };

export interface MarketRefreshCandidate {
  market: string;
  revision: number;
  indexSha256: string;
}

/** 刷新判决：倒退或同 revision 不同字节都按本次刷新失败处理（保留旧快照）。 */
export function evaluateMarketRefresh(
  previous: MarketSnapshotState | null,
  next: MarketRefreshCandidate,
): MarketRefreshDecision {
  if (previous === null) return { kind: "accept" };
  if (previous.market !== next.market) {
    return { kind: "reject", reason: "market-mismatch", message: "市场 id 与已保存的快照不一致" };
  }
  if (next.revision < previous.revision) {
    return {
      kind: "reject",
      reason: "rollback",
      message: `revision 倒退：本地 ${previous.revision}，远端 ${next.revision}`,
    };
  }
  if (next.revision === previous.revision) {
    if (next.indexSha256 === previous.indexSha256) return { kind: "unchanged" };
    return {
      kind: "reject",
      reason: "revision-conflict",
      message: `revision ${next.revision} 的字节与已保存的不一致`,
    };
  }
  return { kind: "accept" };
}

/** 从一份已验签的索引生成要持久化的快照状态。 */
export function snapshotStateOf(index: MarketIndex, indexSha256: string): MarketSnapshotState {
  return { market: index.market, revision: index.revision, indexSha256 };
}

export interface PluginPinConflict {
  id: string;
  version: string;
  reason: "digest-changed" | "version-regressed";
}

/** 比较版本号数字段（忽略 -/+ 后缀）；返回值 <0 表示 a 更旧。 */
export function comparePluginVersions(a: string, b: string): number {
  const core = (value: string) => value.split(/[-+]/u)[0]!.split(".").map((part) => Number(part) || 0);
  const left = core(a);
  const right = core(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export type PluginPinResult =
  | { ok: true }
  | { ok: false; conflicts: PluginPinConflict[] };

/** 插件级不变量：版本只前进；同一版本摘要不可变。 */
export function checkPluginPins(
  previous: MarketIndex | null,
  next: MarketIndex,
): PluginPinResult {
  if (previous === null) return { ok: true };
  const known = new Map(previous.plugins.map((plugin) => [plugin.id, plugin]));
  const conflicts: PluginPinConflict[] = [];
  for (const plugin of next.plugins) {
    const before = known.get(plugin.id);
    if (!before) continue;
    if (comparePluginVersions(plugin.version, before.version) < 0) {
      conflicts.push({ id: plugin.id, version: plugin.version, reason: "version-regressed" });
      continue;
    }
    if (
      plugin.version === before.version &&
      packagePinDigest(plugin.package) !== packagePinDigest(before.package)
    ) {
      conflicts.push({ id: plugin.id, version: plugin.version, reason: "digest-changed" });
    }
  }
  return conflicts.length > 0 ? { ok: false, conflicts } : { ok: true };
}
