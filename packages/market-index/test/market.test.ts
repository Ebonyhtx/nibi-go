import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createPrivateKey, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bytesToHex, verifyPackageDigest } from "../src/digest";
import { NIBI_MARKET_KEYS, type MarketKey } from "../src/keys";
import {
  checkPluginPins,
  comparePluginVersions,
  evaluateMarketRefresh,
  snapshotStateOf,
} from "../src/rollback";
import type { MarketIndex, MarketPluginEntry } from "../src/types";
import { verifyMarketIndexBytes } from "../src/verify";

const encoder = new TextEncoder();

function makePlugin(overrides: Partial<MarketPluginEntry> = {}): MarketPluginEntry {
  return {
    id: "nibi.weather",
    name: "Weather",
    version: "1.0.0",
    caps: ["mcp.v1"],
    package: {
      url: "https://example.com/weather-1.0.0.zip",
      sha256: "a".repeat(64),
      size: 1024,
      format: "zip",
    },
    ...overrides,
  };
}

function makeIndex(overrides: Partial<MarketIndex> = {}): MarketIndex {
  return {
    schemaVersion: 1,
    market: "nibi-official",
    revision: 1,
    generatedAt: "2026-11-20T00:00:00.000Z",
    plugins: [makePlugin()],
    ...overrides,
  };
}

function keypair(): { key: MarketKey; seed: Uint8Array } {
  const seed = new Uint8Array(32);
  for (let index = 0; index < seed.length; index += 1) seed[index] = (index * 7 + 3) & 0xff;
  const publicKey = ed25519.getPublicKey(seed);
  return {
    key: { id: "test-key", publicKeyHex: bytesToHex(publicKey), fingerprint: "test" },
    seed,
  };
}

function sign(bytes: Uint8Array, seed: Uint8Array): string {
  return bytesToHex(ed25519.sign(bytes, seed));
}

function signed(index: unknown, seed: Uint8Array): { bytes: Uint8Array; signature: string } {
  const bytes = encoder.encode(JSON.stringify(index));
  return { bytes, signature: sign(bytes, seed) };
}

describe("verifyMarketIndexBytes", () => {
  it("接受正确的签名并返回 index 与摘要", () => {
    const { key, seed } = keypair();
    const { bytes, signature } = signed(makeIndex({ revision: 7 }), seed);
    const result = verifyMarketIndexBytes(bytes, signature, { keys: [key] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index.revision).toBe(7);
    expect(result.keyId).toBe("test-key");
    expect(result.indexSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("字节被改动后验签失败", () => {
    const { key, seed } = keypair();
    const { bytes, signature } = signed(makeIndex(), seed);
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 2] ^= 0x01;
    const result = verifyMarketIndexBytes(tampered, signature, { keys: [key] });
    expect(result).toEqual({ ok: false, error: "bad-signature" });
  });

  it("签名格式不合法直接拒绝", () => {
    const { key, seed } = keypair();
    const { bytes } = signed(makeIndex(), seed);
    expect(verifyMarketIndexBytes(bytes, "zz", { keys: [key] })).toMatchObject({
      ok: false,
      error: "bad-signature",
    });
    expect(verifyMarketIndexBytes(bytes, "ab".repeat(64), { keys: [key] })).toMatchObject({
      ok: false,
      error: "bad-signature",
    });
  });

  it("没有可用公钥时报 unknown-key", () => {
    const { seed } = keypair();
    const { bytes, signature } = signed(makeIndex(), seed);
    expect(verifyMarketIndexBytes(bytes, signature, { keys: [] })).toMatchObject({
      ok: false,
      error: "unknown-key",
    });
  });

  it("签了名但 JSON 坏掉报 bad-json", () => {
    const { key, seed } = keypair();
    const bytes = encoder.encode("{not json");
    const result = verifyMarketIndexBytes(bytes, sign(bytes, seed), { keys: [key] });
    expect(result).toMatchObject({ ok: false, error: "bad-json" });
  });

  it("形状不合法报 bad-schema（带路径）", () => {
    const { key, seed } = keypair();
    const { bytes, signature } = signed({ ...makeIndex(), revision: 0 }, seed);
    const result = verifyMarketIndexBytes(bytes, signature, { keys: [key] });
    expect(result).toMatchObject({ ok: false, error: "bad-schema" });
    if (result.ok) return;
    expect(result.detail).toContain("/revision");
  });

  it("非 https 的包地址被拒绝", () => {
    const { key, seed } = keypair();
    const index = makeIndex({
      plugins: [makePlugin({ package: { url: "http://example.com/a.zip", sha256: "b".repeat(64), size: 1, format: "zip" } })],
    });
    const { bytes, signature } = signed(index, seed);
    expect(verifyMarketIndexBytes(bytes, signature, { keys: [key] })).toMatchObject({
      ok: false,
      error: "bad-schema",
    });
  });

  it("重复插件 id 被拒绝", () => {
    const { key, seed } = keypair();
    const index = makeIndex({ plugins: [makePlugin(), makePlugin({ version: "1.0.1" })] });
    const { bytes, signature } = signed(index, seed);
    expect(verifyMarketIndexBytes(bytes, signature, { keys: [key] })).toMatchObject({
      ok: false,
      error: "duplicate-plugin",
    });
  });
});

describe("verifyPackageDigest", () => {
  it("匹配时通过，不匹配/非法期望值失败", () => {
    const bytes = encoder.encode("nibi");
    const hex = bytesToHex(sha256(bytes));
    expect(verifyPackageDigest(bytes, hex)).toBe(true);
    expect(verifyPackageDigest(bytes, "0".repeat(64))).toBe(false);
    expect(verifyPackageDigest(bytes, "not-a-digest")).toBe(false);
  });
});

describe("evaluateMarketRefresh", () => {
  const previous = { market: "nibi-official", revision: 5, indexSha256: "a".repeat(64) };

  it("首次刷新接受", () => {
    expect(evaluateMarketRefresh(null, { ...previous, revision: 1 })).toEqual({ kind: "accept" });
  });

  it("revision 前进接受", () => {
    expect(evaluateMarketRefresh(previous, { ...previous, revision: 6 })).toEqual({ kind: "accept" });
  });

  it("同 revision 同字节视为未变化", () => {
    expect(evaluateMarketRefresh(previous, { ...previous })).toEqual({ kind: "unchanged" });
  });

  it("同 revision 不同字节按冲突拒绝", () => {
    const decision = evaluateMarketRefresh(previous, { ...previous, indexSha256: "b".repeat(64) });
    expect(decision).toMatchObject({ kind: "reject", reason: "revision-conflict" });
  });

  it("revision 倒退按回滚拒绝", () => {
    const decision = evaluateMarketRefresh(previous, { ...previous, revision: 4 });
    expect(decision).toMatchObject({ kind: "reject", reason: "rollback" });
  });

  it("市场 id 不一致拒绝", () => {
    const decision = evaluateMarketRefresh(previous, { ...previous, market: "other" });
    expect(decision).toMatchObject({ kind: "reject", reason: "market-mismatch" });
  });

  it("snapshotStateOf 保留 market/revision/摘要", () => {
    const index = makeIndex({ revision: 9 });
    expect(snapshotStateOf(index, "c".repeat(64))).toEqual({
      market: "nibi-official",
      revision: 9,
      indexSha256: "c".repeat(64),
    });
  });
});

describe("checkPluginPins", () => {
  it("首次没有基线时通过", () => {
    expect(checkPluginPins(null, makeIndex())).toEqual({ ok: true });
  });

  it("同版本摘要变化按冲突拒绝", () => {
    const before = makeIndex();
    const after = makeIndex({
      revision: 2,
      plugins: [makePlugin({ package: { ...makePlugin().package, sha256: "d".repeat(64) } })],
    });
    expect(checkPluginPins(before, after)).toMatchObject({
      ok: false,
      conflicts: [{ id: "nibi.weather", version: "1.0.0", reason: "digest-changed" }],
    });
  });

  it("版本倒退按冲突拒绝", () => {
    const before = makeIndex({ plugins: [makePlugin({ version: "1.2.0" })] });
    const after = makeIndex({ revision: 2, plugins: [makePlugin({ version: "1.1.9" })] });
    expect(checkPluginPins(before, after)).toMatchObject({
      ok: false,
      conflicts: [{ id: "nibi.weather", version: "1.1.9", reason: "version-regressed" }],
    });
  });

  it("版本前进允许换摘要", () => {
    const before = makeIndex();
    const after = makeIndex({
      revision: 2,
      plugins: [makePlugin({ version: "1.0.1", package: { ...makePlugin().package, sha256: "e".repeat(64) } })],
    });
    expect(checkPluginPins(before, after)).toEqual({ ok: true });
  });

  it("comparePluginVersions 忽略构建后缀", () => {
    expect(comparePluginVersions("1.2.3", "1.2.3+build.5")).toBe(0);
    expect(comparePluginVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(comparePluginVersions("1.2.10", "1.2.9")).toBe(1);
    expect(comparePluginVersions("1.2", "1.2.1")).toBe(-1);
  });
});

describe("发布链与客户端的一致性", () => {
  it("node:crypto 签出的字节能被客户端验签通过", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rawPublic = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
    const key: MarketKey = { id: "node-key", publicKeyHex: rawPublic.toString("hex"), fingerprint: "test" };
    const bytes = encoder.encode(JSON.stringify(makeIndex({ revision: 3 })));
    const signature = nodeSign(null, bytes, privateKey).toString("hex");
    const result = verifyMarketIndexBytes(bytes, signature, { keys: [key] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.keyId).toBe("node-key");
  });

  const productionKeyFile = path.join(os.homedir(), ".nibi", "market", "nibi-go-market-2026-11.json");
  it.skipIf(!fs.existsSync(productionKeyFile))("本机生产私钥签出的索引能通过内置公钥", () => {
    const { privateJwk } = JSON.parse(fs.readFileSync(productionKeyFile, "utf8")) as {
      privateJwk: { kty: string; crv: string; x: string; d: string };
    };
    const privateKey = createPrivateKey({ key: privateJwk, format: "jwk" });
    const bytes = encoder.encode(JSON.stringify(makeIndex({ revision: 42 })));
    const signature = nodeSign(null, bytes, privateKey).toString("hex");
    const result = verifyMarketIndexBytes(bytes, signature);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyId).toBe(NIBI_MARKET_KEYS[0]!.id);
      expect(result.index.revision).toBe(42);
    }
  });
});
