import { describe, expect, it } from "vitest";

import { inspectPluginArchive, isSafeArchivePath, MANIFEST_FILE } from "../src/plugins/packageFiles";

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

describe("isSafeArchivePath", () => {
  it("接受普通的相对路径", () => {
    expect(isSafeArchivePath("nibi-go.plugin.json")).toBe(true);
    expect(isSafeArchivePath("server/main.mjs")).toBe(true);
    expect(isSafeArchivePath("assets/icon-1.png")).toBe(true);
  });

  it("拒绝绝对路径、上跳、反斜杠与控制字符", () => {
    expect(isSafeArchivePath("/etc/passwd")).toBe(false);
    expect(isSafeArchivePath("C:/windows")).toBe(false);
    expect(isSafeArchivePath("../escape")).toBe(false);
    expect(isSafeArchivePath("a/../../b")).toBe(false);
    expect(isSafeArchivePath("a\\b")).toBe(false);
    expect(isSafeArchivePath("a/\u0001b")).toBe(false);
    expect(isSafeArchivePath("")).toBe(false);
  });

  it("拒绝过深的路径", () => {
    expect(isSafeArchivePath("a/b/c/d/e/f/g/h")).toBe(true);
    expect(isSafeArchivePath("a/b/c/d/e/f/g/h/i")).toBe(false);
  });
});

describe("inspectPluginArchive", () => {
  it("返回文件列表与根目录清单文本", () => {
    const result = inspectPluginArchive({
      [MANIFEST_FILE]: bytes('{"id":"nibi.demo"}'),
      "server/main.mjs": bytes("export {}"),
      "assets/": new Uint8Array(0),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifestText).toContain("nibi.demo");
    expect(result.files.map((file) => file.path)).toEqual([MANIFEST_FILE, "server/main.mjs"]);
  });

  it("缺少根目录清单时报错", () => {
    const result = inspectPluginArchive({ "server/main.mjs": bytes("x") });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain(MANIFEST_FILE);
  });

  it("不安全路径整包拒绝", () => {
    const result = inspectPluginArchive({
      [MANIFEST_FILE]: bytes("{}"),
      "../evil.mjs": bytes("x"),
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("路径不安全");
  });

  it("单文件超过 16 MiB 拒绝", () => {
    const big = new Uint8Array(16 * 1024 * 1024 + 1);
    const result = inspectPluginArchive({ [MANIFEST_FILE]: bytes("{}"), "big.bin": big });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("单个文件过大");
  });
});
