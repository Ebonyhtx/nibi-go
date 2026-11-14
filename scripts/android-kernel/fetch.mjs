#!/usr/bin/env node
// 构建期拉取 Android 内核产物（Phase C / D19）。
//
// 从 npm 平台包 `@nibi-studio/cli-android-arm64` 取 `lib/libnibi.so` + `lib/libc++_shared.so`，
// 按 `build.json.artifacts` 逐项校验 sha256，并现场核实 ELF 身份与 Android 目标 API level，
// 通过后落到 `app/modules/kernel-host/android/prebuilt/jniLibs/<abi>/`（gitignore，不入库）。
//
// 用法：
//   node scripts/android-kernel/fetch.mjs                # 按 pin.json 拉取（已有则跳过）
//   node scripts/android-kernel/fetch.mjs --force        # 强制重拉
//   node scripts/android-kernel/fetch.mjs --check        # 只校验已落盘产物
//   node scripts/android-kernel/fetch.mjs --tarball x.tgz # 用本地 tarball（离线/预检）
//   node scripts/android-kernel/fetch.mjs --version 4.1.0
//
// 任何一项校验失败都以非 0 退出——消费端 fail-closed，不把不可信的 .so 拷进 jniLibs。

import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import {
  elfLoadAlignment,
  parseElfIdentity,
  readAndroidAbiLevel,
  REQUIRED_KINDS,
  sha256Hex,
  verifyBuildJson,
} from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PIN_PATH = join(ROOT, "scripts/android-kernel/pin.json");
const PREBUILT_DIR = join(ROOT, "app/modules/kernel-host/android/prebuilt");
const STAMP_PATH = join(PREBUILT_DIR, ".stamp.json");

// 设备上只需要这两个：cdylib 本体 + 它的 C++ 运行时。bin/nibi-rs 只给开发机对照。
const DEVICE_KINDS = ["cdylib", "shared-library"];

function parseArgs(argv) {
  const args = { force: false, check: false, tarball: null, version: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") args.force = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--tarball") args.tarball = argv[++i];
    else if (arg === "--version") args.version = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/android-kernel/fetch.mjs [--force|--check] [--tarball <tgz>] [--version <v>]");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function verifyStaged(stamp, pin) {
  const errors = [];
  for (const kind of DEVICE_KINDS) {
    const entry = stamp.artifacts?.[kind];
    if (!entry) {
      errors.push(`stamp 缺少 ${kind}`);
      continue;
    }
    const file = join(PREBUILT_DIR, "jniLibs", pin.abi, entry.file);
    if (!(await exists(file))) {
      errors.push(`缺少落盘产物 ${entry.file}`);
      continue;
    }
    const bytes = await readFile(file);
    if (sha256Hex(bytes) !== entry.sha256) {
      errors.push(`${entry.file} sha256 不符（文件被改动或落盘不完整）`);
    }
  }
  return errors;
}

async function downloadTarball(pkg, version, target) {
  const metaUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/${version}`;
  const metaRes = await fetch(metaUrl, { headers: { accept: "application/json" } });
  if (!metaRes.ok) {
    throw new Error(`读取 npm 元数据失败：${metaRes.status} ${metaRes.statusText}（${metaUrl}）`);
  }
  const meta = await metaRes.json();
  const tarballUrl = meta?.dist?.tarball;
  if (!tarballUrl) {
    throw new Error(`npm 元数据里没有 dist.tarball：${metaUrl}`);
  }
  const res = await fetch(tarballUrl);
  if (!res.ok || !res.body) {
    throw new Error(`下载 tarball 失败：${res.status} ${res.statusText}（${tarballUrl}）`);
  }
  await mkdir(dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  return tarballUrl;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pin = await readJson(PIN_PATH);
  const version = args.version ?? pin.version;

  if (args.check) {
    if (!(await exists(STAMP_PATH))) {
      console.error(`[android-kernel] 没有落盘产物：${STAMP_PATH}`);
      process.exit(1);
    }
    const stamp = await readJson(STAMP_PATH);
    const errors = [];
    if (stamp.version !== pin.version) {
      errors.push(`落盘版本 ${stamp.version} 与 pin ${pin.version} 不一致（先跑 fetch --force）`);
    }
    errors.push(...(await verifyStaged(stamp, pin)));
    if (errors.length > 0) {
      for (const error of errors) console.error(`[android-kernel] ${error}`);
      process.exit(1);
    }
    console.log(`[android-kernel] 校验通过：v${stamp.version} → jniLibs/${pin.abi}`);
    return;
  }

  if (!args.force && !args.tarball && (await exists(STAMP_PATH))) {
    const stamp = await readJson(STAMP_PATH);
    if (stamp.version === version && stamp.package === pin.package) {
      const errors = await verifyStaged(stamp, pin);
      if (errors.length === 0) {
        console.log(`[android-kernel] 已是最新：${pin.package}@${version}（--force 可重拉）`);
        return;
      }
      console.warn(`[android-kernel] 落盘产物不完整，重新拉取：${errors.join("；")}`);
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), "nibi-android-kernel-"));
  try {
    const tarballPath = join(workDir, "package.tgz");
    if (args.tarball) {
      await copyFile(resolve(args.tarball), tarballPath);
      console.log(`[android-kernel] 使用本地 tarball：${resolve(args.tarball)}`);
    } else {
      const url = await downloadTarball(pin.package, version, tarballPath);
      console.log(`[android-kernel] 已下载 ${pin.package}@${version}`);
      console.log(`[android-kernel]   ${url}`);
    }

    // 相对路径 + cwd：GNU tar 在 Windows 上会把 `C:\...` 当成远程 host 说明符。
    const extractDir = join(workDir, "extract");
    await mkdir(extractDir, { recursive: true });
    execFileSync("tar", ["-xzf", "package.tgz", "-C", "extract"], { cwd: workDir, stdio: "inherit" });
    const pkgDir = join(extractDir, "package");

    const build = await readJson(join(pkgDir, "build.json"));
    const verified = verifyBuildJson(build, { version, target: pin.target });
    if (!verified.ok) {
      throw new Error(`build.json 校验失败：\n  ${verified.errors.join("\n  ")}`);
    }

    for (const kind of REQUIRED_KINDS) {
      const entry = verified.artifacts[kind];
      const file = join(pkgDir, entry.path);
      if (!(await exists(file))) {
        throw new Error(`包内缺少 ${entry.path}`);
      }
      const bytes = await readFile(file);
      const actual = sha256Hex(bytes);
      if (actual !== entry.sha256) {
        throw new Error(`${entry.path} sha256 不符：实际 ${actual}，build.json ${entry.sha256}`);
      }
      const identity = parseElfIdentity(bytes);
      if (!identity.ok) {
        throw new Error(`${entry.path} 不是可用的 Android 产物：${identity.errors.join("；")}`);
      }
      if (kind === "cdylib") {
        const apiLevel = readAndroidAbiLevel(bytes);
        if (apiLevel === null) {
          throw new Error(`${entry.path} 没有 .note.android.ident，无法确认目标 API`);
        }
        if (apiLevel > pin.maxAndroidApiLevel) {
          throw new Error(
            `${entry.path} 目标 API ${apiLevel} 高于 App minSdk ${pin.maxAndroidApiLevel}，在低版本设备上可能 dlopen 失败`,
          );
        }
        const loadAlign = elfLoadAlignment(bytes);
        if (loadAlign < pin.minPageAlign) {
          throw new Error(
            `${entry.path} 的 LOAD 段对齐 ${loadAlign} 小于 16 KB（${pin.minPageAlign}）：` +
              `16 KB 页设备装不上，需要上游带 -Wl,-z,max-page-size=16384 重新构建`,
          );
        }
        console.log(
          `[android-kernel] cdylib 目标 API ${apiLevel}（App minSdk ${pin.maxAndroidApiLevel}），页对齐 0x${loadAlign.toString(16)}`,
        );
      }
      console.log(`[android-kernel] ${kind}: ${entry.path} sha256 匹配`);
    }

    const destDir = join(PREBUILT_DIR, "jniLibs", pin.abi);
    await mkdir(destDir, { recursive: true });
    const staged = {};
    for (const kind of DEVICE_KINDS) {
      const entry = verified.artifacts[kind];
      const file = entry.path.slice(entry.path.lastIndexOf("/") + 1);
      await copyFile(join(pkgDir, entry.path), join(destDir, file));
      staged[kind] = { file, sha256: entry.sha256 };
      console.log(`[android-kernel] → jniLibs/${pin.abi}/${file}`);
    }
    await writeFile(
      STAMP_PATH,
      `${JSON.stringify(
        {
          package: pin.package,
          version,
          target: pin.target,
          abi: pin.abi,
          fetchedAt: new Date().toISOString(),
          artifacts: staged,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`[android-kernel] 完成：${PREBUILT_DIR}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[android-kernel] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
