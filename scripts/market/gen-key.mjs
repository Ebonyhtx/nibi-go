#!/usr/bin/env node
// 生成市场索引的 Ed25519 签名密钥（一次性）。
//
// 私钥只落在本机 `~/.nibi/market/<keyId>.json`（0600），不进仓库、不进对话；
// 公钥（raw 32B）由运营者抄进 `packages/market-index/src/keys.ts` 后随客户端发布。
// 备份：把该 json 放进私有运维仓（与 Android keystore 同一纪律），丢了只能换 keyId 重新发版。
//
// 用法：node scripts/market/gen-key.mjs [--id nibi-go-market-2026-11] [--force]
import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const idIndex = args.indexOf("--id");
const keyId = idIndex >= 0 ? args[idIndex + 1] : "nibi-go-market-2026-11";
const force = args.includes("--force");

if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(keyId)) {
  console.error("keyId 不合法（小写字母/数字/._-）。");
  process.exit(1);
}

const dir = path.join(os.homedir(), ".nibi", "market");
const file = path.join(dir, `${keyId}.json`);
if (fs.existsSync(file) && !force) {
  console.error(`密钥已存在：${file}\n确认要覆盖（会作废现有签名）再加 --force。`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privJwk = privateKey.export({ format: "jwk" });
const pubJwk = publicKey.export({ format: "jwk" });

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(
  file,
  `${JSON.stringify({ keyId, createdAt: new Date().toISOString(), privateJwk: privJwk }, null, 2)}\n`,
  { mode: 0o600 },
);

const rawPublic = Buffer.from(pubJwk.x, "base64url");
const fingerprint = createHash("sha256").update(rawPublic).digest("hex").slice(0, 16);

console.log(`已生成：${file}（0600，不要提交）`);
console.log(`keyId        ${keyId}`);
console.log(`publicKey    ${rawPublic.toString("base64")}`);
console.log(`fingerprint  ${fingerprint}`);
console.log("\n把 publicKey 写进 packages/market-index/src/keys.ts，然后把该 json 备份到私有运维仓。");
