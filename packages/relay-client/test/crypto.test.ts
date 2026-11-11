import { describe, expect, it } from "vitest";

import { decodeWireBase64, encodeWireBytesBase64 } from "@nibi-go/shared-extract";

import {
  E2E_ENVELOPE_VERSION,
  generateKey,
  isEncryptedPayload,
  openPayload,
  sealPayload,
} from "../src/crypto";

describe("E2E 信封（XChaCha20-Poly1305，P3c JSON 文本帧）", () => {
  it("往返：加密 → 解密还原 JSON", () => {
    const key = generateKey();
    const plain = { nibi_type: "data", hello: "world", nested: { n: 1 } };
    const envelope = sealPayload(plain, key);
    expect(envelope).toMatchObject({ nibi_type: "enc", v: E2E_ENVELOPE_VERSION });
    expect(decodeWireBase64(envelope.n)).toHaveLength(24);
    expect(decodeWireBase64(envelope.ct)!.length).toBeGreaterThan(16);
    expect(openPayload(envelope, key)).toEqual(plain);
  });

  it("已知密文向量（与桌面实现同断言，防格式漂移）", () => {
    const key = new Uint8Array(32).fill(0x42);
    const nonce = new Uint8Array(24).fill(0x17);
    const envelope = sealPayload({ nibi_type: "ping", v: 1 }, key, nonce);
    // 该向量由 @noble/ciphers 生成；桌面侧（libsodium/CryptoKit）必须解出同一明文
    expect(envelope.ct).toBe("rHtk/LRWx9bBzyM4Bk3sfmob1j8yDA4FxhIJY1gIk+T2WVzeHZ0WWtBj");
    expect(openPayload(envelope, key)).toEqual({ nibi_type: "ping", v: 1 });
  });

  it("篡改密文/错钥/版本不符 → null", () => {
    const key = generateKey();
    const envelope = sealPayload({ x: 1 }, key);
    const tampered = {
      ...envelope,
      ct: encodeWireBytesBase64(
        (() => {
          const bytes = decodeWireBase64(envelope.ct)!;
          bytes[0] = bytes[0]! ^ 0xff;
          return bytes;
        })(),
      ),
    };
    expect(openPayload(tampered, key)).toBeNull();
    expect(openPayload(envelope, generateKey())).toBeNull();
    expect(openPayload({ ...envelope, v: 99 }, key)).toBeNull();
    expect(openPayload({ ...envelope, n: "short" }, key)).toBeNull();
  });

  it("信封识别（路由用）", () => {
    const key = generateKey();
    expect(isEncryptedPayload(sealPayload({ a: 1 }, key))).toBe(true);
    expect(isEncryptedPayload({ nibi_type: "enc", v: 1 })).toBe(false);
    expect(isEncryptedPayload({ nibi_type: "data" })).toBe(false);
    expect(isEncryptedPayload(null)).toBe(false);
  });
});
