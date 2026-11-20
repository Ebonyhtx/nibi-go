import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";

import { base64UrlToBytes, type LicenseClaims } from "../src/claims";
import { evaluatePluginLicense } from "../src/evaluate";
import type { LicenseKey } from "../src/keys";
import { verifyLicenseToken } from "../src/verify";

const encoder = new TextEncoder();
const NOW = 1_790_000_000_000; // 2026-09 左右，固定时间便于断言

function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const b1 = bytes[index]!;
    const b2 = bytes[index + 1];
    const b3 = bytes[index + 2];
    out += alphabet[b1 >> 2];
    out += alphabet[((b1 & 0x03) << 4) | ((b2 ?? 0) >> 4)];
    if (b2 === undefined) break;
    out += alphabet[((b2 & 0x0f) << 2) | ((b3 ?? 0) >> 6)];
    if (b3 === undefined) break;
    out += alphabet[b3 & 0x3f];
  }
  return out;
}

function keypair(salt = 5): { key: LicenseKey; seed: Uint8Array } {
  const seed = new Uint8Array(32);
  for (let index = 0; index < seed.length; index += 1) seed[index] = (index * 11 + salt) & 0xff;
  return { key: { kid: "test-kid", publicKeyHex: Buffer.from(ed25519.getPublicKey(seed)).toString("hex") }, seed };
}

function claims(overrides: Partial<LicenseClaims> = {}): LicenseClaims {
  return {
    iss: "nibi-license",
    sub: "user-1",
    uid: "user-1",
    plan: "pro",
    plugins: ["nibi.market.hello"],
    dev: "device-1",
    iat: Math.floor(NOW / 1000) - 60,
    exp: Math.floor(NOW / 1000) + 3600,
    jti: "license-1",
    ...overrides,
  };
}

function sign(payload: LicenseClaims, seed: Uint8Array, kid = "test-kid"): string {
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: "Ed25519", kid })));
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(ed25519.sign(encoder.encode(`${header}.${body}`), seed));
  return `${header}.${body}.${signature}`;
}

describe("verifyLicenseToken", () => {
  it("接受正确的 JWS 并返回 claims/kid", () => {
    const { key, seed } = keypair();
    const token = sign(claims(), seed);
    const verified = verifyLicenseToken(token, { "test-kid": key });
    expect(verified?.kid).toBe("test-kid");
    expect(verified?.claims.plan).toBe("pro");
  });

  it("payload 被改动后验签失败", () => {
    const { key, seed } = keypair();
    const token = sign(claims(), seed);
    const [header, body, signature] = token.split(".");
    const tamperedBody = bytesToBase64Url(
      encoder.encode(JSON.stringify({ ...claims(), plugins: ["*"] })),
    );
    expect(verifyLicenseToken(`${header}.${tamperedBody}.${signature}`, { "test-kid": key })).toBeNull();
  });

  it("未知 kid / 错误 iss 都失败", () => {
    const { key, seed } = keypair();
    expect(verifyLicenseToken(sign(claims(), seed), { other: key })).toBeNull();
    expect(verifyLicenseToken(sign(claims(), seed, "other"), { "test-kid": key })).toBeNull();
    const badIssuer = sign({ ...claims(), iss: "other" } as unknown as LicenseClaims, seed);
    expect(verifyLicenseToken(badIssuer, { "test-kid": key })).toBeNull();
  });

  it("claims 形状不合法失败", () => {
    const { key, seed } = keypair();
    const token = sign({ ...claims(), plugins: "all" } as unknown as LicenseClaims, seed);
    expect(verifyLicenseToken(token, { "test-kid": key })).toBeNull();
  });
});

describe("evaluatePluginLicense", () => {
  const { key, seed } = keypair();
  const keys = { "test-kid": key };
  const base = { pluginId: "nibi.market.hello", deviceId: "device-1", now: NOW, keys };

  it("覆盖该插件时放行", () => {
    const decision = evaluatePluginLicense({ ...base, token: sign(claims(), seed) });
    expect(decision).toMatchObject({ status: "active", allowed: true });
    expect(decision.expiresAt).toMatch(/^\d{4}-/u);
  });

  it('"*" 覆盖全部插件', () => {
    const decision = evaluatePluginLicense({ ...base, token: sign(claims({ plugins: ["*"] }), seed) });
    expect(decision.allowed).toBe(true);
  });

  it("未覆盖该插件时拒绝", () => {
    const decision = evaluatePluginLicense({
      ...base,
      pluginId: "nibi.other",
      token: sign(claims(), seed),
    });
    expect(decision).toMatchObject({ status: "not_covered", allowed: false });
  });

  it("过期拒绝", () => {
    const decision = evaluatePluginLicense({
      ...base,
      token: sign(claims({ exp: Math.floor(NOW / 1000) - 1 }), seed),
    });
    expect(decision).toMatchObject({ status: "expired", allowed: false });
  });

  it("设备不匹配/缺失都拒绝", () => {
    const token = sign(claims({ dev: "device-2" }), seed);
    expect(evaluatePluginLicense({ ...base, token })).toMatchObject({ status: "device_mismatch" });
    expect(evaluatePluginLicense({ ...base, deviceId: null, token })).toMatchObject({
      status: "device_mismatch",
    });
    const noDev = sign({ ...claims(), dev: undefined } as LicenseClaims, seed);
    expect(evaluatePluginLicense({ ...base, token: noDev })).toMatchObject({
      status: "device_mismatch",
    });
  });

  it("没有凭证返回 not_activated", () => {
    expect(evaluatePluginLicense({ ...base, token: null })).toMatchObject({
      status: "not_activated",
      allowed: false,
    });
  });

  it("坏凭证返回 denied", () => {
    expect(evaluatePluginLicense({ ...base, token: "a.b.c" })).toMatchObject({
      status: "denied",
      allowed: false,
    });
  });
});

describe("base64UrlToBytes", () => {
  it("解码与编码互逆", () => {
    const bytes = encoder.encode("nibi-license");
    const encoded = bytesToBase64Url(bytes);
    expect(base64UrlToBytes(encoded)).toEqual(bytes);
  });
});
