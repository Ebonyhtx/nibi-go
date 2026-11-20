#!/usr/bin/env node
// 给市场索引签名：对 index.json 的**原始字节**做 Ed25519 签名，输出 detached hex 侧车。
//
// 客户端拿到的就是 index.json + index.json.sig 两个文件：先验字节，再 JSON.parse。
// 签名只保完整性；防回滚靠 index.json 里单调递增的 revision（客户端持久化上次接受的 revision）。
//
// 用法：
//   node scripts/market/sign-index.mjs <index.json> [--key <keyId>] [--out <sig 路径>]
// 私钥默认读 ~/.nibi/market/<keyId>.json（由 gen-key.mjs 生成）。
import { createHash, createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--key" || arg === "--out") {
    index += 1;
    continue;
  }
  if (arg.startsWith("--")) continue;
  positional.push(arg);
}
const input = positional[0];
if (!input) {
  console.error("用法：node scripts/market/sign-index.mjs <index.json> [--key <keyId>] [--out <sig>]");
  process.exit(1);
}

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const keyId = option("key", "nibi-go-market-2026-11");
const out = option("out", `${input}.sig`);
const keyFile = path.join(os.homedir(), ".nibi", "market", `${keyId}.json`);

if (!fs.existsSync(input)) {
  console.error(`找不到索引文件：${input}`);
  process.exit(1);
}
if (!fs.existsSync(keyFile)) {
  console.error(`找不到私钥：${keyFile}\n先运行 node scripts/market/gen-key.mjs --id ${keyId}`);
  process.exit(1);
}

const bytes = fs.readFileSync(input);
const { privateJwk } = JSON.parse(fs.readFileSync(keyFile, "utf8"));
const privateKey = createPrivateKey({ key: privateJwk, format: "jwk" });
const signature = sign(null, bytes, privateKey);

fs.writeFileSync(out, `${signature.toString("hex")}\n`);

const digest = createHash("sha256").update(bytes).digest("hex");
let revision = "?";
try {
  revision = String(JSON.parse(bytes.toString("utf8")).revision ?? "?");
} catch {
  // 索引 JSON 坏了也照签，方便排查；客户端会因为 schema 不合法拒绝。
}
console.log(`已签名：${input}`);
console.log(`  keyId    ${keyId}`);
console.log(`  revision ${revision}`);
console.log(`  sha256   ${digest}`);
console.log(`  签名     ${out}`);
