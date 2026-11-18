#!/usr/bin/env node
// 构建 Android 内核产物（D24 Phase 0）。
//
// 从本仓 `kernel/` 交叉编译 `libnibi.so`（cdylib，C ABI v1）到
// `app/modules/kernel-host/android/prebuilt/jniLibs/<abi>/`，连同 NDK 的 `libc++_shared.so`；
// 落盘前做 fail-closed 校验：ELF 身份、Android 目标 API、16 KB LOAD 对齐、C ABI 导出符号、sha256。
//
// 用法：
//   node scripts/android-kernel/build.mjs              # 构建 + 落盘 + 校验 + 写 .stamp.json
//   node scripts/android-kernel/build.mjs --check      # 只校验已落盘产物（CI/构建前）
//   node scripts/android-kernel/build.mjs --api 24     # 指定 NDK 目标 API（默认 24 = App minSdk）
//   node scripts/android-kernel/build.mjs --ndk <dir>  # 指定 NDK 根目录
//
// 环境变量：
//   ANDROID_NDK_HOME / ANDROID_NDK_ROOT   NDK 根目录（优先于自动探测）
//   ANDROID_HOME / ANDROID_SDK_ROOT       从 <sdk>/ndk/<version> 自动挑最高版本
//
// 与上游 4.1.0 的分发链不同：这里没有 npm 平台包、没有 build.json，产物来源可追溯到本仓提交。

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  elfLoadAlignment,
  parseElfIdentity,
  readAndroidAbiLevel,
  sha256Hex,
} from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KERNEL_DIR = join(ROOT, "kernel");
const PREBUILT_DIR = join(ROOT, "app/modules/kernel-host/android/prebuilt");
const STAMP_PATH = join(PREBUILT_DIR, ".stamp.json");

const TARGET = "aarch64-linux-android";
const ABI = "arm64-v8a";
const DEFAULT_API = 24;
const MIN_NDK_MAJOR = 27;

const CDYLIB = "libnibi.so";
const SHARED_LIB = "libc++_shared.so";
const ARTIFACTS = [CDYLIB, SHARED_LIB];

// C ABI v1（nibi-client docs/android-cdylib-abi.md）：缺一个就说明 cdylib 编错或链接被 strip 坏。
// 最后一个 `attach_android` 是 GO fork 的 T8 S2 新增符号（v1 向后兼容），JNI 薄层直接链接它，
// 所以这里也按必需符号断言。
const REQUIRED_SYMBOLS = [
  "nibi_app_server_abi_version",
  "nibi_app_server_start",
  "nibi_app_server_send",
  "nibi_app_server_stop",
  "nibi_app_server_destroy",
  "nibi_app_server_attach_android",
];

function parseArgs(argv) {
  const args = { check: false, api: DEFAULT_API, ndk: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--api") args.api = Number(argv[++i]);
    else if (arg === "--ndk") args.ndk = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/android-kernel/build.mjs [--check] [--api 24] [--ndk <dir>]");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!Number.isInteger(args.api) || args.api <= 0) {
    throw new Error(`--api 必须是正整数：${args.api}`);
  }
  return args;
}

function ndkVersion(dir) {
  const props = join(dir, "source.properties");
  if (!existsSync(props)) return null;
  const match = readFileSync(props, "utf8").match(/^Pkg\.Revision\s*=\s*(\S+)$/mu);
  return match ? match[1] : null;
}

function findNdk(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  for (const env of ["ANDROID_NDK_HOME", "ANDROID_NDK_ROOT"]) {
    if (process.env[env]) candidates.push(process.env[env]);
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const ndkRoot = join(sdk, "ndk");
    if (existsSync(ndkRoot)) {
      const versions = readdirSync(ndkRoot).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
      for (const version of versions) candidates.push(join(ndkRoot, version));
    }
  }
  for (const dir of candidates) {
    const version = ndkVersion(dir);
    if (!version) continue;
    const major = Number(version.split(".")[0]);
    if (major < MIN_NDK_MAJOR) {
      throw new Error(`NDK ${version} 太旧：需要 r${MIN_NDK_MAJOR}+（16 KB 页与 API ${DEFAULT_API} 链接）`);
    }
    return { dir: resolve(dir), version };
  }
  throw new Error(
    "找不到 Android NDK：设置 ANDROID_NDK_HOME，或在 ANDROID_HOME 下安装 ndk;27+ (sdkmanager \"ndk;27.1.12297006\")",
  );
}

function hostTag() {
  if (process.platform === "win32") return "windows-x86_64";
  if (process.platform === "darwin") return "darwin-x86_64";
  return "linux-x86_64";
}

function exeName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function clangName(api) {
  const base = `aarch64-linux-android${api}-clang`;
  // Windows 的 NDK 只提供 .cmd 包装器；Linux/macOS 是原生脚本。
  return process.platform === "win32" ? `${base}.cmd` : base;
}

function clangxxName(api) {
  const base = `aarch64-linux-android${api}-clang++`;
  return process.platform === "win32" ? `${base}.cmd` : base;
}

function toolchainBin(ndk) {
  return join(ndk.dir, "toolchains", "llvm", "prebuilt", hostTag(), "bin");
}

function readStamp() {
  if (!existsSync(STAMP_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STAMP_PATH, "utf8"));
  } catch {
    return null;
  }
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function rustcVersion() {
  try {
    return execFileSync("rustc", ["--version"], { cwd: KERNEL_DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function cargoBuild(ndk, api) {
  const bin = toolchainBin(ndk);
  const clang = join(bin, clangName(api));
  const clangxx = join(bin, clangxxName(api));
  const ar = join(bin, exeName("llvm-ar"));
  const ranlib = join(bin, exeName("llvm-ranlib"));
  for (const tool of [clang, clangxx, ar, ranlib]) {
    if (!existsSync(tool)) {
      throw new Error(`NDK 缺少 ${tool}（NDK ${ndk.version} / ${hostTag()}）`);
    }
  }

  const env = {
    ...process.env,
    "CC_aarch64-linux-android": clang,
    "CXX_aarch64-linux-android": clangxx,
    "AR_aarch64-linux-android": ar,
    "RANLIB_aarch64-linux-android": ranlib,
    CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: clang,
  };

  console.log(`[android-kernel] NDK ${ndk.version} · API ${api} · ${clang}`);
  console.log("[android-kernel] cargo build --locked --release -p nibi-kernel-cli --lib");
  const result = spawnSync(
    "cargo",
    ["build", "--locked", "--release", "-p", "nibi-kernel-cli", "--lib", "--target", TARGET],
    { cwd: KERNEL_DIR, env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cargo build 失败（退出码 ${result.status}）`);
  }

  const built = join(KERNEL_DIR, "target", TARGET, "release", CDYLIB);
  if (!existsSync(built)) throw new Error(`cargo 没有产出 ${built}`);

  const sysrootLib = join(
    ndk.dir,
    "toolchains",
    "llvm",
    "prebuilt",
    hostTag(),
    "sysroot",
    "usr",
    "lib",
    TARGET,
    SHARED_LIB,
  );
  if (!existsSync(sysrootLib)) throw new Error(`NDK 缺少 ${sysrootLib}`);

  const outDir = join(PREBUILT_DIR, "jniLibs", ABI);
  mkdirSync(outDir, { recursive: true });
  for (const [from, name] of [
    [built, CDYLIB],
    [sysrootLib, SHARED_LIB],
  ]) {
    const to = join(outDir, name);
    writeFileSync(to, readFileSync(from));
    console.log(`[android-kernel] 落盘 ${to}`);
  }

  return { ndk, api, outDir };
}

function exportedSymbols(ndk, file) {
  const nm = join(toolchainBin(ndk), exeName("llvm-nm"));
  const output = execFileSync(nm, ["-D", "--defined-only", file], { encoding: "utf8" });
  return new Set(
    output
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u).pop())
      .filter(Boolean),
  );
}

/**
 * T8 S2：Gradle 里的 rustls-platform-verifier Kotlin 组件版本必须与 Cargo.lock 的
 * `rustls-platform-verifier-android` 一致（crate README：SemVer 不兼容会导致运行时崩溃）。
 * 返回错误列表。
 */
function verifyVerifierComponent() {
  const errors = [];
  const lock = readFileSync(join(KERNEL_DIR, "Cargo.lock"), "utf8");
  const lockMatch = lock.match(/name = "rustls-platform-verifier-android"\r?\nversion = "([^"]+)"/u);
  if (!lockMatch) {
    return ["Cargo.lock 里找不到 rustls-platform-verifier-android"];
  }
  const gradlePath = join(ROOT, "app/modules/kernel-host/android/build.gradle");
  const gradle = readFileSync(gradlePath, "utf8");
  const gradleMatch = gradle.match(/org\.rustls:rustls-platform-verifier:([0-9]+\.[0-9]+\.[0-9]+)/u);
  if (!gradleMatch) {
    return ["kernel-host build.gradle 里找不到 org.rustls:rustls-platform-verifier 依赖"];
  }
  if (gradleMatch[1] !== lockMatch[1]) {
    errors.push(
      `rustls-platform-verifier 组件版本不一致：Cargo.lock=${lockMatch[1]}，Gradle=${gradleMatch[1]}（必须相同）`,
    );
  }
  return errors;
}

/**
 * 校验落盘产物；返回错误列表（空 = 通过）。
 * @param {{ndk: {dir: string, version: string}, api: number, outDir: string}} ctx
 * @param {object | null} stamp 期望的 sha256（--check 时来自 .stamp.json）
 */
function verifyArtifacts(ctx, stamp) {
  const errors = [];
  const outDir = join(PREBUILT_DIR, "jniLibs", ABI);

  for (const name of ARTIFACTS) {
    const file = join(outDir, name);
    if (!existsSync(file)) {
      errors.push(`缺少产物 ${file}`);
      continue;
    }
    const bytes = readFileSync(file);
    const identity = parseElfIdentity(bytes);
    for (const error of identity.errors) errors.push(`${name}: ${error}`);

    const align = elfLoadAlignment(bytes);
    if (align !== 0x4000) {
      errors.push(
        `${name}: LOAD 段对齐是 0x${align.toString(16)}，不是 16 KB（0x4000；kernel/.cargo/config.toml）`,
      );
    }

    const level = readAndroidAbiLevel(bytes);
    if (level === null) {
      errors.push(`${name}: 没有 .note.android.ident，无法确认 Android 目标 API`);
    } else if (level > ctx.api) {
      errors.push(`${name}: 目标 API ${level} > 期望 ${ctx.api}（App minSdk）`);
    }

    const expected = stamp?.artifacts?.[name]?.sha256;
    if (stamp && expected && sha256Hex(bytes) !== expected) {
      errors.push(`${name}: sha256 与 .stamp.json 不符（产物被替换或不完整）`);
    }
  }

  const cdylib = join(outDir, CDYLIB);
  if (existsSync(cdylib) && errors.length === 0) {
    const symbols = exportedSymbols(ctx.ndk, cdylib);
    for (const symbol of REQUIRED_SYMBOLS) {
      if (!symbols.has(symbol)) errors.push(`${CDYLIB}: 缺少导出符号 ${symbol}`);
    }
  }

  return errors;
}

function buildManifest(ctx) {
  const outDir = join(PREBUILT_DIR, "jniLibs", ABI);
  const artifacts = {};
  for (const name of ARTIFACTS) {
    const bytes = readFileSync(join(outDir, name));
    artifacts[name] = { sha256: sha256Hex(bytes), size: statSync(join(outDir, name)).size };
  }
  return {
    schemaVersion: 1,
    target: TARGET,
    abi: ABI,
    apiLevel: ctx.api,
    ndk: ctx.ndk.version,
    rustc: rustcVersion(),
    repoCommit: gitHead(),
    builtAt: new Date().toISOString(),
    artifacts,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ndk = findNdk(args.ndk);
  const ctx = { ndk, api: args.api, outDir: join(PREBUILT_DIR, "jniLibs", ABI) };
  const componentErrors = verifyVerifierComponent();
  if (componentErrors.length > 0) {
    console.error("Android 内核依赖校验失败：");
    for (const error of componentErrors) console.error(`  - ${error}`);
    process.exit(1);
  }

  if (args.check) {
    const stamp = readStamp();
    if (!stamp) {
      throw new Error(`缺少 ${STAMP_PATH}：先跑 node scripts/android-kernel/build.mjs`);
    }
    if (stamp.apiLevel !== args.api) {
      throw new Error(`.stamp.json 的 apiLevel=${stamp.apiLevel}，与 --api ${args.api} 不一致`);
    }
    const errors = verifyArtifacts(ctx, stamp);
    if (errors.length > 0) {
      console.error("Android 内核产物校验失败：");
      for (const error of errors) console.error(`  - ${error}`);
      process.exit(1);
    }
    console.log(`Android 内核产物校验通过（${CDYLIB} + ${SHARED_LIB}，API ${stamp.apiLevel}，16 KB）`);
    return;
  }

  cargoBuild(ndk, args.api);
  // 先算 manifest（sha256）再校验 ELF/API/16KB/符号；只有全部通过才写 .stamp.json，
  // 避免失败时留下「看似成功」的清单。
  const stamp = buildManifest(ctx);
  const errors = verifyArtifacts(ctx, stamp);
  if (errors.length > 0) {
    console.error("Android 内核产物校验失败：");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  writeFileSync(STAMP_PATH, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(
    `Android 内核产物就绪：${join("app/modules/kernel-host/android/prebuilt/jniLibs", ABI)}（API ${args.api}）`,
  );
  console.log(`sha256 ${CDYLIB} = ${stamp.artifacts[CDYLIB].sha256}`);
  invalidateGradleNativeLibs();
}

/// Gradle 会把 jniLibs 合并进 intermediates 并自己做 up-to-date 判定：替换 `.so` 之后直接
/// `assembleDebug` 可能被判“无变化”，打出来的 APK 里仍是旧内核（真机验收会对着旧行为查半天）。
/// 这里删掉合并产物，逼下一次打包重新合并。
function invalidateGradleNativeLibs() {
  for (const name of ["merged_native_libs", "stripped_native_libs"]) {
    const dir = join(ROOT, "app/android/app/build/intermediates", name);
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    console.log(`[android-kernel] 已清理 ${relative(ROOT, dir)}（下次打包重新合并）`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[android-kernel] ${error.message}`);
  process.exit(1);
}
