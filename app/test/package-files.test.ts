import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetLanguagePreferencesForTest, setLanguageMode } from "../src/i18n";
import { inspectPluginArchive, isSafeArchivePath, MANIFEST_FILE } from "../src/plugins/packageFiles";

beforeEach(async () => {
  await setLanguageMode("zh-CN");
});

afterEach(() => {
  resetLanguagePreferencesForTest();
});

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
    expect(result.formatKind).toBe("nibi-go");
    expect(result.manifestText).toContain("nibi.demo");
    expect(result.files.map((file) => file.path)).toEqual([MANIFEST_FILE, "server/main.mjs"]);
  });

  it("支持标准 .claude-plugin/.nibi-plugin/.codex-plugin 包并自动剥离 GitHub 单层目录", () => {
    const result = inspectPluginArchive({
      "my-skill-pack-1.2.0/.claude-plugin/plugin.json": bytes(
        JSON.stringify({
          name: "review-toolkit",
          version: "1.2.0",
          description: "代码审查标准技能包",
        }),
      ),
      "my-skill-pack-1.2.0/skills/code-review/SKILL.md": bytes(
        "---\nname: 代码审查\ndescription: 检查并发与边界条件\n---\n# 审查清单\n先看边界。",
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.formatKind).toBe("standard");
    expect(result.kernelName).toBe("review-toolkit");
    expect(result.files.map((f) => f.path)).toEqual([
      ".claude-plugin/plugin.json",
      "skills/code-review/SKILL.md",
    ]);
    const synth = JSON.parse(result.manifestText) as {
      id: string;
      version: string;
      skills: Array<{ id: string; name: string }>;
    };
    expect(synth.id).toBe("review-toolkit");
    expect(synth.version).toBe("1.2.0");
    expect(synth.skills[0]).toMatchObject({ id: "code-review", name: "代码审查" });
  });

  it("支持纯 SKILL.md ZIP 并自动合成 .nibi-plugin/plugin.json", () => {
    const result = inspectPluginArchive({
      "SKILL.md": bytes("---\nname: Weekly Report\ndescription: 生成周报\n---\n按本周成果与下周计划输出。"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.formatKind).toBe("skill-bundle");
    expect(result.files.some((f) => f.path === "skills/weekly-report/SKILL.md")).toBe(true);
    expect(result.synthesizedFiles.some((f) => f.path === ".nibi-plugin/plugin.json")).toBe(true);
    expect(result.synthesizedFiles.some((f) => f.path === MANIFEST_FILE)).toBe(true);
  });

  it("拦截包内 .node 与 ELF 原生二进制", () => {
    const nodeAddon = inspectPluginArchive({
      [MANIFEST_FILE]: bytes('{"id":"nibi.bad"}'),
      "native/addon.node": bytes("fake"),
    });
    expect(nodeAddon).toMatchObject({ ok: false });
    if (!nodeAddon.ok) expect(nodeAddon.reason).toContain("原生二进制");

    const elf = inspectPluginArchive({
      ".nibi-plugin/plugin.json": bytes('{"name":"elf-test"}'),
      "bin/tool": new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]),
    });
    expect(elf).toMatchObject({ ok: false });
    if (!elf.ok) expect(elf.reason).toContain("原生二进制");
  });

  it("缺少清单与技能文件时报错", () => {
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
