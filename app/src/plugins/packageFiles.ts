// 插件 zip 的纯逻辑校验与标准格式适配：
// - 安全门禁：路径安全、体积/数量上限、拦截原生二进制（.node/.so/.dylib/.dll/.exe 与 ELF 魔数）；
// - 格式兼容（不依赖 expo/RN，Node 侧可单测）：
//   1. `nibi-go.plugin.json`（NIBI-GO 原生 UI 扩展格式，降级为可选）；
//   2. 标准跨端清单 `.nibi-plugin/plugin.json`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`；
//   3. 纯技能/命令包（`skills/<id>/SKILL.md`、根目录 `SKILL.md` 或 `commands/*.md`）；
// - 自动剥离 GitHub Releases / Source Archive 常见的单层顶层目录包装。

import { pickText } from "../i18n";

export const MANIFEST_FILE = "nibi-go.plugin.json";

export const STANDARD_MANIFEST_PATHS = [
  ".nibi-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
] as const;

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PATH_LENGTH = 200;
const MAX_DEPTH = 8;

const NATIVE_EXTS = [".node", ".so", ".dylib", ".dll", ".exe"] as const;

export type ArchivePluginFormat = "nibi-go" | "standard" | "skill-bundle";

export interface ArchiveFile {
  /** zip 内的相对路径（`/` 分隔，已通过安全校验）。 */
  path: string;
  bytes: Uint8Array;
}

export type ArchiveInspection =
  | {
      ok: true;
      files: ArchiveFile[];
      /** 供 NIBI-GO 宿主解析的清单 JSON（标准包/纯技能包由适配器自动合成）。 */
      manifestText: string;
      /** 包形态：原生 nibi-go、标准 .nibi/.claude/.codex-plugin 或纯技能包。 */
      formatKind: ArchivePluginFormat;
      /** 写入内核配置 `enabledPlugins["<kernelName>@inline"]` 的标准名称。 */
      kernelName?: string;
      /** 需要补写到目标目录的合成文件（例如给纯技能包补 `.nibi-plugin/plugin.json`）。 */
      synthesizedFiles: Array<{ path: string; content: string }>;
    }
  | { ok: false; reason: string };

/** 拒绝绝对路径、`..`、反斜杠、控制字符与过深的路径。 */
export function isSafeArchivePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path)) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (/[\u0000-\u001f\u007f]/u.test(path)) return false;
  const segments = path.split("/");
  if (segments.length > MAX_DEPTH) return false;
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isElfBytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46
  );
}

function isNativeBinary(path: string, bytes: Uint8Array): boolean {
  const lower = path.toLowerCase();
  if (NATIVE_EXTS.some((ext) => lower.endsWith(ext))) return true;
  return isElfBytes(bytes);
}

function hasAnyManifestAtCurrentLevel(files: readonly ArchiveFile[]): boolean {
  return files.some(
    (file) =>
      file.path === MANIFEST_FILE ||
      (STANDARD_MANIFEST_PATHS as readonly string[]).includes(file.path) ||
      file.path === "SKILL.md" ||
      /^skills\/[^/]+\/SKILL\.md$/u.test(file.path) ||
      /^commands\/[^/]+\.md$/u.test(file.path),
  );
}

/** GitHub Releases / Source ZIP 常把所有文件包在单一顶层目录里，若是则自动剥离这一层。 */
function unwrapSingleRootFolder(files: ArchiveFile[]): ArchiveFile[] {
  if (files.length === 0 || hasAnyManifestAtCurrentLevel(files)) return files;
  const firstSlash = files[0]!.path.indexOf("/");
  if (firstSlash <= 0) return files;
  const prefix = files[0]!.path.slice(0, firstSlash + 1);
  if (!files.every((file) => file.path.startsWith(prefix) && file.path.length > prefix.length)) {
    return files;
  }
  const stripped = files.map((file) => ({ path: file.path.slice(prefix.length), bytes: file.bytes }));
  return hasAnyManifestAtCurrentLevel(stripped) ? stripped : files;
}

function slugifyId(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "")
    .slice(0, 60);
  return cleaned.length >= 2 ? cleaned : fallback;
}

function normalizeVersion(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^v/iu, "");
    if (/^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u.test(trimmed)) {
      return trimmed;
    }
  }
  return "1.0.0";
}

function parseFrontmatter(markdown: string): { name?: string; description?: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(markdown);
  if (!match) return { body: markdown.trim() };
  const yaml = match[1]!;
  const body = match[2]!.trim();
  let name: string | undefined;
  let description: string | undefined;
  for (const line of yaml.split(/\r?\n/u)) {
    const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*$/u.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const rawVal = kv[2]!.replace(/^["']|["']$/gu, "").trim();
    if (key === "name" && rawVal) name = rawVal;
    if (key === "description" && rawVal) description = rawVal;
  }
  return { name, description, body };
}

interface DiscoveredSkill {
  id: string;
  name: string;
  description?: string;
  body: string;
}

function discoverSkills(files: readonly ArchiveFile[], decoder: TextDecoder): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/iu.exec(file.path);
    if (!match) continue;
    const id = slugifyId(match[1]!, "skill");
    if (seen.has(id)) continue;
    seen.add(id);
    const md = decoder.decode(file.bytes);
    const parsed = parseFrontmatter(md);
    const body = (parsed.body || md).slice(0, 15_000);
    if (!body) continue;
    skills.push({
      id,
      name: (parsed.name ?? match[1]!).slice(0, 64),
      ...(parsed.description ? { description: parsed.description.slice(0, 280) } : {}),
      body,
    });
    if (skills.length >= 8) break;
  }
  return skills;
}

function discoverCommandNames(files: readonly ArchiveFile[]): string[] {
  const names: string[] = [];
  for (const file of files) {
    const match = /^commands\/([^/]+)\.md$/iu.exec(file.path);
    if (!match) continue;
    const cmd = slugifyId(match[1]!, "");
    if (cmd && !names.includes(cmd)) names.push(cmd);
  }
  return names;
}

/**
 * 从标准 `.nibi-plugin` / `.claude-plugin` / `.codex-plugin` 清单 JSON 合成宿主可展示的 `nibi-go.plugin.json`。
 * 注意：标准包的 skills/commands/mcpServers 由 Rust 内核原生加载，这里只生成宿主元数据与技能摘要，
 * 不额外注册重复的 `runtime`，防止同一个 MCP 服务器被启动两次。
 */
export function synthesizeHostManifestFromStandard(
  rawStandard: Record<string, unknown>,
  options: {
    fallbackId?: string;
    skills?: readonly DiscoveredSkill[];
    commandCount?: number;
  } = {},
): { manifestJson: string; kernelName: string; id: string } {
  const rawName = typeof rawStandard.name === "string" ? rawStandard.name.trim() : "";
  const id = slugifyId(rawName || options.fallbackId || "standard-plugin", "standard-plugin");
  const kernelName = rawName || id;
  const displayName = (
    (typeof rawStandard.displayName === "string" && rawStandard.displayName.trim()) ||
    rawName ||
    id
  ).slice(0, 64);
  const version = normalizeVersion(rawStandard.version);
  const rawDesc =
    typeof rawStandard.description === "string" ? rawStandard.description.trim() : "";
  const hasMcp =
    typeof rawStandard.mcpServers === "object" &&
    rawStandard.mcpServers !== null &&
    Object.keys(rawStandard.mcpServers as Record<string, unknown>).length > 0;
  const caps = hasMcp ? ["slots.v1", "mcp.v1"] : ["slots.v1"];

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id,
    name: displayName,
    version,
    ...(rawDesc ? { description: rawDesc.slice(0, 280) } : {}),
    caps,
    ...(options.skills && options.skills.length > 0 ? { skills: options.skills } : {}),
  };
  return {
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
    kernelName,
    id,
  };
}

export function inspectPluginArchive(entries: Record<string, Uint8Array>): ArchiveInspection {
  let files: ArchiveFile[] = [];
  let total = 0;
  for (const [rawPath, bytes] of Object.entries(entries)) {
    // 目录条目（以 / 结尾）和 macOS 打包垃圾忽略。
    if (rawPath.endsWith("/") || rawPath.startsWith("__MACOSX/") || rawPath.endsWith("/.DS_Store")) {
      continue;
    }
    if (!isSafeArchivePath(rawPath)) {
      return {
        ok: false,
        reason: pickText(
          `包内路径不安全：${rawPath.slice(0, 80)}`,
          `Unsafe archive path: ${rawPath.slice(0, 80)}`,
        ),
      };
    }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: pickText(`单个文件过大：${rawPath}`, `File too large: ${rawPath}`),
      };
    }
    if (isNativeBinary(rawPath, bytes)) {
      return {
        ok: false,
        reason: pickText(
          `包内含原生二进制文件（${rawPath}），手机端不支持`,
          `Archive contains native binary (${rawPath}), which is not supported on mobile`,
        ),
      };
    }
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      return {
        ok: false,
        reason: pickText("包解压后超过 32 MiB", "Extracted archive exceeds 32 MiB"),
      };
    }
    if (files.length >= MAX_FILES) {
      return {
        ok: false,
        reason: pickText("包内文件数超过 500", "Archive contains more than 500 files"),
      };
    }
    files.push({ path: rawPath, bytes });
  }

  files = unwrapSingleRootFolder(files);
  const decoder = new TextDecoder();

  // 1) 优先识别 NIBI-GO 原生扩展清单（兼容现有包，同时降级为可选增强）
  const goManifest = files.find((file) => file.path === MANIFEST_FILE);
  if (goManifest) {
    const standardFile = files.find((file) =>
      (STANDARD_MANIFEST_PATHS as readonly string[]).includes(file.path),
    );
    let kernelName: string | undefined;
    if (standardFile) {
      try {
        const parsedStd = JSON.parse(decoder.decode(standardFile.bytes)) as Record<string, unknown>;
        if (typeof parsedStd.name === "string" && parsedStd.name.trim()) {
          kernelName = parsedStd.name.trim();
        }
      } catch {
        // 标准清单坏掉不阻塞原生清单解析
      }
    }
    return {
      ok: true,
      files,
      manifestText: decoder.decode(goManifest.bytes),
      formatKind: "nibi-go",
      ...(kernelName ? { kernelName } : {}),
      synthesizedFiles: [],
    };
  }

  // 2) 标准跨端插件清单（.nibi-plugin / .claude-plugin / .codex-plugin）
  const standardManifest = files.find((file) =>
    (STANDARD_MANIFEST_PATHS as readonly string[]).includes(file.path),
  );
  if (standardManifest) {
    let rawStandard: unknown;
    try {
      rawStandard = JSON.parse(decoder.decode(standardManifest.bytes));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: pickText(
          `${standardManifest.path} 解析失败：${detail}`,
          `Failed to parse ${standardManifest.path}: ${detail}`,
        ),
      };
    }
    if (typeof rawStandard !== "object" || rawStandard === null || Array.isArray(rawStandard)) {
      return {
        ok: false,
        reason: pickText(
          `${standardManifest.path} 必须是 JSON 对象`,
          `${standardManifest.path} must be a JSON object`,
        ),
      };
    }
    const skills = discoverSkills(files, decoder);
    const commands = discoverCommandNames(files);
    const synthesized = synthesizeHostManifestFromStandard(
      rawStandard as Record<string, unknown>,
      { skills, commandCount: commands.length },
    );
    return {
      ok: true,
      files,
      manifestText: synthesized.manifestJson,
      formatKind: "standard",
      kernelName: synthesized.kernelName,
      synthesizedFiles: [{ path: MANIFEST_FILE, content: synthesized.manifestJson }],
    };
  }

  // 3) 纯 Skill / Command ZIP（如 skills/<id>/SKILL.md、根目录 SKILL.md 或 commands/*.md）
  const rootSkill = files.find((file) => file.path === "SKILL.md");
  const skills = discoverSkills(files, decoder);
  const commands = discoverCommandNames(files);
  if (rootSkill || skills.length > 0 || commands.length > 0) {
    const outFiles = [...files];
    const effectiveSkills = [...skills];
    let pluginId = "";
    let displayName = "";
    let description: string | undefined;

    if (rootSkill && effectiveSkills.length === 0) {
      const md = decoder.decode(rootSkill.bytes);
      const fm = parseFrontmatter(md);
      const slug = slugifyId(fm.name ?? "custom-skill", "custom-skill");
      pluginId = `skill.${slug}`.slice(0, 64);
      displayName = (fm.name ?? slug).slice(0, 64);
      description = fm.description?.slice(0, 280);
      effectiveSkills.push({
        id: slug,
        name: displayName,
        ...(description ? { description } : {}),
        body: (fm.body || md).slice(0, 15_000),
      });
      // 同时放到 skills/<slug>/SKILL.md，让内核原生技能发现机制直接识别。
      outFiles.push({ path: `skills/${slug}/SKILL.md`, bytes: rootSkill.bytes });
    } else if (effectiveSkills.length > 0) {
      const first = effectiveSkills[0]!;
      pluginId = `skill.${first.id}`.slice(0, 64);
      displayName = first.name;
      description = first.description;
    } else {
      const firstCmd = commands[0]!;
      pluginId = `cmd.${firstCmd}`.slice(0, 64);
      displayName = firstCmd;
    }

    const kernelJson = `${JSON.stringify(
      {
        name: pluginId,
        ...(description ? { description } : {}),
        ...(effectiveSkills.length > 0 ? { skills: "./skills" } : {}),
        ...(commands.length > 0 ? { commands: "./commands" } : {}),
      },
      null,
      2,
    )}\n`;
    const hostManifestJson = `${JSON.stringify(
      {
        schemaVersion: 1,
        id: pluginId,
        name: displayName,
        version: "1.0.0",
        ...(description ? { description } : {}),
        caps: ["slots.v1"],
        ...(effectiveSkills.length > 0 ? { skills: effectiveSkills } : {}),
      },
      null,
      2,
    )}\n`;

    return {
      ok: true,
      files: outFiles,
      manifestText: hostManifestJson,
      formatKind: "skill-bundle",
      kernelName: pluginId,
      synthesizedFiles: [
        { path: ".nibi-plugin/plugin.json", content: kernelJson },
        { path: MANIFEST_FILE, content: hostManifestJson },
      ],
    };
  }

  return {
    ok: false,
    reason: pickText(
      "未在包内找到插件清单（支持 .nibi-plugin/.claude-plugin/.codex-plugin/plugin.json、skills/SKILL.md 或 nibi-go.plugin.json）",
      "No plugin manifest found in archive (supports .nibi-plugin/.claude-plugin/.codex-plugin/plugin.json, skills/SKILL.md, or nibi-go.plugin.json)",
    ),
  };
}
