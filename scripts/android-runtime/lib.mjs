// Android 运行时产物的纯函数校验（无 IO，可用 `node --test` 直接测）。
//
// 与 libnibi.so 同一套底线：ELF 身份、Android API、16 KB LOAD 对齐，
// 外加运行时特有的两条：PT_INTERP 必须是 linker64、未定义符号不能超出 API 24 的 libc/libm/libdl。

import { createHash } from "node:crypto";

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const ET_DYN = 3;
const EM_AARCH64 = 183;
const PT_LOAD = 1;
const PT_INTERP = 3;

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(view, off) {
  return view.getUint16(off, true);
}

function u32(view, off) {
  return view.getUint32(off, true);
}

function u64(view, off) {
  return Number(view.getBigUint64(off, true));
}

/** ELF64 小端 AArch64 DYN 三项身份（与 android-kernel/lib.mjs 同口径）。 */
export function parseElfIdentity(bytes) {
  const errors = [];
  if (!bytes || bytes.length < 64) {
    return { ok: false, errors: ["文件太小，不是 ELF"] };
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== ELF_MAGIC[i]) return { ok: false, errors: ["没有 ELF magic"] };
  }
  if (bytes[4] !== 2) errors.push(`不是 ELF64（class=${bytes[4]}）`);
  if (bytes[5] !== 1) errors.push("不是小端 ELF");
  const view = viewOf(bytes);
  const type = u16(view, 16);
  const machine = u16(view, 18);
  if (type !== ET_DYN) errors.push(`不是共享对象/PIE（e_type=${type}）`);
  if (machine !== EM_AARCH64) errors.push(`不是 AArch64（e_machine=${machine}）`);
  return { ok: errors.length === 0, errors, type, machine };
}

/** 最大 PT_LOAD 对齐；16 KB 页设备要求 >= 0x4000。 */
export function elfLoadAlignment(bytes) {
  if (!bytes || bytes.length < 64 || u32(viewOf(bytes), 0) !== 0x464c457f) return 0;
  if (bytes[4] !== 2) return 0;
  const view = viewOf(bytes);
  const phoff = u64(view, 32);
  const phentsize = u16(view, 54);
  const phnum = u16(view, 56);
  let max = 0;
  for (let i = 0; i < phnum; i++) {
    const ph = phoff + i * phentsize;
    if (ph + 56 > bytes.length) break;
    if (u32(view, ph) !== PT_LOAD) continue;
    const align = u64(view, ph + 48);
    if (align > max) max = align;
  }
  return max;
}

/** PT_INTERP 里的解释器路径（bionic PIE 应为 /system/bin/linker64）。 */
export function readElfInterp(bytes) {
  if (!bytes || bytes.length < 64 || u32(viewOf(bytes), 0) !== 0x464c457f) return null;
  if (bytes[4] !== 2) return null;
  const view = viewOf(bytes);
  const phoff = u64(view, 32);
  const phentsize = u16(view, 54);
  const phnum = u16(view, 56);
  for (let i = 0; i < phnum; i++) {
    const ph = phoff + i * phentsize;
    if (ph + 56 > bytes.length) break;
    if (u32(view, ph) !== PT_INTERP) continue;
    const offset = u64(view, ph + 8);
    const size = u64(view, ph + 32);
    if (offset + size > bytes.length) return null;
    return Buffer.from(bytes.buffer, bytes.byteOffset + offset, size)
      .toString("utf8")
      .replace(/\0+$/u, "");
  }
  return null;
}

/** 从 `.note.android.ident` 读 NDK 目标 API level。 */
export function readAndroidAbiLevel(bytes) {
  if (!bytes || bytes.length < 64) return null;
  const view = viewOf(bytes);
  if (u32(view, 0) !== 0x464c457f || bytes[4] !== 2) return null;
  const phoff = u64(view, 32);
  const phentsize = u16(view, 54);
  const phnum = u16(view, 56);
  for (let i = 0; i < phnum; i++) {
    const ph = phoff + i * phentsize;
    if (ph + 56 > bytes.length) break;
    if (u32(view, ph) !== 4) continue; // PT_NOTE
    const offset = u64(view, ph + 8);
    const size = u64(view, ph + 32);
    if (offset + size > bytes.length) continue;
    let cursor = offset;
    const end = offset + size;
    while (cursor + 12 <= end) {
      const namesz = u32(view, cursor);
      const descsz = u32(view, cursor + 4);
      const type = u32(view, cursor + 8);
      const nameStart = cursor + 12;
      const descStart = nameStart + align4(namesz);
      const next = descStart + align4(descsz);
      if (descStart + descsz > end || next > end) break;
      const name = Buffer.from(bytes.buffer, bytes.byteOffset + nameStart, namesz)
        .toString("utf8")
        .replace(/\0+$/u, "");
      if (name === "Android" && type === 1 && descsz >= 4) return u32(view, descStart);
      cursor = next;
    }
  }
  return null;
}

function align4(value) {
  return (value + 3) & ~3;
}

/**
 * 解析 zip 的本地文件头（make-assets-zip.py 不使用 data descriptor）。
 * 返回条目名与解压后大小；结构异常时返回 error。
 */
export function listZipEntries(bytes) {
  if (!bytes || bytes.length < 22) return { entries: [], error: "zip 太小" };
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const view = viewOf(bytes);
    if (u32(view, offset) !== 0x04034b50) {
      // 到达中央目录即停止（0x02014b50）。
      if (u32(view, offset) === 0x02014b50) break;
      return { entries, error: `偏移 ${offset} 不是本地文件头` };
    }
    const flags = u16(view, offset + 6);
    if (flags & 0x0008) return { entries, error: "不支持 data descriptor 的 zip" };
    const compressed = u32(view, offset + 18);
    const uncompressed = u32(view, offset + 22);
    const nameLen = u16(view, offset + 26);
    const extraLen = u16(view, offset + 28);
    const nameStart = offset + 30;
    if (nameStart + nameLen + extraLen + compressed > bytes.length) {
      return { entries, error: "zip 条目越界" };
    }
    const name = Buffer.from(bytes.buffer, bytes.byteOffset + nameStart, nameLen).toString("utf8");
    entries.push({ name, compressed, uncompressed });
    offset = nameStart + nameLen + extraLen + compressed;
  }
  return { entries, error: null };
}

/** 清单形状校验；libName 是否存在由调用方按文件系统检查。 */
export function verifyRuntimeManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return ["清单不是对象"];
  if (manifest.schema !== 1) errors.push(`schema 不是 1：${manifest.schema}`);
  if (typeof manifest.version !== "string" || !manifest.version.startsWith("runtime-1:")) {
    errors.push("version 不是 runtime-1:*");
  }
  const bin = manifest.bin;
  if (!bin || typeof bin !== "object") {
    errors.push("bin 缺失");
  } else {
    for (const name of ["bash", "busybox", "git", "nibi-run"]) {
      if (typeof bin[name] !== "string") errors.push(`bin 缺少 ${name}`);
    }
  }
  if (!Array.isArray(manifest.applets) || manifest.applets.length < 100) {
    errors.push("applets 少于 100 个（busybox 配置可能出错）");
  }
  const core = manifest.gitCore;
  if (!core || typeof core !== "object") {
    errors.push("gitCore 缺失");
  } else {
    for (const name of ["git", "git-remote-https", "git-upload-pack", "git-receive-pack"]) {
      if (typeof core[name] !== "string") errors.push(`gitCore 缺少 ${name}`);
    }
  }
  if (!Array.isArray(manifest.gitScripts) || !manifest.gitScripts.includes("git-submodule")) {
    errors.push("gitScripts 缺少 git-submodule");
  }
  if (
    !Array.isArray(manifest.gitScriptLibs) ||
    !manifest.gitScriptLibs.includes("git-sh-setup") ||
    !manifest.gitScriptLibs.includes("git-sh-i18n")
  ) {
    errors.push("gitScriptLibs 缺少 git-sh-setup/git-sh-i18n");
  }
  if (!Array.isArray(manifest.hooks) || !manifest.hooks.includes("pre-commit")) {
    errors.push("hooks 缺少 pre-commit");
  }
  return errors;
}

/** 允许的 NEEDED：bionic 的 libc/libm/libdl/liblog。 */
export const ALLOWED_NEEDED = new Set(["libc.so", "libm.so", "libdl.so", "liblog.so"]);
