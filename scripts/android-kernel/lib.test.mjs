import assert from "node:assert/strict";
import { test } from "node:test";

import {
  elfLoadAlignment,
  parseElfIdentity,
  readAndroidAbiLevel,
  sha256Hex,
  verifyBuildJson,
} from "./lib.mjs";

/** 造一个最小 ELF64 LE + PT_LOAD + PT_NOTE（.note.android.ident）的文件。 */
function buildElf({ apiLevel = 24, type = 3, machine = 183, loadAlign = 0x4000 } = {}) {
  const phoff = 64;
  const phnum = 2;
  const noteOffset = phoff + phnum * 56;
  const name = Buffer.from("Android\0", "utf8"); // 8 字节
  const desc = Buffer.alloc(4);
  desc.writeUInt32LE(apiLevel, 0);
  const note = Buffer.alloc(12 + 8 + 4);
  note.writeUInt32LE(name.length, 0);
  note.writeUInt32LE(desc.length, 4);
  note.writeUInt32LE(1, 8); // NT_VERSION
  name.copy(note, 12);
  desc.copy(note, 12 + 8);

  const total = noteOffset + note.length;
  const elf = Buffer.alloc(total);
  elf.write("\x7fELF", 0, "latin1");
  elf[4] = 2; // ELF64
  elf[5] = 1; // little endian
  elf[6] = 1;
  elf.writeUInt16LE(type, 16);
  elf.writeUInt16LE(machine, 18);
  elf.writeBigUInt64LE(BigInt(phoff), 32);
  elf.writeUInt16LE(56, 54);
  elf.writeUInt16LE(phnum, 56);

  // 第 1 个程序头：PT_LOAD（只用于页对齐检查）。
  elf.writeUInt32LE(1, phoff);
  elf.writeBigUInt64LE(0n, phoff + 8);
  elf.writeBigUInt64LE(BigInt(total), phoff + 32);
  elf.writeBigUInt64LE(BigInt(loadAlign), phoff + 48);

  // 第 2 个程序头：PT_NOTE（.note.android.ident）。
  const ph = phoff + 56;
  elf.writeUInt32LE(4, ph); // PT_NOTE
  elf.writeBigUInt64LE(BigInt(noteOffset), ph + 8);
  elf.writeBigUInt64LE(BigInt(note.length), ph + 32);
  note.copy(elf, noteOffset);
  return elf;
}

test("parseElfIdentity：认出 AArch64 共享对象", () => {
  const result = parseElfIdentity(buildElf());
  assert.equal(result.ok, true, result.errors.join("；"));
  assert.equal(result.machine, 183);
  assert.equal(result.type, 3);
});

test("parseElfIdentity：拒绝可执行文件与别的架构", () => {
  const exec = parseElfIdentity(buildElf({ type: 2 }));
  assert.equal(exec.ok, false);
  assert.match(exec.errors.join(), /共享对象/);

  const x86 = parseElfIdentity(buildElf({ machine: 62 }));
  assert.equal(x86.ok, false);
  assert.match(x86.errors.join(), /AArch64/);

  const notElf = parseElfIdentity(Buffer.from("not an elf file at all, but long enough to read"));
  assert.equal(notElf.ok, false);
});

test("readAndroidAbiLevel：从 .note.android.ident 读 API", () => {
  assert.equal(readAndroidAbiLevel(buildElf({ apiLevel: 24 })), 24);
  assert.equal(readAndroidAbiLevel(buildElf({ apiLevel: 21 })), 21);
  assert.equal(readAndroidAbiLevel(Buffer.alloc(128)), null);
});

test("elfLoadAlignment：读出 PT_LOAD 的最大对齐", () => {
  assert.equal(elfLoadAlignment(buildElf({ loadAlign: 0x4000 })), 0x4000);
  assert.equal(elfLoadAlignment(buildElf({ loadAlign: 0x1000 })), 0x1000);
  assert.equal(elfLoadAlignment(Buffer.alloc(128)), 0);
});

test("verifyBuildJson：接受三产物 schema", () => {
  const build = {
    version: "4.1.0",
    target: "aarch64-linux-android",
    sha256: "a".repeat(64),
    artifacts: [
      { kind: "bin", path: "bin/nibi-rs", sha256: "b".repeat(64) },
      { kind: "cdylib", path: "lib/libnibi.so", sha256: "c".repeat(64) },
      { kind: "shared-library", path: "lib/libc++_shared.so", sha256: "d".repeat(64) },
    ],
  };
  const result = verifyBuildJson(build, { version: "4.1.0", target: "aarch64-linux-android" });
  assert.equal(result.ok, true, result.errors.join("；"));
  assert.equal(result.artifacts.cdylib.path, "lib/libnibi.so");
});

test("verifyBuildJson：缺产物、坏 sha、版本不符都要报错", () => {
  const base = {
    version: "4.0.2",
    target: "aarch64-linux-android",
    artifacts: [{ kind: "bin", path: "bin/nibi-rs", sha256: "b".repeat(64) }],
  };
  const result = verifyBuildJson(base, { version: "4.1.0", target: "aarch64-linux-android" });
  assert.equal(result.ok, false);
  const messages = result.errors.join("\n");
  assert.match(messages, /version 不一致/);
  assert.match(messages, /缺少 cdylib/);
  assert.match(messages, /缺少 shared-library/);

  const badSha = verifyBuildJson(
    {
      version: "4.1.0",
      target: "aarch64-linux-android",
      artifacts: [
        { kind: "bin", path: "bin/nibi-rs", sha256: "b".repeat(64) },
        { kind: "cdylib", path: "lib/libnibi.so", sha256: "NOT-A-SHA" },
        { kind: "shared-library", path: "lib/libc++_shared.so", sha256: "d".repeat(64) },
      ],
    },
    {},
  );
  assert.equal(badSha.ok, false);
  assert.match(badSha.errors.join("\n"), /sha256 不是/);
});

test("sha256Hex：与已知向量一致", () => {
  assert.equal(
    sha256Hex(Buffer.from("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
