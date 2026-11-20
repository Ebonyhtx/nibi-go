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
