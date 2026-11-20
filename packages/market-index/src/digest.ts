// 包字节的摘要校验：安装前必须用清单里的 sha256 校验下载到的字节。
// 纯 TS（@noble/hashes），Node 与 Hermes 都能跑。
import { sha256 } from "@noble/hashes/sha2.js";

const HEX_RE = /^[0-9a-f]{64}$/u;

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** 严格 hex 解码：长度必须是偶数、字符必须是 0-9a-f；坏输入返回 null。 */
export function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(value)) return null;
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function isSha256Hex(value: string): boolean {
  return HEX_RE.test(value);
}

/** 摘要是否与期望一致（大小写不敏感；期望值非法一律不通过）。 */
export function verifyPackageDigest(bytes: Uint8Array, expectedHex: string): boolean {
  const expected = expectedHex.trim().toLowerCase();
  if (!isSha256Hex(expected)) return false;
  return sha256Hex(bytes) === expected;
}
