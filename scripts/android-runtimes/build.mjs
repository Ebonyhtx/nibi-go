#!/usr/bin/env node
// Build the self-owned Android Node/Python runtimes (D25 Phase 3).
//
// Host: Linux or WSL with NDK r27b, make, gcc/g++, pkg-config.
// Sources are pinned in sources.json; the scripts build:
//   - Node 24 LTS: android-configure + bionic patches -> libnode.so + npm
//   - CPython 3.13: host Python -> cross build -> libpython + stdlib + pip
//
// 用法：
//   node scripts/android-runtimes/build.mjs          # 下载 + 构建 + 打包 + 校验
//   node scripts/android-runtimes/build.mjs --check  # 只校验已落盘产物
//   node scripts/android-runtimes/build.mjs --python-only / --node-only

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  elfLoadAlignment,
  listZipEntries,
  parseElfIdentity,
  readAndroidAbiLevel,
  readElfInterp,
  sha256Hex,
} from "../android-runtime/lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE = join(ROOT, "app/modules/kernel-host/android");
const PREBUILT = join(MODULE, "prebuilt");
const JNI_DIR = join(PREBUILT, "jniLibs/arm64-v8a");
const ASSETS = join(MODULE, "src/main/assets");
const ASSET_ZIP = join(ASSETS, "nibi-langs.zip");
const ASSET_MANIFEST = join(ASSETS, "nibi-langs.json");
const STAMP = join(PREBUILT, ".langs-stamp.json");
const SRC_CACHE = join(ROOT, "build/android-runtimes/src");
const IS_WINDOWS = process.platform === "win32";
const API = 24;

const LIBS = ["libnode.so", "libpython_bin.so", "libpython3.13.so", "libffi.so"];
// 只有可执行入口才有 PT_INTERP；libpython3.13.so / libffi.so 是共享库。
const EXECUTABLES = new Set(["libnode.so", "libpython_bin.so"]);
const MIN_API = 24;

function parseArgs(argv) {
  const args = { check: false, packageOnly: false, nodeOnly: false, pythonOnly: false, jobs: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--package-only") args.packageOnly = true;
    else if (a === "--node-only") args.nodeOnly = true;
    else if (a === "--python-only") args.pythonOnly = true;
    else if (a === "--jobs") args.jobs = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "用法：node scripts/android-runtimes/build.mjs [--check] [--package-only] [--node-only|--python-only] [--jobs N]",
      );
      process.exit(0);
    } else throw new Error(`未知参数：${a}`);
  }
  return args;
}

function loadSources() {
  return JSON.parse(readFileSync(join(ROOT, "scripts/android-runtimes/sources.json"), "utf8"));
}

async function ensureSources(sources) {
  mkdirSync(SRC_CACHE, { recursive: true });
  const items = [
    sources.node,
    sources.python,
    sources.libffi,
    sources.zlib,
    sources.openssl,
    sources.sqlite,
  ];
  for (const item of items) {
    if (!item) continue;
    const target = join(SRC_CACHE, item.archive);
    if (existsSync(target) && sha256Hex(readFileSync(target)) === item.sha256) {
      console.log(`  ✓ ${item.archive}（缓存）`);
      continue;
    }
    let ok = false;
    for (const url of [item.url, ...(item.mirrors ?? [])]) {
      try {
        console.log(`  ↓ ${item.archive} ← ${url}`);
        const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(600_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        if (sha256Hex(bytes) !== item.sha256) throw new Error("sha256 不符");
        writeFileSync(target, bytes);
        ok = true;
        break;
      } catch (error) {
        console.log(`    ! ${error.message}`);
      }
    }
    if (!ok) throw new Error(`无法获取 ${item.archive}`);
  }
}

function wslPath(p) {
  return execFileSync("wsl", ["-e", "wslpath", "-a", p], { encoding: "utf8" }).trim();
}

function shellQuote(v) {
  return `'${String(v).replaceAll("'", `'\\''`)}'`;
}

function runShell(args, sources) {
  const work = "$HOME/.cache/nibi-android-runtimes";
  const env = {
    SRC_CACHE: IS_WINDOWS ? wslPath(SRC_CACHE) : SRC_CACHE,
    JNI_OUT: IS_WINDOWS ? wslPath(JNI_DIR) : JNI_DIR,
    ASSET_DIR: IS_WINDOWS ? wslPath(join(ROOT, "build/android-runtimes/assets")) : join(ROOT, "build/android-runtimes/assets"),
    API: String(API),
    WORK: work,
  };
  if (args.jobs > 0) env.JOBS = String(args.jobs);
  const ndk = process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT;
  if (ndk) env.NDK = IS_WINDOWS ? wslPath(ndk) : ndk;
  const scripts = [];
  if (!args.pythonOnly) scripts.push("build-node.sh");
  if (!args.nodeOnly) scripts.push("build-python.sh");
  const assignments = Object.entries(env)
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join(" ");
  if (IS_WINDOWS) {
    const repo = wslPath(ROOT);
    for (const script of scripts) {
      const cmd = `cd ${shellQuote(repo)} && ${assignments} bash scripts/android-runtimes/${script}`;
      console.log(`\n$ wsl -e bash -lc "${cmd}"`);
      const r = spawnSync("wsl", ["-e", "bash", "-lc", cmd], { stdio: "inherit" });
      if (r.status !== 0) throw new Error(`${script} 失败（exit ${r.status}）`);
    }
  } else {
    for (const script of scripts) {
      console.log(`\n$ bash scripts/android-runtimes/${script}`);
      const r = spawnSync("bash", [`scripts/android-runtimes/${script}`], {
        cwd: ROOT,
        env: { ...process.env, ...env },
        stdio: "inherit",
      });
      if (r.status !== 0) throw new Error(`${script} 失败（exit ${r.status}）`);
    }
  }
}

function packageLangs(sources) {
  const assetDir = join(ROOT, "build/android-runtimes/assets");
  const version = `langs-1:node=${sources.node.version},npm=${sources.node.npmVersion},python=${sources.python.version},sqlite=${sources.sqlite.version}`;
  const manifest = {
    schema: 1,
    version,
    bin: {
      node: "libnode.so",
      python3: "libpython_bin.so",
      python: "libpython_bin.so",
    },
    python: { home: "python" },
    npm: { home: "npm" },
    shims: ["npm", "npx", "pip", "pip3"],
    packages: {
      node: sources.node.version,
      npm: sources.node.npmVersion,
      python: sources.python.version,
      libffi: sources.libffi.version,
      zlib: sources.zlib.version,
      sqlite: sources.sqlite.version,
    },
  };
  mkdirSync(ASSETS, { recursive: true });
  const zipScript = join(ROOT, "scripts/android-runtime/make-assets-zip.py");
  if (IS_WINDOWS) {
    const cmd = `python3 ${shellQuote(wslPath(zipScript))} ${shellQuote(wslPath(assetDir))} ${shellQuote(wslPath(ASSET_ZIP))}`;
    const r = spawnSync("wsl", ["-e", "bash", "-lc", cmd], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("打包 nibi-langs.zip 失败");
  } else {
    const r = spawnSync("python3", [zipScript, assetDir, ASSET_ZIP], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("打包 nibi-langs.zip 失败");
  }
  writeFileSync(ASSET_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function ndkTool(ndk, name) {
  const ext = process.platform === "win32" ? ".exe" : "";
  const tag = process.platform === "win32" ? "windows-x86_64" : "linux-x86_64";
  return join(ndk, "toolchains/llvm/prebuilt", tag, "bin", name + ext);
}

function resolveNdk() {
  return process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT ?? null;
}

function verify(args) {
  const errors = [];
  const libs = args.nodeOnly
    ? ["libnode.so"]
    : args.pythonOnly
      ? ["libpython_bin.so", "libpython3.13.so", "libffi.so"]
      : LIBS;
  for (const name of libs) {
    const path = join(JNI_DIR, name);
    if (!existsSync(path)) {
      errors.push(`缺少 ${name}`);
      continue;
    }
    const bytes = readFileSync(path);
    const id = parseElfIdentity(bytes);
    if (!id.ok) errors.push(`${name}: ${id.errors.join("；")}`);
    if (elfLoadAlignment(bytes) < 0x4000) errors.push(`${name}: LOAD 对齐 < 16 KB`);
    const api = readAndroidAbiLevel(bytes);
    if (api === null || api > MIN_API) errors.push(`${name}: NDK API=${api} > ${MIN_API}`);
    if (EXECUTABLES.has(name) && readElfInterp(bytes) !== "/system/bin/linker64") {
      errors.push(`${name}: PT_INTERP 不是 linker64`);
    }
  }
  if (!existsSync(ASSET_MANIFEST)) errors.push("缺少 nibi-langs.json");
  else {
    const m = JSON.parse(readFileSync(ASSET_MANIFEST, "utf8"));
    if (!m.version?.startsWith("langs-1:")) errors.push("nibi-langs.json version 无效");
    for (const lib of Object.values(m.bin ?? {})) {
      if (!libs.includes(lib)) continue;
      if (!existsSync(join(JNI_DIR, lib))) errors.push(`清单引用的 ${lib} 不存在`);
    }
  }
  if (!existsSync(ASSET_ZIP)) errors.push("缺少 nibi-langs.zip");
  else {
    const zip = listZipEntries(readFileSync(ASSET_ZIP));
    if (zip.error) errors.push(`nibi-langs.zip 解析失败：${zip.error}`);
    else if (
      !zip.entries.some((entry) =>
        /^python\/lib\/python3\.13\/lib-dynload\/_sqlite3\..*\.so$/u.test(entry.name),
      )
    ) {
      errors.push("nibi-langs.zip 缺少 _sqlite3（Python sqlite3 不可用）");
    }
  }
  return errors;
}

function writeStamp(sources) {
  const files = {};
  for (const name of LIBS) {
    const p = join(JNI_DIR, name);
    if (existsSync(p)) files[name] = { sha256: sha256Hex(readFileSync(p)), bytes: statSync(p).size };
  }
  writeFileSync(
    STAMP,
    `${JSON.stringify(
      {
        schema: 1,
        api: API,
        node: sources.node.version,
        python: sources.python.version,
        files,
        assetZip: existsSync(ASSET_ZIP)
          ? { sha256: sha256Hex(readFileSync(ASSET_ZIP)), bytes: statSync(ASSET_ZIP).size }
          : null,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`stamp: ${STAMP}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = loadSources();
  if (!args.check) {
    if (!args.packageOnly) {
      await ensureSources(sources);
      runShell(args, sources);
    }
    packageLangs(sources);
  }
  console.log("\n校验语言运行时产物");
  const errors = verify(args);
  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("  ✓ 全部通过");
  if (!args.check) writeStamp(sources);
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
