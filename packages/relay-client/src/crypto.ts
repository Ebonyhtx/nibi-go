// E2E 信封（D9 / 决议 P3b/P3c）：XChaCha20-Poly1305 + 会话级 K。
// Cipher 接口（D11）：实现可换（Android=libsodium、iOS=CryptoKit 桥），密文格式三平台一致。
// 当前默认实现 @noble/ciphers（纯 TS，Node/RN 双跑）；换实现不改信封格式。
// 规格：docs/design/e2e-envelope-v1.md（桌面侧按同一规格镜像）。
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

import { decodeWireBase64, encodeWireBytesBase64 } from "@nibi-go/shared-extract";

import type { RelayJson } from "./types";

export const E2E_ENVELOPE_VERSION = 1;
export const E2E_KEY_BYTES = 32;
export const E2E_NONCE_BYTES = 24;

/** D11：crypto 走 Cipher 接口抽象，实现可换、密文格式不变。 */
export interface Cipher {
  encrypt(plain: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array;
}

export const xchachaCipher: Cipher = {
  encrypt: (plain, key, nonce) => xchacha20poly1305(key, nonce).encrypt(plain),
  decrypt: (ciphertext, key, nonce) => xchacha20poly1305(key, nonce).decrypt(ciphertext),
};

/** relay data payload 的密文信封（P3c：JSON 文本帧，字段 base64）。 */
export interface EncryptedPayload {
  nibi_type: "enc";
  v: number;
  /** 24B nonce（base64）。 */
  n: string;
  /** XChaCha20-Poly1305 密文（base64，含 16B tag）。 */
  ct: string;
}

export function generateKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(E2E_KEY_BYTES));
}

export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(E2E_NONCE_BYTES));
}

export function sealPayload(
  plain: RelayJson,
  key: Uint8Array,
  nonce: Uint8Array = generateNonce(),
  cipher: Cipher = xchachaCipher,
): EncryptedPayload {
  const plaintext = new TextEncoder().encode(JSON.stringify(plain));
  return {
    nibi_type: "enc",
    v: E2E_ENVELOPE_VERSION,
    n: encodeWireBytesBase64(nonce),
    ct: encodeWireBytesBase64(cipher.encrypt(plaintext, key, nonce)),
  };
}

/** 错钥/篡改/版本不符 → null（调用方断连重协商，草案 §3）。 */
export function openPayload(
  envelope: EncryptedPayload,
  key: Uint8Array,
  cipher: Cipher = xchachaCipher,
): RelayJson | null {
  if (envelope.v !== E2E_ENVELOPE_VERSION) return null;
  const nonce = decodeWireBase64(envelope.n);
  const ciphertext = decodeWireBase64(envelope.ct);
  if (!nonce || nonce.length !== E2E_NONCE_BYTES || !ciphertext || ciphertext.length < 16) {
    return null;
  }
  try {
    const plaintext = cipher.decrypt(ciphertext, key, nonce);
    return JSON.parse(new TextDecoder().decode(plaintext)) as RelayJson;
  } catch {
    return null;
  }
}

export function isEncryptedPayload(payload: unknown): payload is EncryptedPayload {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return (
    record.nibi_type === "enc" &&
    typeof record.v === "number" &&
    typeof record.n === "string" &&
    typeof record.ct === "string"
  );
}
