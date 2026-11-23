#!/usr/bin/env node
// 发版流水线：版本号 → 门禁/测试 → prebuild → release 构建 → 验签 → SHA-256 → GitHub Release。
//
// 用法：
//   node scripts/release.mjs 0.1.1 [--notes "说明"] [--dry-run]
//   node scripts/release.mjs 0.1.1 --no-bump          # 版本号已单独提交
//   node scripts/release.mjs 0.1.1 --cdn-only         # GitHub 已发布，补发 CDN 清单
//
// 前提（一次性）：node scripts/keystore.mjs init 已执行，或从私有保管仓恢复过工作副本。
// 口令来源：环境变量 NIBI_KEYSTORE_PASS → ~/.nibi/keystore/passphrase.txt。
// 口令只传给 gradle 子进程，不打印、不写盘、不进日志。
import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_JSON = path.join(ROOT, "app", "app.json");
const RELEASE_REPO = process.env.NIBI_RELEASE_REPO || "Ebonyhtx/nibi-go";
// 密钥库位置可用 NIBI_KEYSTORE_FILE 覆盖（与 app/android 的 gradle 配置同一变量名）；
// 缺省仍是 keystore.mjs restore 落盘的标准位置。
const KEYSTORE =
  process.env.NIBI_KEYSTORE_FILE || path.join(os.homedir(), ".nibi", "keystore", "release.p12");
const PASSFILE = path.join(os.homedir(), ".nibi", "keystore", "passphrase.txt");
const APK = path.join(ROOT, "app", "android", "app", "build", "outputs", "apk", "release", "app-release.apk");

// 国内 CDN 发布（可选但推荐）：环境变量全部从本机/运维注入，公开仓不写主机、桶或凭据。
// 上传路径：本机 → SSH 目标临时目录 → ossutil cp → OSS；客户端只从 CDN/GitHub 下载，不经过中转机。
const CDN_BASE = (process.env.NIBI_RELEASE_CDN_BASE?.trim() || "https://dl.nibistudio.cn").replace(/\/+$/u, "");
const CDN_PREFIX = (process.env.NIBI_RELEASE_CDN_PREFIX?.trim() || "nibi-go-app").replace(/^\/+|\/+$/gu, "");
const CDN_SSH = process.env.NIBI_RELEASE_CDN_SSH?.trim() || "";
const CDN_REMOTE_DIR = (process.env.NIBI_RELEASE_CDN_REMOTE_DIR?.trim() || "/tmp/nibi-go-release").replace(/\/+$/u, "");
const CDN_OSS_PREFIX = (process.env.NIBI_RELEASE_CDN_OSS_PREFIX?.trim() || "").replace(/\/+$/u, "");
const CDN_OSS_CONF = process.env.NIBI_RELEASE_CDN_OSS_CONF?.trim() || "";
const CDN_SUDO = process.env.NIBI_RELEASE_CDN_SUDO === "1";
const CDN_REQUESTED = Boolean(CDN_SSH || CDN_OSS_PREFIX || CDN_OSS_CONF);
const CDN_READY = Boolean(CDN_SSH && CDN_OSS_PREFIX && CDN_OSS_CONF);
const MANIFEST_KEY_ID = process.env.NIBI_RELEASE_MANIFEST_KEY?.trim() || "nibi-go-market-2026-11";
// 与 packages/market-index/src/keys.ts 的 nibi-go-market-2026-11 公钥同步（公开值）。
const MANIFEST_PUBLIC_KEY_HEX = "90c6acbb9a020d1d567807620250a56e5822e70324b894bbc3a03fe3a6a2fd04";
const MIN_VERSION_CODE_RAW = process.env.NIBI_RELEASE_MIN_VERSION_CODE?.trim();
const MIN_VERSION_CODE = MIN_VERSION_CODE_RAW ? Number(MIN_VERSION_CODE_RAW) : null;

class ReleaseError extends Error {}

function step(message) {
  console.log(`\n== ${message}`);
}

function run(command, args, options = {}) {
  const stdio = options.input
    ? ["pipe", options.capture ? "pipe" : "inherit", options.capture ? "pipe" : "inherit"]
    : options.capture
      ? "pipe"
      : "inherit";
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio,
    input: options.input,
    encoding: "utf8",
    // Windows 上 pnpm/gradlew.bat 是 .cmd，必须经 shell；gh.exe/git 这类真 exe 显式关掉，
    // 否则 spawnSync(shell:true) 只是把参数拼成命令行，带空格的 --notes 会被拆成多个资产路径。
    shell: options.shell ?? process.platform === "win32",
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

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validateCdnConfig() {
  if (CDN_REQUESTED && !CDN_READY) {
    throw new ReleaseError(
      "CDN 发布环境变量不完整：需要 NIBI_RELEASE_CDN_SSH、NIBI_RELEASE_CDN_OSS_PREFIX、NIBI_RELEASE_CDN_OSS_CONF。",
    );
  }
  if (CDN_READY && !CDN_OSS_PREFIX.endsWith(`/${CDN_PREFIX}`)) {
    throw new ReleaseError(
      `CDN 前缀不一致：NIBI_RELEASE_CDN_OSS_PREFIX 必须以 /${CDN_PREFIX} 结尾。`,
    );
  }
  if (MIN_VERSION_CODE_RAW && (!Number.isInteger(MIN_VERSION_CODE) || MIN_VERSION_CODE <= 0)) {
    throw new ReleaseError("NIBI_RELEASE_MIN_VERSION_CODE 必须是正整数。");
  }
}

function sshRun(command, options = {}) {
  return run("ssh", [CDN_SSH, command], { shell: false, ...options });
}

function scpToRemote(localPath, relative) {
  const rel = path.relative(ROOT, localPath);
  if (rel.startsWith("..")) {
    throw new ReleaseError("待上传文件不在仓库目录内，无法用相对路径 scp。");
  }
  run("scp", [rel, `${CDN_SSH}:${CDN_REMOTE_DIR}/${relative}`], {
    shell: false,
    cwd: ROOT,
  });
}

function uploadOss(relative) {
  const sudo = CDN_SUDO ? "sudo -n " : "";
  sshRun(
    `${sudo}ossutil cp -f ${CDN_REMOTE_DIR}/${relative} ${CDN_OSS_PREFIX}/${relative} --config-file ${CDN_OSS_CONF}`,
  );
}

function verifyOss(relative, expectedSha256) {
  const sudo = CDN_SUDO ? "sudo -n " : "";
  const verifyFile = `${CDN_REMOTE_DIR}/verify.bin`;
  const output = sshRun(
    `${sudo}ossutil cp -f ${CDN_OSS_PREFIX}/${relative} ${verifyFile} --config-file ${CDN_OSS_CONF} && sha256sum ${verifyFile}`,
    { capture: true },
  );
  const actual = output.trim().split(/\s+/u)[0]?.toLowerCase();
  if (actual !== expectedSha256.toLowerCase()) {
    throw new ReleaseError(`CDN 回读摘要不一致：${relative}\n  本地 ${expectedSha256}\n  远端 ${actual}`);
  }
  sshRun(`${sudo}rm -f ${verifyFile}`);
}

function manifestPublicKey() {
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(MANIFEST_PUBLIC_KEY_HEX, "hex"),
  ]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

function signManifest(bytes) {
  const keyFile = path.join(os.homedir(), ".nibi", "market", `${MANIFEST_KEY_ID}.json`);
  if (!fs.existsSync(keyFile)) {
    throw new ReleaseError(`找不到更新清单私钥：${keyFile}`);
  }
  const { privateJwk } = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  const privateKey = createPrivateKey({ key: privateJwk, format: "jwk" });
  const signature = sign(null, bytes, privateKey).toString("hex");
  if (!verify(null, bytes, manifestPublicKey(), Buffer.from(signature, "hex"))) {
    throw new ReleaseError("更新清单签名自检失败：私钥与内置公钥不匹配。");
  }
  return signature;
}

function buildUpdateManifest({ version, versionCode, notes, digest, size }) {
  const apkName = `nibi-go-${versionCode}-${version}.apk`;
  return {
    schemaVersion: 1,
    kind: "nibi-go-app-update",
    generatedAt: new Date().toISOString(),
    version,
    versionCode,
    ...(MIN_VERSION_CODE ? { minVersionCode: MIN_VERSION_CODE } : {}),
    ...(notes ? { notes: notes.slice(0, 8000) } : {}),
    apk: {
      sha256: digest,
      size,
      urls: [
        `${CDN_BASE}/${CDN_PREFIX}/apk/${apkName}`,
        `https://github.com/${RELEASE_REPO}/releases/download/v${version}/app-release.apk`,
      ],
    },
  };
}

function publishCdn({ version, versionCode, notes, digest, size }) {
  step("上传 APK 到国内 CDN（经中转机 → OSS）");
  sshRun(`mkdir -p ${CDN_REMOTE_DIR}/apk`);
  const apkRelative = `apk/nibi-go-${versionCode}-${version}.apk`;
  scpToRemote(APK, apkRelative);
  uploadOss(apkRelative);
  verifyOss(apkRelative, digest);

  step("生成并签名 update.json");
  const manifest = buildUpdateManifest({ version, versionCode, notes, digest, size });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const signature = signManifest(manifestBytes);
  const signatureBytes = Buffer.from(`${signature}\n`, "utf8");
  sshRun(`cat > ${CDN_REMOTE_DIR}/update.json.sig`, { input: signatureBytes });
  sshRun(`cat > ${CDN_REMOTE_DIR}/update.json`, { input: manifestBytes });
  uploadOss("update.json.sig");
  uploadOss("update.json");
  verifyOss("update.json.sig", sha256Buffer(signatureBytes));
  verifyOss("update.json", sha256Buffer(manifestBytes));

  step("校验 CDN 上的公开清单");
  const manifestUrl = `${CDN_BASE}/${CDN_PREFIX}/update.json`;
  const cacheBust = `?_=${Date.now()}`;
  const publicManifest = run("curl", ["-fsS", `${manifestUrl}${cacheBust}`], {
    capture: true,
    shell: false,
  });
  const publicSignature = run("curl", ["-fsS", `${manifestUrl}.sig${cacheBust}`], {
    capture: true,
    shell: false,
  }).trim();
  if (!verify(null, Buffer.from(publicManifest, "utf8"), manifestPublicKey(), Buffer.from(publicSignature, "hex"))) {
    throw new ReleaseError("CDN 公开清单验签失败。");
  }
  const parsed = JSON.parse(publicManifest);
  if (parsed.versionCode !== versionCode || parsed.version !== version) {
    throw new ReleaseError("CDN 公开清单版本与本次发布不一致。");
  }

  sshRun(`rm -f ${CDN_REMOTE_DIR}/${apkRelative} ${CDN_REMOTE_DIR}/update.json ${CDN_REMOTE_DIR}/update.json.sig`);
  return manifestUrl;
}

const args = process.argv.slice(2);
const version = args.find((arg) => /^\d+\.\d+\.\d+$/.test(arg));
const dryRun = args.includes("--dry-run");
const notesIndex = args.indexOf("--notes");
const notes = notesIndex >= 0 ? args[notesIndex + 1] : undefined;

if (!version) {
  console.error(
    '用法：node scripts/release.mjs <X.Y.Z> [--notes "说明"] [--dry-run] [--no-bump] [--cdn-only]',
  );
  process.exit(1);
}

const original = fs.readFileSync(APP_JSON, "utf8");
const config = JSON.parse(original);
const current = config.expo.version;
const currentCode = Number(config.expo.android?.versionCode ?? 0);
const cdnOnly = args.includes("--cdn-only");
// 版本号已经单独提交时使用：不再 bump app.json，直接构建并发布当前版本。
const noBump = args.includes("--no-bump");

// 仅补发 CDN：GitHub Release 已经存在时，重新上传 APK + 签名清单，不重新构建。
if (cdnOnly) {
  if (version !== current) {
    console.error(`错误：--cdn-only 只补发当前 app.json 版本（当前 ${current}）。`);
    process.exit(1);
  }
  try {
    validateCdnConfig();
    if (!CDN_READY) {
      throw new ReleaseError("--cdn-only 需要完整的 NIBI_RELEASE_CDN_* 环境变量。");
    }
    if (!fs.existsSync(KEYSTORE)) throw new ReleaseError(`签名密钥库不存在：${KEYSTORE}`);
    if (!fs.existsSync(APK)) throw new ReleaseError(`APK 不存在：${APK}`);
    run("node", ["scripts/keystore.mjs", "verify", APK]);
    const digest = sha256File(APK);
    const releaseNotes =
      notes ??
      run("git", ["log", "--pretty=format:- %s", "-n", "20"], { capture: true })
        .split("\n")
        .filter(Boolean)
        .join("\n");
    const assetDigest = run(
      "gh",
      ["api", `repos/${RELEASE_REPO}/releases/tags/v${version}`, "-q", ".assets[0].digest"],
      { capture: true, shell: false },
    );
    if (!assetDigest.startsWith("sha256:") ||
        assetDigest.slice("sha256:".length).toLowerCase() !== digest) {
      throw new ReleaseError("GitHub Release 不存在或资产摘要与本地 APK 不一致。");
    }
    const manifestUrl = publishCdn({
      version,
      versionCode: currentCode,
      notes: releaseNotes,
      digest,
      size: fs.statSync(APK).size,
    });
    console.log(`\nCDN 补发完成：${manifestUrl}`);
    process.exit(0);
  } catch (error) {
    console.error(`\n错误：${error.message}`);
    process.exit(1);
  }
}

if (noBump) {
  if (version !== current) {
    console.error(`错误：--no-bump 只发布当前 app.json 版本（当前 ${current}，参数 ${version}）。`);
    process.exit(1);
  }
} else if (version === current) {
  console.error(`错误：版本号未变化（当前 ${current}）。如需发布已提交的版本号，加 --no-bump。`);
  process.exit(1);
}

const nextCode = noBump ? currentCode : currentCode + 1;
console.log(
  noBump
    ? `发版 ${version}（versionCode ${nextCode}，--no-bump）`
    : `发版 ${current} → ${version}（versionCode ${currentCode} → ${nextCode}）`,
);
if (dryRun) {
  console.log("dry-run：只打印计划，不修改文件、不构建、不发布。");
  process.exit(0);
}
validateCdnConfig();

// 1) 版本号：默认同时 bump version 与 versionCode（Android 只认 versionCode）；
//    --no-bump 时版本号已经由调用方提交，不再改 app.json。
if (!noBump) {
  config.expo.version = version;
  config.expo.android = { ...config.expo.android, versionCode: nextCode };
  fs.writeFileSync(APP_JSON, `${JSON.stringify(config, null, 2)}\n`);
}

let releasePublished = false;
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

  // 3.5) 原生产物必须在位：libnibi.so（D24）、bash/busybox/git（D25 Phase 2）
  // 与 Node/Python 语言运行时（Phase 3）都由脚本构建、不进版本库；
  // 缺任何一个都直接失败，避免发空壳包。
  step("检查 Android 原生产物");
  run("node", ["scripts/android-kernel/build.mjs", "--check"]);
  run("node", ["scripts/android-runtime/build.mjs", "--check"]);
  run("node", ["scripts/android-runtimes/build.mjs", "--check"]);

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
  ], { shell: false });
  // 从这里开始版本已经对外可见，后续失败不能回滚 app.json。
  releasePublished = true;

  // 8) 发布后校验：GitHub 必须为资产算出 digest，否则客户端 fail-closed 拒绝更新
  step("校验发布资产的 SHA-256 摘要");
  const assetDigest = run(
    "gh",
    ["api", `repos/${RELEASE_REPO}/releases/tags/v${version}`, "-q", ".assets[0].digest"],
    { capture: true, shell: false },
  );
  if (!assetDigest.startsWith("sha256:")) {
    throw new ReleaseError(
      `GitHub 未返回资产 digest（${assetDigest || "空"}）。客户端会拒绝安装该版本，请检查发布。`,
    );
  }
  if (assetDigest.slice("sha256:".length).toLowerCase() !== digest) {
    throw new ReleaseError(`本地摘要与 GitHub digest 不一致：\n  本地 ${digest}\n  远端 ${assetDigest}`);
  }

  // 9) 国内 CDN：APK + 签名 update.json；GitHub 已经发布，清单最后上传。
  let manifestUrl = "";
  if (CDN_READY) {
    manifestUrl = publishCdn({
      version,
      versionCode: nextCode,
      notes: releaseNotes,
      digest,
      size: fs.statSync(APK).size,
    });
  } else {
    console.warn(
      "\n警告：未配置 NIBI_RELEASE_CDN_*，本次只发布了 GitHub Release；客户端会回退到 GitHub API 检查更新。",
    );
  }

  console.log(`\n完成：v${version}（versionCode ${nextCode}）`);
  console.log(`  APK      ${APK}`);
  console.log(`  SHA256   ${digest}`);
  console.log(`  GitHub   https://github.com/${RELEASE_REPO}/releases/tag/v${version}`);
  if (manifestUrl) console.log(`  更新清单 ${manifestUrl}`);
  console.log("\n本机工作副本仍保留。清理：node scripts/keystore.mjs wipe --yes");
} catch (error) {
  if (!releasePublished && !noBump) {
    fs.writeFileSync(APP_JSON, original);
    console.error(`\n错误：${error.message}`);
    console.error(`app.json 已回滚到 ${current}。`);
  } else if (!releasePublished && noBump) {
    console.error(`\n错误：${error.message}`);
    console.error("--no-bump：app.json 保持不变。");
  } else {
    console.error(`\n错误：${error.message}`);
    console.error(
      `GitHub Release v${version} 已发布，app.json 保持 ${version}（不回滚）。` +
        `修复后运行 node scripts/release.mjs ${version} --cdn-only 补发 CDN 清单。`,
    );
  }
  process.exit(1);
}
