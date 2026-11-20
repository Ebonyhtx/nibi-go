// 一次市场刷新的完整判决：取字节 → 验签/schema → 与本地快照比 revision → 插件版本不变量。
//
// 网络与存储都在调用方（App 用 expo/fetch + filesDir 快照）；这里只做纯逻辑，
// 便于用假 fetcher 单测“验签失败/回滚/同 revision 冲突”等分支。
import { evaluateMarketRefresh, checkPluginPins, type MarketSnapshotState } from "./rollback";
import type { MarketIndex } from "./types";
import { verifyMarketIndexBytes, type MarketVerifyOptions } from "./verify";

/** 返回 URL 的原始字节；非 2xx 应抛错。 */
export type MarketFetcher = (url: string) => Promise<Uint8Array>;

export type MarketRefreshFailure =
  | { kind: "fetch"; detail: string }
  | { kind: "verify"; error: string; detail?: string }
  | { kind: "rollback"; reason: "market-mismatch" | "rollback" | "revision-conflict"; detail: string }
  | { kind: "pins"; conflicts: Array<{ id: string; version: string; reason: string }> };

export type MarketRefreshResult =
  | {
      ok: true;
      kind: "accept" | "unchanged";
      index: MarketIndex;
      state: MarketSnapshotState;
      keyId: string;
    }
  | ({ ok: false } & MarketRefreshFailure);

export interface RefreshMarketOptions extends MarketVerifyOptions {
  indexUrl: string;
  /** 本地持久化的快照状态；首次为 null。 */
  previous: MarketSnapshotState | null;
  /** 本地持久化的上一份索引（用于插件版本不变量）；没有则为 null。 */
  previousIndex: MarketIndex | null;
}

/** 签名侧车地址：与 index.json 同目录的 `<index>.sig`。 */
export function marketSignatureUrl(indexUrl: string): string {
  return `${indexUrl}.sig`;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export async function refreshMarketIndex(
  fetcher: MarketFetcher,
  options: RefreshMarketOptions,
): Promise<MarketRefreshResult> {
  let indexBytes: Uint8Array;
  let signatureText: string;
  try {
    indexBytes = await fetcher(options.indexUrl);
    signatureText = decodeUtf8(await fetcher(marketSignatureUrl(options.indexUrl))).trim();
  } catch (error) {
    return { ok: false, kind: "fetch", detail: error instanceof Error ? error.message : String(error) };
  }

  const verified = verifyMarketIndexBytes(indexBytes, signatureText, { keys: options.keys });
  if (!verified.ok) {
    return { ok: false, kind: "verify", error: verified.error, detail: verified.detail };
  }

  const decision = evaluateMarketRefresh(options.previous, {
    market: verified.index.market,
    revision: verified.index.revision,
    indexSha256: verified.indexSha256,
  });
  if (decision.kind === "reject") {
    return { ok: false, kind: "rollback", reason: decision.reason, detail: decision.message };
  }

  const pins = checkPluginPins(options.previousIndex, verified.index);
  if (!pins.ok) {
    return { ok: false, kind: "pins", conflicts: pins.conflicts };
  }

  return {
    ok: true,
    kind: decision.kind,
    index: verified.index,
    state: {
      market: verified.index.market,
      revision: verified.index.revision,
      indexSha256: verified.indexSha256,
    },
    keyId: verified.keyId,
  };
}

export type MarketSourcesRefreshResult =
  | (Extract<MarketRefreshResult, { ok: true }> & { source: string })
  | Extract<MarketRefreshResult, { ok: false }>;

export interface RefreshMarketSourcesOptions extends Omit<RefreshMarketOptions, "indexUrl"> {
  /** 按优先级排列的索引地址（第一项是展示用默认源）。 */
  indexUrls: readonly string[];
}

/**
 * 多源刷新：每个源都验签，取 revision 最大的那一份；同 revision 不同字节视为冲突。
 *
 * 为什么不是“第一个成功就用”：CDN 镜像可能落后于市场仓。若先接受陈旧镜像，
 * 新装设备会停在旧 revision（旧签名同样有效），后续刷新也会因为 same revision 不再前进。
 */
export async function refreshMarketIndexFromSources(
  fetcher: MarketFetcher,
  options: RefreshMarketSourcesOptions,
): Promise<MarketSourcesRefreshResult> {
  let best: (Extract<MarketRefreshResult, { ok: true }> & { source: string }) | null = null;
  let lastFailure: Extract<MarketRefreshResult, { ok: false }> | null = null;
  for (const indexUrl of options.indexUrls) {
    const result = await refreshMarketIndex(fetcher, { ...options, indexUrl });
    if (!result.ok) {
      lastFailure = result;
      continue;
    }
    if (!best) {
      best = { ...result, source: indexUrl };
      continue;
    }
    if (result.index.revision > best.index.revision) {
      best = { ...result, source: indexUrl };
      continue;
    }
    if (result.index.revision === best.index.revision && result.state.indexSha256 !== best.state.indexSha256) {
      return {
        ok: false,
        kind: "rollback",
        reason: "revision-conflict",
        detail: `revision ${result.index.revision} 在不同市场源上字节不一致（${best.source} vs ${indexUrl}）`,
      };
    }
  }
  return best ?? lastFailure ?? { ok: false, kind: "fetch", detail: "没有可用的市场源" };
}
