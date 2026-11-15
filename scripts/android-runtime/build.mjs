#!/usr/bin/env node
// Build/verify the Android userland shipped inside NIBI-GO (D25 Phase 2).
//
// Build host: Linux or WSL (bash/autotools + the same NDK as libnibi.so).
// This orchestrator downloads the pinned sources, invokes build.sh, then
// verifies the staged artifacts with fail-closed checks:
//   - ELF64 AArch64 PIE, PT_INTERP=/system/bin/linker64, 16 KB LOAD alignment
//   - .note.android.ident API <= 24
//   - NEEDED only libc/libm/libdl/liblog
//   - no non-weak undefined symbol outside the API 24 libc/libm/libdl stubs
//   - runtime manifest + asset zip shape
//
// 用法：
//   node scripts/android-runtime/build.mjs            # 下载 + 构建 + 校验 + 写 stamp
//   node scripts/android-runtime/build.mjs --check    # 只校验已落盘产物（CI/构建前）
//   node scripts/android-runtime/build.mjs --ndk <dir> --jobs 4 --api 24

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_NEEDED,
  elfLoadAlignment,
  listZipEntries,
  parseElfIdentity,
  readAndroidAbiLevel,
  readElfInterp,
  sha256Hex,
  verifyRuntimeManifest,
} from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE = join(ROOT, "app/modules/kernel-host/android");
const PREBUILT = join(MODULE, "prebuilt");
const JNI_DIR = join(PREBUILT, "jniLibs/arm64-v8a");
const ASSETS = join(MODULE, "src/main/assets");
const ASSET_ZIP = join(ASSETS, "nibi-runtime.zip");
const ASSET_MANIFEST = join(ASSETS, "nibi-runtime.json");
const STAMP = join(PREBUILT, ".runtime-stamp.json");
const SRC_CACHE = join(ROOT, "build/android-runtime/src");
const IS_WINDOWS = process.platform === "win32";

const RUNTIME_LIBS = [
  "libbash.so",
  "libbusybox.so",
  "libgit.so",
  "libgit_remote_http.so",
  "libnibi_run.so",
  "libnibi_hook.so",
];
const MIN_API = 24;
const REQUIRED_ASSET_ENTRIES = [
  "etc/bash_env.sh",
  "etc/busybox-applets.txt",
  "etc/cacert.pem",
  "git-core/git-sh-setup",
  "git-core/git-sh-i18n",
  "git-scripts/git-submodule",
];

function parseArgs(argv) {
  const args = { check: false, ndk: null, jobs: 0, api: MIN_API };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--ndk") args.ndk = argv[++i];
    else if (arg === "--jobs") args.jobs = Number(argv[++i]);
    else if (arg === "--api") args.api = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/android-runtime/build.mjs [--check] [--ndk <dir>] [--jobs N] [--api 24]");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!Number.isInteger(args.api) || args.api < MIN_API) {
    throw new Error(`--api 必须 >= ${MIN_API}`);
  }
  return args;
}

function loadSources() {
  return JSON.parse(readFileSync(join(ROOT, "scripts/android-runtime/sources.json"), "utf8"));
}

function sourceUrls(source) {
  return [source.url, ...(source.mirrors ?? [])];
}

async function ensureSources(sources) {
  mkdirSync(SRC_CACHE, { recursive: true });
  for (const source of sources.sources) {
    const target = join(SRC_CACHE, source.archive);
    if (existsSync(target)) {
      const hash = sha256Hex(readFileSync(target));
      if (hash === source.sha256) {
        console.log(`  ✓ ${source.archive}（缓存）`);
        continue;
      }
      console.log(`  ! ${source.archive} sha256 不符，重新下载`);
    }
    let ok = false;
    for (const url of sourceUrls(source)) {
      try {
        console.log(`  ↓ ${source.archive} ← ${url}`);
        const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        const hash = sha256Hex(bytes);
        if (hash !== source.sha256) throw new Error(`sha256 不符：${hash}`);
        writeFileSync(target, bytes);
        ok = true;
        break;
      } catch (error) {
        console.log(`    ! ${error.message}`);
      }
    }
    if (!ok) throw new Error(`无法获取 ${source.archive}（所有镜像都失败）`);
  }
}

function wslPath(path) {
  return execFileSync("wsl", ["-e", "wslpath", "-a", path], { encoding: "utf8" }).trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function resolveBuildNdk(args) {
  const explicit = args.ndk ?? process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT;
  if (!explicit) return null;
  return explicit;
}

function runBuild(args, sources) {
  const env = {
    ...process.env,
    SRC_CACHE: IS_WINDOWS ? wslPath(SRC_CACHE) : SRC_CACHE,
    JNI_OUT: IS_WINDOWS ? wslPath(JNI_DIR) : JNI_DIR,
    ASSET_ZIP: IS_WINDOWS ? wslPath(ASSET_ZIP) : ASSET_ZIP,
    ASSET_MANIFEST: IS_WINDOWS ? wslPath(ASSET_MANIFEST) : ASSET_MANIFEST,
    API: String(args.api),
  };
  if (args.jobs > 0) env.JOBS = String(args.jobs);
  const ndk = resolveBuildNdk(args);
  if (ndk) env.NDK = IS_WINDOWS ? wslPath(ndk) : ndk;

  if (IS_WINDOWS) {
    const repo = wslPath(ROOT);
    const assignments = Object.entries(env)
      .filter(([key]) => ["SRC_CACHE", "JNI_OUT", "ASSET_ZIP", "ASSET_MANIFEST", "API", "JOBS", "NDK"].includes(key))
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ");
    const command = `cd ${shellQuote(repo)} && ${assignments} bash scripts/android-runtime/build.sh`;
    console.log(`\n$ wsl -e bash -lc "${command}"`);
    const result = spawnSync("wsl", ["-e", "bash", "-lc", command], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`build.sh 失败（exit ${result.status}）`);
  } else {
    console.log("\n$ bash scripts/android-runtime/build.sh");
    const result = spawnSync("bash", ["scripts/android-runtime/build.sh"], {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`build.sh 失败（exit ${result.status}）`);
  }
}

function ndkHostTag() {
  if (process.platform === "win32") return "windows-x86_64";
  if (process.platform === "darwin") return "darwin-x86_64";
  return "linux-x86_64";
}

function resolveVerifyNdk(args) {
  if (args.ndk) return args.ndk;
  if (process.env.ANDROID_NDK_HOME) return process.env.ANDROID_NDK_HOME;
  if (process.env.ANDROID_NDK_ROOT) return process.env.ANDROID_NDK_ROOT;
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const candidate = join(sdk, "ndk", "27.1.12297006");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function ndkTool(ndk, name) {
  const ext = process.platform === "win32" ? ".exe" : "";
  return join(ndk, "toolchains/llvm/prebuilt", ndkHostTag(), "bin", name + ext);
}

function apiStubSymbols(ndk) {
  const dir = join(ndk, "toolchains/llvm/prebuilt", ndkHostTag(), "sysroot/usr/lib/aarch64-linux-android", String(MIN_API));
  const stubs = ["libc.so", "libm.so", "libdl.so", "liblog.so"]
    .map((name) => join(dir, name))
    .filter((path) => existsSync(path));
  if (stubs.length === 0) throw new Error(`找不到 API ${MIN_API} 的 stub：${dir}`);
  const nm = ndkTool(ndk, "llvm-nm");
  const out = execFileSync(nm, ["-D", "--defined-only", ...stubs], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const symbols = new Set();
  for (const line of out.split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    if (parts.length === 0) continue;
    const name = parts[parts.length - 1].replace(/@.*$/u, "");
    if (name && name !== "Symbol" && !name.endsWith(":")) symbols.add(name);
  }
  return symbols;
}

function undefinedSymbols(ndk, file) {
  const nm = ndkTool(ndk, "llvm-nm");
  const out = execFileSync(nm, ["-D", "-u", file], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const missing = [];
  const weak = [];
  for (const line of out.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([A-Za-z])\s+(.+)$/u.exec(trimmed);
    if (!match) continue;
    const [, type, raw] = match;
    const name = raw.replace(/@.*$/u, "");
    if (type === "w" || type === "v") weak.push(name);
    else missing.push(name);
  }
  return { missing, weak };
}

function bashDefinesGetcwd(ndk, file) {
  const nm = ndkTool(ndk, "llvm-nm");
  const out = execFileSync(nm, ["-D", file], { encoding: "utf8" });
  return out
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => /^[0-9a-f]+\s+[Tt]\s+getcwd$/u.test(line));
}

function neededLibraries(ndk, file) {
  const readelf = ndkTool(ndk, "llvm-readelf");
  const out = execFileSync(readelf, ["-d", file], { encoding: "utf8" });
  const needed = [];
  for (const line of out.split(/\r?\n/u)) {
    const match = /Shared library: \[(.+)\]/u.exec(line);
    if (match) needed.push(match[1]);
  }
  return needed;
}

function verify(args) {
  const errors = [];
  const notes = [];
  const sources = loadSources();
  const caPath = join(ROOT, "scripts/android-runtime/assets/cacert.pem");
  if (!existsSync(caPath)) {
    errors.push("缺少 scripts/android-runtime/assets/cacert.pem");
  } else if (sha256Hex(readFileSync(caPath)) !== sources.caBundle?.sha256) {
    errors.push("cacert.pem 的 sha256 与 sources.json 的 caBundle 不一致");
  }
  const ndk = resolveVerifyNdk(args);
  if (!ndk || !existsSync(ndk)) {
    errors.push(`找不到 NDK（用于符号面校验）：${ndk ?? "(未设置)"}`);
  } else if (!existsSync(ndkTool(ndk, "llvm-nm"))) {
    errors.push(`NDK 缺少 llvm-nm：${ndk}`);
  }

  let stubs = null;
  if (ndk && existsSync(ndk)) {
    try {
      stubs = apiStubSymbols(ndk);
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const name of RUNTIME_LIBS) {
    const path = join(JNI_DIR, name);
    if (!existsSync(path)) {
      errors.push(`缺少 ${name}`);
      continue;
    }
    const bytes = readFileSync(path);
    const identity = parseElfIdentity(bytes);
    if (!identity.ok) errors.push(`${name}: ${identity.errors.join("；")}`);
    const align = elfLoadAlignment(bytes);
    if (align < 0x4000) errors.push(`${name}: LOAD 对齐 ${align}，要求 >= 0x4000`);
    const api = readAndroidAbiLevel(bytes);
    if (api === null) notes.push(`${name}: 没有 .note.android.ident`);
    else if (api > MIN_API) errors.push(`${name}: NDK API ${api} > ${MIN_API}`);
    const interp = readElfInterp(bytes);
    if (interp !== "/system/bin/linker64") errors.push(`${name}: PT_INTERP=${interp ?? "(无)"}`);
    if (ndk && existsSync(ndk)) {
      for (const lib of neededLibraries(ndk, path)) {
        if (!ALLOWED_NEEDED.has(lib)) errors.push(`${name}: 不允许的 NEEDED ${lib}`);
      }
      const { missing, weak } = undefinedSymbols(ndk, path);
      if (stubs) {
        for (const symbol of missing) {
          if (!stubs.has(symbol)) errors.push(`${name}: 未定义符号 ${symbol} 不在 API ${MIN_API} stub 中`);
        }
      }
      if (name === "libbash.so" && bashDefinesGetcwd(ndk, path)) {
        errors.push(
          "libbash.so: 链接了 bash 自带的 getcwd 替代实现（交叉编译默认）。" +
            "configure 需要 bash_cv_getcwd_malloc=yes，否则 Android /data/user/0 上 getcwd 会 EACCES。",
        );
      }
      if (weak.length > 0) notes.push(`${name}: 弱符号 ${weak.join(", ")}（旧 API 上可为空）`);
    }
  }

  if (!existsSync(ASSET_MANIFEST)) {
    errors.push("缺少 nibi-runtime.json");
  } else {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(ASSET_MANIFEST, "utf8"));
    } catch (error) {
      errors.push(`nibi-runtime.json 解析失败：${error.message}`);
    }
    if (manifest) {
      errors.push(...verifyRuntimeManifest(manifest));
      const libRefs = new Set([
        ...Object.values(manifest.bin ?? {}),
        ...Object.values(manifest.gitCore ?? {}),
      ]);
      if (manifest.hooks?.length) libRefs.add("libnibi_hook.so");
      for (const lib of libRefs) {
        if (!existsSync(join(JNI_DIR, lib))) errors.push(`清单引用的 ${lib} 不存在`);
      }
    }
  }

  if (!existsSync(ASSET_ZIP)) {
    errors.push("缺少 nibi-runtime.zip");
  } else {
    const zip = readFileSync(ASSET_ZIP);
    const listing = listZipEntries(zip);
    if (listing.error) errors.push(`nibi-runtime.zip: ${listing.error}`);
    const names = new Set(listing.entries.map((entry) => entry.name));
    for (const required of REQUIRED_ASSET_ENTRIES) {
      if (!names.has(required)) errors.push(`nibi-runtime.zip 缺少 ${required}`);
    }
    if (![...names].some((name) => name.startsWith("share/git-core/templates/"))) {
      errors.push("nibi-runtime.zip 缺少 git templates");
    }
  }

  for (const note of notes) console.log(`  · ${note}`);
  return errors;
}

function writeStamp(sources, args) {
  const files = {};
  for (const name of RUNTIME_LIBS) {
    const path = join(JNI_DIR, name);
    files[name] = { sha256: sha256Hex(readFileSync(path)), bytes: statSync(path).size };
  }
  const stamp = {
    schema: 1,
    api: args.api,
    ndk: sources.ndk.version,
    packages: Object.fromEntries(sources.sources.map((item) => [item.name, item.version])),
    files,
    assetZip: { sha256: sha256Hex(readFileSync(ASSET_ZIP)), bytes: statSync(ASSET_ZIP).size },
    manifest: { sha256: sha256Hex(readFileSync(ASSET_MANIFEST)), bytes: statSync(ASSET_MANIFEST).size },
  };
  writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`\nstamp: ${STAMP}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = loadSources();

  if (!args.check) {
    console.log(`NIBI Android runtime（NDK ${sources.ndk.version} / API ${args.api}）`);
    await ensureSources(sources);
    runBuild(args, sources);
  }

  console.log("\n校验运行时产物");
  const errors = verify(args);
  if (errors.length > 0) {
    for (const error of errors) console.error(`  ✗ ${error}`);
    console.error(`\n${errors.length} 项校验失败`);
    process.exit(1);
  }
  console.log("  ✓ 全部通过");
  if (!args.check) writeStamp(sources, args);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
