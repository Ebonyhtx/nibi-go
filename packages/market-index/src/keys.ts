// 内置的市场验签公钥（raw Ed25519 public key，hex）。
//
// 私钥在运营者本机 `~/.nibi/market/<keyId>.json`（0600），与 Android keystore 同一纪律：
// 不进仓库、不进对话、不写日志；备份放私有运维仓。轮换时新增一条 keyId 并保留旧的至少一个版本，
// 客户端对 `.sig` 侧车逐个 key 尝试验签，不依赖签名里带 keyId。

export interface MarketKey {
  /** 与 `scripts/market/gen-key.mjs --id` 一致。 */
  id: string;
  /** raw 32 字节 Ed25519 公钥，64 位小写 hex。 */
  publicKeyHex: string;
  /** 展示/排障用，前 8 字节 SHA-256。 */
  fingerprint: string;
}

export const NIBI_MARKET_KEYS: readonly MarketKey[] = [
  {
    id: "nibi-go-market-2026-11",
    publicKeyHex: "90c6acbb9a020d1d567807620250a56e5822e70324b894bbc3a03fe3a6a2fd04",
    fingerprint: "09d17d31cb00b43c",
  },
];

export function findMarketKey(id: string): MarketKey | undefined {
  return NIBI_MARKET_KEYS.find((key) => key.id === id);
}
