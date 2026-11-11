#!/usr/bin/env node
// 发版流水线：版本号 → 门禁/测试 → prebuild → release 构建 → 验签 → SHA-256 → GitHub Release。
//
// 用法：
//   node scripts/release.mjs 0.1.1 [--notes "说明"] [--dry-run]
//
// 前提（一次性）：node scripts/keystore.mjs init 已执行，或从私有保管仓恢复过工作副本。
// 口令来源：环境变量 NIBI_KEYSTORE_PASS → ~/.nibi/keystore/passphrase.txt。
// 口令只传给 gradle 子进程，不打印、不写盘、不进日志。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_JSON = path.join(ROOT, "app", "app.json");
const RELEASE_REPO = process.env.NIBI_RELEASE_REPO || "Ebonyhtx/nibi-go";
const KEYSTORE = path.join(os.homedir(), ".nibi", "keystore", "nibi-go-release.p12");
const PASSFILE = path.join(os.homedir(), ".nibi", "keystore", "passphrase.txt");
const APK = path.join(ROOT, "app", "android", "app", "build", "outputs", "apk", "release", "app-release.apk");

class ReleaseError extends Error {}

function step(message) {
  console.log(`\n== ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error) throw new ReleaseError(`无法执行 ${command}：${result.error.message}`);
  if (result.status !== 0) {
    if (options.capture) console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    throw new ReleaseError(`${command} 执行失败（退出码 ${result.status}）`);
  }
  return options.capture ? `${result.stdout ?? ""}`.trim() : "";
}

function readPassphrase() {
  const raw = process.env.NIBI_KEYSTORE_PASS ?? (fs.existsSync(PASSFILE) ? fs.readFileSync(PASSFILE, "utf8") : "");
  const normalized = raw.trim().replace(/-/g, "").toUpperCase();
  if (!normalized) {
    throw new ReleaseError(`找不到签名口令。设置 NIBI_KEYSTORE_PASS，或恢复 ${PASSFILE}。`);
  }
  return normalized;
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const args = process.argv.slice(2);
const version = args.find((arg) => /^\d+\.\d+\.\d+$/.test(arg));
const dryRun = args.includes("--dry-run");
const notesIndex = args.indexOf("--notes");
const notes = notesIndex >= 0 ? args[notesIndex + 1] : undefined;

if (!version) {
  console.error('用法：node scripts/release.mjs <X.Y.Z> [--notes "说明"] [--dry-run]');
  process.exit(1);
}

const original = fs.readFileSync(APP_JSON, "utf8");
const config = JSON.parse(original);
const current = config.expo.version;
const currentCode = Number(config.expo.android?.versionCode ?? 0);

if (version === current) {
  console.error(`错误：版本号未变化（当前 ${current}）。`);
  process.exit(1);
}

console.log(`发版 ${current} → ${version}（versionCode ${currentCode} → ${currentCode + 1}）`);
if (dryRun) {
  console.log("dry-run：只打印计划，不修改文件、不构建、不发布。");
  process.exit(0);
}

// 1) 版本号：version 与 versionCode 必须同时前进（Android 只认 versionCode）
config.expo.version = version;
config.expo.android = { ...config.expo.android, versionCode: currentCode + 1 };
fs.writeFileSync(APP_JSON, `${JSON.stringify(config, null, 2)}\n`);

try {
  // 2) 门禁 + 测试 + 类型检查
  step("门禁与测试");
  run("node", ["scripts/check-boundaries.mjs"]);
  run("node", ["scripts/check-public-repo.mjs"]);
  run("pnpm", ["-r", "--if-present", "run", "test"]);
  run("pnpm", ["-r", "--if-present", "run", "typecheck"]);

  // 3) 签名密钥库（工作副本缺失时提示恢复，不自动从远端拉）
  step("检查签名密钥库");
  if (!fs.existsSync(KEYSTORE)) {
    throw new ReleaseError(
      `签名密钥库不存在：${KEYSTORE}\n先运行：node scripts/keystore.mjs restore <私有仓里的 .enc>`,
    );
  }
  const passphrase = readPassphrase();

  // 4) prebuild：version/versionCode 与 config plugin 注入都要重新落到 android/
  step("expo prebuild（同步版本号与原生配置）");
  run("npx", ["expo", "prebuild", "--platform", "android", "--no-install"], {
    cwd: path.join(ROOT, "app"),
  });

  // 5) release 构建（--no-daemon：daemon 会缓存环境变量，导致口令读不到；
  //    -PreactNativeArchitectures：只出 arm64，APK 从 ~100MB 降到 ~30MB，构建也快）
  step("assembleRelease");
  run(
    process.platform === "win32" ? "gradlew.bat" : "./gradlew",
    ["assembleRelease", "--no-daemon", "-PreactNativeArchitectures=arm64-v8a"],
    {
      cwd: path.join(ROOT, "app", "android"),
      env: { NIBI_KEYSTORE_PASS: passphrase, NIBI_KEYSTORE_FILE: KEYSTORE },
    },
  );

  // 6) 验签：证书必须与密钥库一致（防止静默回落到 debug 签名）
  step("校验 APK 签名证书");
  run("node", ["scripts/keystore.mjs", "verify", APK]);
  const digest = sha256File(APK);

  // 7) 发布
  step(`发布 v${version} 到 ${RELEASE_REPO}`);
  const releaseNotes =
    notes ??
    run("git", ["log", "--pretty=format:- %s", "-n", "20"], { capture: true })
      .split("\n")
      .filter(Boolean)
      .join("\n");
  run("gh", [
    "release",
    "create",
    `v${version}`,
    APK,
    "--repo",
    RELEASE_REPO,
    "--title",
    `v${version}`,
    "--notes",
    releaseNotes,
  ]);

  // 8) 发布后校验：GitHub 必须为资产算出 digest，否则客户端 fail-closed 拒绝更新
  step("校验发布资产的 SHA-256 摘要");
  const assetDigest = run(
    "gh",
    ["api", `repos/${RELEASE_REPO}/releases/tags/v${version}`, "-q", ".assets[0].digest"],
    { capture: true },
  );
  if (!assetDigest.startsWith("sha256:")) {
    throw new ReleaseError(
      `GitHub 未返回资产 digest（${assetDigest || "空"}）。客户端会拒绝安装该版本，请检查发布。`,
    );
  }
  if (assetDigest.slice("sha256:".length).toLowerCase() !== digest) {
    throw new ReleaseError(`本地摘要与 GitHub digest 不一致：\n  本地 ${digest}\n  远端 ${assetDigest}`);
  }

  console.log(`\n完成：v${version}`);
  console.log(`  APK    ${APK}`);
  console.log(`  SHA256 ${digest}`);
  console.log(`  发布   https://github.com/${RELEASE_REPO}/releases/tag/v${version}`);
  console.log("\n本机工作副本仍保留。清理：node scripts/keystore.mjs wipe --yes");
} catch (error) {
  fs.writeFileSync(APP_JSON, original);
  console.error(`\n错误：${error.message}`);
  console.error(`app.json 已回滚到 ${current}。`);
  process.exit(1);
}
