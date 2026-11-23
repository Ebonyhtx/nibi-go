// 官方市场索引的验签入口。
//
// 口径（与桌面端同一思路，格式独立）：
// - 签名对象是 `index.json` 的**原始字节**，detached 侧车 `index.json.sig` 是 128 位 hex；
// - 公钥内置在客户端（`keys.ts`），签名里不带 keyId：轮换时客户端对多个 key 逐个尝试；
// - 验签失败 = 本次刷新失败，调用方保留上一份成功快照，不接受半可信清单；
// - 签名只保完整性，防回滚由 `revision` 单调递增负责（见 `rollback.ts`）。
import { ed25519 } from "@noble/curves/ed25519.js";

import { hexToBytes, sha256Hex } from "./digest";
import { NIBI_MARKET_KEYS, type MarketKey } from "./keys";
import { marketIndexSchema, type MarketIndex } from "./types";

export type MarketVerifyError =
  | "bad-signature"
  | "unknown-key"
  | "bad-json"
  | "bad-schema"
  | "duplicate-plugin";

export type MarketVerifyResult =
  | { ok: true; index: MarketIndex; indexSha256: string; keyId: string }
  | { ok: false; error: MarketVerifyError; detail?: string };

export interface MarketVerifyOptions {
  /** 测试可注入；默认用内置公钥表。 */
  keys?: readonly MarketKey[];
}

/** 校验 detached 签名（hex）是否由任一内置 key 对 `bytes` 签发。 */
function matchSignature(
  bytes: Uint8Array,
  signature: Uint8Array,
  keys: readonly MarketKey[],
): MarketKey | null {
  for (const key of keys) {
    const publicKey = hexToBytes(key.publicKeyHex);
    if (!publicKey || publicKey.length !== 32) continue;
    try {
      if (ed25519.verify(signature, bytes, publicKey)) return key;
    } catch {
      // 单个 key 的验签异常不影响其它 key。
    }
  }
  return null;
}

/** 通用 detached Ed25519 验签：返回命中的 key；格式错误/验签失败返回 null。 */
export function verifyDetachedSignature(
  bytes: Uint8Array,
  signatureHex: string,
  keys: readonly MarketKey[] = NIBI_MARKET_KEYS,
): MarketKey | null {
  const signature = hexToBytes(signatureHex.trim().toLowerCase());
  if (!signature || signature.length !== 64) return null;
  return matchSignature(bytes, signature, keys);
}

/** 验签 + 形状校验；任何一步失败都不返回 index。 */
export function verifyMarketIndexBytes(
  bytes: Uint8Array,
  signatureHex: string,
  options: MarketVerifyOptions = {},
): MarketVerifyResult {
  const keys = options.keys ?? NIBI_MARKET_KEYS;
  if (keys.length === 0) return { ok: false, error: "unknown-key" };
  const key = verifyDetachedSignature(bytes, signatureHex, keys);
  if (!key) return { ok: false, error: "bad-signature" };

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, error: "bad-json" };
  }
  const parsed = marketIndexSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join("/") ?? "";
    return { ok: false, error: "bad-schema", detail: path ? `/${path}: ${issue.message}` : issue?.message };
  }

  const seen = new Set<string>();
  for (const plugin of parsed.data.plugins) {
    if (seen.has(plugin.id)) {
      return { ok: false, error: "duplicate-plugin", detail: plugin.id };
    }
    seen.add(plugin.id);
  }

  return { ok: true, index: parsed.data, indexSha256: sha256Hex(bytes), keyId: key.id };
}

/** 便于排障：给一个字节串算出它的摘要与 hex（不验签）。 */
export function describeMarketBytes(bytes: Uint8Array): { size: number; sha256: string } {
  return { size: bytes.byteLength, sha256: sha256Hex(bytes) };
}
