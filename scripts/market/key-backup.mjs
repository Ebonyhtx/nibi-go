#!/usr/bin/env node
// 市场签名私钥的加密备份/恢复（与 Android keystore 同一纪律：仓库只放密文 + 口令分离保管）。
//
// 格式：JSON { v:1, kdf:"scrypt", salt, iv, ct, tag }，AES-256-GCM，口令经 scrypt 派生。
// 口令来源：环境变量 NIBI_MARKET_KEY_PASS → ~/.nibi/market/passphrase.txt。
//
// 用法：
//   node scripts/market/key-backup.mjs encrypt <keyId> [--out <file.enc>]
//   node scripts/market/key-backup.mjs decrypt <file.enc> [--out <key.json>]
//
// 私钥与口令都不打印；恢复后文件权限 0600。
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const mode = args[0];
const target = args[1];
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;

if (!mode || !target || !["encrypt", "decrypt"].includes(mode)) {
  console.error("用法：node scripts/market/key-backup.mjs <encrypt|decrypt> <keyId|file.enc> [--out <file>]");
  process.exit(1);
}

const marketDir = path.join(os.homedir(), ".nibi", "market");
const passFile = path.join(marketDir, "passphrase.txt");
const passphrase = process.env.NIBI_MARKET_KEY_PASS ?? (fs.existsSync(passFile) ? fs.readFileSync(passFile, "utf8").trim() : "");
if (!passphrase) {
  console.error(`找不到口令。设置 NIBI_MARKET_KEY_PASS，或写入 ${passFile}。`);
  process.exit(1);
}

const KDF_N = 1 << 15;
const KDF_R = 8;
const KDF_P = 1;
const KDF_MAXMEM = 64 * 1024 * 1024;

if (mode === "encrypt") {
  const keyFile = path.join(marketDir, `${target}.json`);
  if (!fs.existsSync(keyFile)) {
    console.error(`找不到私钥：${keyFile}`);
    process.exit(1);
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: KDF_N, r: KDF_R, p: KDF_P, maxmem: KDF_MAXMEM });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = fs.readFileSync(keyFile);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = {
    v: 1,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
  const destination = out ?? path.join(marketDir, `${target}.json.enc`);
  fs.writeFileSync(destination, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  console.log(`已加密：${destination}`);
  console.log("上传到私有仓（例如 private-key-backup-repository 的 keystore/），口令另行保管。");
  process.exit(0);
}

if (!fs.existsSync(target)) {
  console.error(`找不到密文：${target}`);
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(target, "utf8"));
if (payload?.v !== 1 || payload?.kdf !== "scrypt") {
  console.error("密文格式不认识。");
  process.exit(1);
}
const salt = Buffer.from(payload.salt, "base64");
const iv = Buffer.from(payload.iv, "base64");
const key = scryptSync(passphrase, salt, 32, { N: KDF_N, r: KDF_R, p: KDF_P, maxmem: KDF_MAXMEM });
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
let plaintext;
try {
  plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ct, "base64")), decipher.final()]);
} catch {
  console.error("解密失败：口令不对或密文被改动。");
  process.exit(1);
}
const destination = out ?? path.join(marketDir, "restored-key.json");
fs.writeFileSync(destination, plaintext, { mode: 0o600 });
console.log(`已恢复：${destination}（0600）`);
