#!/usr/bin/env node
// 发布签名密钥库工具：生成 / 加密备份 / 恢复 / 指纹校验。
//
// 设计要点（docs/checklists/发布检查单.md §0.2）：
//   - 本机 `~/.nibi/keystore/` 里只放"可丢弃的工作副本"；原件是加密备份 blob。
//   - blob 是密文，可以放私有仓/网盘，丢了也不泄露。
//   - 口令（32 字符 Crockford Base32，160 bit）由本脚本生成，直接写文件，**不回显**——
//     任何命令输出里都不会出现它。
//   - 加密：scrypt(N=2^16,r=8,p=1) 派生 + XChaCha20-Poly1305（与 App E2E 信封同一算法族），
//     文件头作为 AAD，口令错误即认证失败，不会产出半个坏文件。
//
// 用法：
//   node scripts/keystore.mjs init [--force]        生成密钥库 + 口令 + 加密备份
//   node scripts/keystore.mjs backup [--out <path>] 从工作副本重新导出加密备份
//   node scripts/keystore.mjs restore [<blob>] [--force]  从加密备份恢复工作副本
//   node scripts/keystore.mjs fingerprint           打印证书 SHA-256 指纹（公开信息）
//   node scripts/keystore.mjs verify <apk>          校验 APK 签名证书与密钥库一致
//
// 口令来源（按优先级）：环境变量 NIBI_KEYSTORE_PASSPHRASE → ~/.nibi/keystore/passphrase.txt
import { spawnSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const DIR = path.join(os.homedir(), ".nibi", "keystore");
const KEYSTORE = path.join(DIR, "nibi-go-release.p12");
const BLOB = path.join(DIR, "nibi-go-release.p12.enc");
const PASSFILE = path.join(DIR, "passphrase.txt");
const ALIAS = "nibi-go";
const DNAME = "CN=NIBI-GO, O=NIBI Studio, C=CN";

const MAGIC = Buffer.from("NIBIGOKS", "ascii");
const VERSION = 1;
const LOG_N = 16;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const HEADER_LEN = 52;
const SCRYPT_OPTS = { N: 1 << LOG_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 192 * 1024 * 1024 };

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function info(message) {
  console.log(message);
}

/** 32 字符 × 5 bit = 160 bit；256 % 32 === 0，取模无偏。 */
function newPassphrase() {
  const chars = Array.from(randomBytes(32), (byte) => CROCKFORD[byte % 32]).join("");
  return chars.match(/.{4}/g).join("-");
}

function normalizePassphrase(raw) {
  return raw.trim().replace(/-/g, "").toUpperCase();
}

/** 读取口令；allowCreate=true 时生成并落盘（不回显）。 */
function readPassphrase({ allowCreate = false } = {}) {
  const fromEnv = process.env.NIBI_KEYSTORE_PASSPHRASE;
  if (fromEnv && fromEnv.trim()) return normalizePassphrase(fromEnv);
  if (fs.existsSync(PASSFILE)) return normalizePassphrase(fs.readFileSync(PASSFILE, "utf8"));
  if (!allowCreate) {
    fail(`找不到口令。设置 NIBI_KEYSTORE_PASSPHRASE，或确认 ${PASSFILE} 存在。`);
  }
  const generated = newPassphrase();
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PASSFILE, `${generated}\n`, { mode: 0o600 });
  return normalizePassphrase(generated);
}

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase.normalize("NFKC"), salt, 32, SCRYPT_OPTS);
}

function pack(passphrase, plaintext) {
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0);
  header[8] = VERSION;
  header[9] = LOG_N;
  header[10] = SCRYPT_R;
  header[11] = SCRYPT_P;
  salt.copy(header, 12);
  nonce.copy(header, 28);
  const cipher = xchacha20poly1305(deriveKey(passphrase, salt), nonce, header);
  return Buffer.concat([header, Buffer.from(cipher.encrypt(plaintext))]);
}

function unpack(passphrase, blob) {
  if (blob.length <= HEADER_LEN) fail("备份文件损坏（长度不足）。");
  if (!blob.subarray(0, 8).equals(MAGIC)) fail("备份文件格式不符（magic 不匹配）。");
  if (blob[8] !== VERSION) fail(`备份文件版本不支持：${blob[8]}（本工具支持 ${VERSION}）。`);
  const salt = blob.subarray(12, 28);
  const nonce = blob.subarray(28, 52);
  const header = blob.subarray(0, HEADER_LEN);
  const cipher = xchacha20poly1305(deriveKey(passphrase, salt), nonce, header);
  try {
    return Buffer.from(cipher.decrypt(blob.subarray(HEADER_LEN)));
  } catch {
    fail("解密失败：口令不正确，或备份文件被篡改。");
  }
}

/** 通过 stdin 传口令，避免出现在进程参数里。 */
function runKeytool(args) {
  const passphrase = readPassphrase();
  const result = spawnSync("keytool", args, {
    input: `${passphrase}\n${passphrase}\n`,
    encoding: "utf8",
  });
  if (result.error) fail(`无法执行 keytool：${result.error.message}（确认 JDK 在 PATH 中）`);
  return result;
}

function keytoolFingerprint() {
  if (!fs.existsSync(KEYSTORE)) fail(`密钥库不存在：${KEYSTORE}`);
  const result = runKeytool(["-list", "-v", "-keystore", KEYSTORE, "-alias", ALIAS]);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = /SHA256:\s*([0-9A-F:]{95})/i.exec(output);
  if (!match) fail(`无法从 keytool 输出解析证书指纹。\n${output.trim()}`);
  return match[1].toUpperCase();
}

function apksignerPath() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
  ].filter(Boolean);
  for (const root of roots) {
    const buildTools = path.join(root, "build-tools");
    if (!fs.existsSync(buildTools)) continue;
    const versions = fs
      .readdirSync(buildTools)
      .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => {
        const [a1, a2, a3] = a.split(".").map(Number);
        const [b1, b2, b3] = b.split(".").map(Number);
        return a1 - b1 || a2 - b2 || a3 - b3;
      })
      .reverse();
    for (const version of versions) {
      const candidate = path.join(buildTools, version, process.platform === "win32" ? "apksigner.bat" : "apksigner");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function apkFingerprint(apkPath) {
  const apksigner = apksignerPath();
  if (!apksigner) fail("找不到 apksigner（检查 ANDROID_HOME / build-tools）。");
  // apksigner 在 Windows 上是 .bat，必须经 cmd.exe 调用（不用 shell:true，避免参数拼接告警）
  const [command, prefix] =
    process.platform === "win32" ? [process.env.ComSpec ?? "cmd.exe", ["/c", apksigner]] : [apksigner, []];
  const result = spawnSync(command, [...prefix, "verify", "--print-certs", apkPath], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) fail(`apksigner 校验失败：\n${output.trim()}`);
  const match = /certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(output);
  if (!match) fail(`无法从 apksigner 输出解析证书摘要。\n${output.trim()}`);
  return match[1].toUpperCase().match(/.{2}/g).join(":");
}

function writeBackup(passphrase, outPath = BLOB) {
  const plaintext = fs.readFileSync(KEYSTORE);
  const blob = pack(passphrase, plaintext);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, blob, { mode: 0o600 });
  return outPath;
}

const commands = {
  init(args) {
    const force = args.includes("--force");
    if (fs.existsSync(KEYSTORE) && !force) {
      fail(`密钥库已存在：${KEYSTORE}\n如确需重建（会让已发布版本无法覆盖升级），加 --force。`);
    }
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    if (force) fs.rmSync(KEYSTORE, { force: true });

    const passphrase = readPassphrase({ allowCreate: true });
    const result = spawnSync(
      "keytool",
      [
        "-genkeypair",
        "-keystore",
        KEYSTORE,
        "-storetype",
        "PKCS12",
        "-alias",
        ALIAS,
        "-keyalg",
        "RSA",
        "-keysize",
        "4096",
        "-validity",
        "10000",
        "-dname",
        DNAME,
      ],
      { input: `${passphrase}\n${passphrase}\n`, encoding: "utf8" },
    );
    if (result.error) fail(`无法执行 keytool：${result.error.message}（确认 JDK 在 PATH 中）`);
    if (result.status !== 0) fail(`keytool 生成失败：\n${`${result.stdout ?? ""}${result.stderr ?? ""}`.trim()}`);
    if (!fs.existsSync(KEYSTORE)) fail("keytool 返回成功但密钥库文件不存在。");

    const blobPath = writeBackup(passphrase);
    const fingerprint = keytoolFingerprint();

    info("密钥库已生成。");
    info(`  工作副本：${KEYSTORE}`);
    info(`  加密备份：${blobPath}`);
    info(`  口令文件：${PASSFILE}（内容未显示；抄录/导入后请删除）`);
    info(`  证书 SHA-256：${fingerprint}`);
    info("");
    info("下一步：");
    info("  1) 把口令从 passphrase.txt 抄到你的保管处（纸质/密码管理器），然后删除该文件");
    info("  2) 把加密备份提交到私有保管仓（见 docs/checklists/发布检查单.md）");
    info("  3) 把上面的证书指纹登记到 SECURITY.md");
  },

  backup(args) {
    const index = args.indexOf("--out");
    const outPath = index >= 0 ? args[index + 1] : BLOB;
    if (!outPath) fail("--out 需要跟一个路径。");
    if (!fs.existsSync(KEYSTORE)) fail(`密钥库不存在：${KEYSTORE}`);
    const blobPath = writeBackup(readPassphrase(), outPath);
    info(`加密备份已写入：${blobPath}`);
  },

  restore(args) {
    const force = args.includes("--force");
    const blobPath = args.find((arg) => !arg.startsWith("--")) ?? BLOB;
    if (!fs.existsSync(blobPath)) fail(`备份文件不存在：${blobPath}`);
    if (fs.existsSync(KEYSTORE) && !force) {
      fail(`工作副本已存在：${KEYSTORE}\n加 --force 覆盖。`);
    }
    const plaintext = unpack(readPassphrase(), fs.readFileSync(blobPath));
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEYSTORE, plaintext, { mode: 0o600 });
    info(`工作副本已恢复：${KEYSTORE}`);
    info(`证书 SHA-256：${keytoolFingerprint()}`);
  },

  fingerprint() {
    info(keytoolFingerprint());
  },

  verify(args) {
    const apkPath = args[0];
    if (!apkPath) fail("用法：node scripts/keystore.mjs verify <apk>");
    if (!fs.existsSync(apkPath)) fail(`APK 不存在：${apkPath}`);
    const expected = keytoolFingerprint();
    const actual = apkFingerprint(apkPath);
    if (expected !== actual) {
      fail(`签名证书不匹配！\n  密钥库：${expected}\n  APK：   ${actual}`);
    }
    info(`签名证书一致：${actual}`);
  },

  /** 删除本机工作副本（原件在加密备份里，可随时 restore）。 */
  wipe(args) {
    if (!args.includes("--yes")) {
      fail(`这会删除工作副本 ${KEYSTORE}（加密备份不受影响）。确认请加 --yes。`);
    }
    fs.rmSync(KEYSTORE, { force: true });
    info(`工作副本已删除。需要时：node scripts/keystore.mjs restore`);
  },
};

const [command, ...rest] = process.argv.slice(2);
if (!command || !commands[command]) {
  fail(`用法：node scripts/keystore.mjs <${Object.keys(commands).join("|")}> [参数]`);
}
commands[command](rest);
