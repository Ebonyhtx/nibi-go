// Android 内核包校验的纯函数（无 IO，可用 `node --test` 直接测）。
//
// 依据：nibi-client `docs/android-cdylib-abi.md`（v1 C ABI）与 `build.json.artifacts`。
// 这里不做「信任上游」的假设——sha256、ELF 身份、Android API level 三项都现场算。

import { createHash } from "node:crypto";

export const REQUIRED_KINDS = ["bin", "cdylib", "shared-library"];

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46]; // \x7fELF
const ET_DYN = 3;
const EM_AARCH64 = 183;
const PT_NOTE = 4;
const NT_VERSION = 1;

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 校验 `build.json` 的形状与版本/target；返回按 kind 索引的产物表。
 * @returns {{ ok: boolean, errors: string[], artifacts: Record<string, {path: string, sha256: string}> }}
 */
export function verifyBuildJson(build, expected) {
  const errors = [];
  const artifacts = {};
  if (!build || typeof build !== "object") {
    return { ok: false, errors: ["build.json 不是对象"], artifacts };
  }
  if (expected?.version && build.version !== expected.version) {
    errors.push(`version 不一致：build.json=${build.version} 期望=${expected.version}`);
  }
  if (expected?.target && build.target !== expected.target) {
    errors.push(`target 不一致：build.json=${build.target} 期望=${expected.target}`);
  }
  if (!Array.isArray(build.artifacts)) {
    errors.push("缺少 artifacts 数组（旧 schema 不能用于进程内内核）");
    return { ok: false, errors, artifacts };
  }
  for (const item of build.artifacts) {
    if (!item || typeof item !== "object") {
      errors.push("artifacts 里有非对象条目");
      continue;
    }
    const { kind, path, sha256 } = item;
    if (typeof kind !== "string" || typeof path !== "string" || typeof sha256 !== "string") {
      errors.push(`artifacts 条目字段不全：${JSON.stringify(item)}`);
      continue;
    }
    if (!/^[0-9a-f]{64}$/u.test(sha256)) {
      errors.push(`${kind} 的 sha256 不是 64 位小写十六进制：${sha256}`);
    }
    if (artifacts[kind]) {
      errors.push(`artifacts 里 ${kind} 重复`);
    }
    artifacts[kind] = { path, sha256 };
  }
  for (const kind of REQUIRED_KINDS) {
    if (!artifacts[kind]) errors.push(`artifacts 缺少 ${kind}`);
  }
  return { ok: errors.length === 0, errors, artifacts };
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

/**
 * 读 ELF 头，确认是 64 位小端 AArch64 共享对象。
 * @returns {{ ok: boolean, errors: string[], elfClass: number, type: number, machine: number }}
 */
export function parseElfIdentity(bytes) {
  const errors = [];
  if (!bytes || bytes.length < 64) {
    return { ok: false, errors: ["文件太小，不是 ELF"], elfClass: 0, type: 0, machine: 0 };
  }
  for (let i = 0; i < ELF_MAGIC.length; i++) {
    if (bytes[i] !== ELF_MAGIC[i]) {
      return { ok: false, errors: ["没有 ELF magic"], elfClass: 0, type: 0, machine: 0 };
    }
  }
  const elfClass = bytes[4];
  const littleEndian = bytes[5] === 1;
  if (elfClass !== 2) errors.push(`不是 ELF64（class=${elfClass}）`);
  if (!littleEndian) errors.push("不是小端 ELF");
  const view = viewOf(bytes);
  const type = u16(view, 16);
  const machine = u16(view, 18);
  if (type !== ET_DYN) errors.push(`不是共享对象（e_type=${type}，期望 ${ET_DYN}）`);
  if (machine !== EM_AARCH64) errors.push(`不是 AArch64（e_machine=${machine}）`);
  return { ok: errors.length === 0, errors, elfClass, type, machine };
}

/**
 * 从 `.note.android.ident` 读 NDK 目标 API level。
 * @returns {number | null} 找不到 note 时返回 null。
 */
export function readAndroidAbiLevel(bytes) {
  if (!bytes || bytes.length < 64) return null;
  const view = viewOf(bytes);
  if (u32(view, 0) !== 0x464c457f) return null; // \x7fELF 小端
  if (bytes[4] !== 2) return null; // 只支持 ELF64
  const phoff = u64(view, 32);
  const phentsize = u16(view, 54);
  const phnum = u16(view, 56);
  for (let i = 0; i < phnum; i++) {
    const ph = phoff + i * phentsize;
    if (ph + 56 > bytes.length) break;
    if (u32(view, ph) !== PT_NOTE) continue;
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
      if (name === "Android" && type === NT_VERSION && descsz >= 4) {
        return u32(view, descStart);
      }
      cursor = next;
    }
  }
  return null;
}

function align4(value) {
  return (value + 3) & ~3;
}
