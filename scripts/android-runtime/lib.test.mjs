// 纯函数单测：ELF 解析、zip 本地头解析、清单形状。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  elfLoadAlignment,
  listZipEntries,
  parseElfIdentity,
  readElfInterp,
  sha256Hex,
  verifyRuntimeManifest,
} from "./lib.mjs";

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}
function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}
function u64(value) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

function elf({ interp = "/system/bin/linker64", align = 0x4000 } = {}) {
  const ehdr = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]).copy(ehdr, 0);
  u16(3).copy(ehdr, 16); // ET_DYN
  u16(183).copy(ehdr, 18); // AArch64
  u64(64).copy(ehdr, 32); // e_phoff
  u16(56).copy(ehdr, 54); // e_phentsize
  u16(2).copy(ehdr, 56); // e_phnum

  const load = Buffer.alloc(56);
  u32(1).copy(load, 0); // PT_LOAD
  u64(0x1000).copy(load, 8);
  u64(0x1000).copy(load, 16);
  u64(0x10).copy(load, 32);
  u64(0x10).copy(load, 40);
  u64(align).copy(load, 48);

  const interpBytes = Buffer.from(`${interp}\0`);
  const interpOff = 64 + 56 + 56; // 紧接 ELF 头 + 两个程序头
  const interpPh = Buffer.alloc(56);
  u32(3).copy(interpPh, 0); // PT_INTERP
  u64(interpOff).copy(interpPh, 8);
  u64(interpBytes.length).copy(interpPh, 32);

  return Buffer.concat([ehdr, load, interpPh, interpBytes]);
}

function storedZip(entries) {
  const chunks = [];
  for (const [name, body] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    u32(0x04034b50).copy(header, 0);
    u16(20).copy(header, 4);
    u16(0).copy(header, 6);
    u16(0).copy(header, 8); // stored
    u32(body.length).copy(header, 18);
    u32(body.length).copy(header, 22);
    u16(nameBuf.length).copy(header, 26);
    chunks.push(header, nameBuf, body);
  }
  chunks.push(u32(0x02014b50));
  return Buffer.concat(chunks);
}

test("sha256Hex 与 Node 的已知向量一致", () => {
  assert.equal(
    sha256Hex(Buffer.from("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("ELF 身份/对齐/解释器", () => {
  const bytes = elf();
  assert.equal(parseElfIdentity(bytes).ok, true);
  assert.equal(elfLoadAlignment(bytes), 0x4000);
  assert.equal(readElfInterp(bytes), "/system/bin/linker64");
});

test("4 KB 对齐的 ELF 会被识别出来（调用方据此拒绝）", () => {
  assert.equal(elfLoadAlignment(elf({ align: 0x1000 })), 0x1000);
});

test("非 ELF 输入不抛异常", () => {
  assert.equal(parseElfIdentity(Buffer.from("nope")).ok, false);
  assert.equal(elfLoadAlignment(Buffer.from("nope")), 0);
  assert.equal(readElfInterp(Buffer.from("nope")), null);
});

test("listZipEntries 读本地文件头并停在中央目录", () => {
  const zip = storedZip([
    ["etc/bash_env.sh", Buffer.from("hello")],
    ["git-core/git-sh-setup", Buffer.from("#!/bin/sh\n")],
  ]);
  const { entries, error } = listZipEntries(zip);
  assert.equal(error, null);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["etc/bash_env.sh", "git-core/git-sh-setup"],
  );
  assert.equal(entries[0].uncompressed, 5);
});

test("listZipEntries 拒绝 data descriptor", () => {
  const zip = storedZip([["a", Buffer.from("x")]]);
  zip.writeUInt16LE(0x0008, 6); // flags
  const { error } = listZipEntries(zip);
  assert.match(error ?? "", /data descriptor/u);
});

test("verifyRuntimeManifest：完整清单通过，缺项报错", () => {
  const good = {
    schema: 1,
    version: "runtime-1:bash=5.2.37",
    bin: {
      bash: "libbash.so",
      busybox: "libbusybox.so",
      git: "libgit.so",
      "nibi-run": "libnibi_run.so",
    },
    applets: Array.from({ length: 120 }, (_, i) => `applet${i}`),
    gitCore: {
      git: "libgit.so",
      "git-remote-https": "libgit_remote_http.so",
      "git-upload-pack": "libgit.so",
      "git-receive-pack": "libgit.so",
    },
    gitScripts: ["git-submodule"],
    gitScriptLibs: ["git-sh-setup", "git-sh-i18n", "git-mergetool--lib"],
    hooks: ["pre-commit"],
  };
  assert.deepEqual(verifyRuntimeManifest(good), []);
  const bad = { ...good, schema: 2, applets: [], hooks: [] };
  const errors = verifyRuntimeManifest(bad);
  assert.ok(errors.some((error) => error.includes("schema")));
  assert.ok(errors.some((error) => error.includes("applets")));
  assert.ok(errors.some((error) => error.includes("hooks")));
});
