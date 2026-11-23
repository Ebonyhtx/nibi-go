// 内置插件宿主：把样例插件的清单/入口写到 App 私有目录，读启停状态，生成会话的 MCP 配置。
//
// 文件布局：
//   filesDir/plugins/<dir>/nibi-go.plugin.json   清单
//   filesDir/plugins/<dir>/server.mjs            可选 MCP 入口
//   filesDir/nibi-plugins.json                   启停状态（只存 disabled id）
//
// 插件目录不存凭据；MCP 子进程拿的是内核的环境白名单（不含 provider key）。

import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";

import {
  APP_CAPABILITIES,
  readPluginManifest,
  type HostProfile,
  type ParsedPlugin,
} from "@nibi-go/plugin-contract";
import type { KernelMcpServer } from "@nibi-go/kernel-session";

import { pickText } from "../i18n";
import { BUNDLED_PLUGINS, MANIFEST_FILE, RETIRED_SAMPLE_DIRS } from "./samples";
import { ensureLicenseLoaded, pluginLicenseDecision } from "./license";
import { scanNpmPackageEnvSpecs } from "./npmEnvScan";
import {
  inferNpmPackageFromEntry,
  isBlockedPluginEnvName,
  PLUGIN_ENV_NAME_RE,
  resolvePluginMcpEnv,
  validatePluginEnvName,
} from "./npmRegistry";
import {
  STANDARD_MANIFEST_PATHS,
  synthesizeHostManifestFromStandard,
} from "./packageFiles";
import { paidPluginIds } from "./paid";

export interface LoadedPluginSourceMeta {
  kind: "nibi-go" | "standard" | "skill-bundle" | "npm";
  kernelName?: string;
  npmPackage?: string;
  npmVersion?: string;
  integrity?: string;
  registry?: string;
  origin?: "market" | "personal" | "npm-search" | "local-zip";
  installedAt?: string;
}

export interface LoadedPlugin {
  /** 插件目录名（稳定）。 */
  dir: string;
  /** 绝对目录（无 `file://`）。 */
  root: string;
  parsed: ParsedPlugin;
  /** 用户启停状态；incompatible/invalid 恒为 false。 */
  enabled: boolean;
  /** 随包内置（NIBI 官方套件）；市场或个人安装为 false。 */
  bundled: boolean;
  /** 内核标准清单里的名称（用于精确匹配 `enabledPlugins["<kernelName>@inline"]`）。 */
  kernelName?: string;
  /** 安装来源元数据（npm / standard / skill-bundle / nibi-go）。 */
  sourceMeta?: LoadedPluginSourceMeta;
  /** 付费插件缺少授权时的原因（有值即视为不可启用）。 */
  licenseBlocked?: string;
  /** MCP 入口的绝对路径（没有 runtime 时为 undefined）。 */
  entryPath?: string;
  /** 生效的设置值（清单默认值 + 用户保存值；已按类型收敛）。 */
  settings: Record<string, string | boolean>;
  /** 用户为该插件保存的自定义环境变量（存于 nibi-plugin-env.json；仅注入 MCP 子进程）。 */
  customEnv: Record<string, string>;
  /** 对清单尚未声明 envMap 的已安装 npm MCP，自动探测到的环境变量名列表（支持免重装补配）。 */
  detectedEnvVars?: readonly string[];
}

interface PluginState {
  version: 1;
  disabled: string[];
}

/** 插件设置：`{ "<manifest id>": { "<setting id>": value } }`；只存用户改过的值。 */
interface PluginSettingsState {
  version: 1;
  plugins: Record<string, Record<string, unknown>>;
}

/** 插件自定义环境变量：`{ "<manifest id>": { "<ENV_NAME>": "<value>" } }`。 */
interface PluginEnvState {
  version: 1;
  plugins: Record<string, Record<string, string>>;
}

const PLUGINS_DIR = "plugins";
const STATE_FILE = "nibi-plugins.json";
const SETTINGS_FILE = "nibi-plugin-settings.json";
const ENV_FILE = "nibi-plugin-env.json";
const KERNEL_MANIFEST_DIR = ".nibi-plugin";
const KERNEL_COMMANDS_DIR = "commands";
const KERNEL_SKILLS_DIR = "skills";
const KERNEL_CONFIG_DIR = ".nibi/cli";
const KERNEL_CONFIG_FILE = "config.json";
const KERNEL_PLUGIN_MARKETPLACE = "inline";

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//u, "");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 内核插件名：小写字母/数字/._-，来自 UI 清单 id（GO 样例本来就是这种形状）。 */
function kernelPluginName(manifest: Record<string, unknown>, fallback: string): string {
  const id = text(manifest.id);
  return /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id) ? id : fallback;
}

interface KernelCommand {
  name: string;
  title: string;
  prompt: string;
  skills: string[];
}

/** 从 composer.actions / composer.tools 的 command token 生成内核命令文件。 */
function kernelCommands(manifest: Record<string, unknown>): KernelCommand[] {
  const contributes = record(manifest.contributes);
  if (!contributes) return [];
  const commands: KernelCommand[] = [];
  const seen = new Set<string>();
  for (const key of ["composer.actions", "composer.tools", "message.actions"] as const) {
    const items = contributes[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const action = record(item);
      if (!action) continue;
      const token = record(action.token);
      const name =
        key === "message.actions"
          ? text(action.command)
          : token?.kind === "command"
            ? text(token.value)
            : "";
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(name) || seen.has(name)) continue;
      const prompt = text(action.prompt);
      if (!prompt) continue;
      seen.add(name);
      const skills = Array.isArray(action.skills)
        ? action.skills
            .map((value) => text(value))
            .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(value))
        : [];
      commands.push({
        name,
        title: text(action.title) || name,
        prompt,
        skills,
      });
    }
  }
  return commands;
}

interface KernelSkill {
  id: string;
  name: string;
  description: string;
  body: string;
}

function kernelSkills(manifest: Record<string, unknown>): KernelSkill[] {
  if (!Array.isArray(manifest.skills)) return [];
  const skills: KernelSkill[] = [];
  const seen = new Set<string>();
  for (const item of manifest.skills) {
    const skill = record(item);
    if (!skill) continue;
    const id = text(skill.id);
    const body = text(skill.body);
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id) || seen.has(id) || !body) continue;
    seen.add(id);
    skills.push({
      id,
      name: text(skill.name) || id,
      description: text(skill.description),
      body,
    });
  }
  return skills;
}

function commandFile(command: KernelCommand): string {
  const frontmatter = [
    "---",
    `description: ${JSON.stringify(command.title)}`,
    'argument-hint: "[补充说明]"',
    ...(command.skills.length > 0 ? [`skills: [${command.skills.join(", ")}]`] : []),
    "---",
  ];
  return `${frontmatter.join("\n")}\n${command.prompt}\n`;
}

function skillFile(skill: KernelSkill): string {
  const frontmatter = [
    "---",
    `name: ${JSON.stringify(skill.name)}`,
    ...(skill.description ? [`description: ${JSON.stringify(skill.description)}`] : []),
    "---",
  ];
  return `${frontmatter.join("\n")}\n${skill.body}\n`;
}

/** 内核标准插件清单（`.nibi-plugin/plugin.json`）：只声明命令与技能；MCP 仍由会话配置带入。 */
function kernelManifest(manifest: Record<string, unknown>, fallbackName: string): string {
  const name = kernelPluginName(manifest, fallbackName);
  const commands = kernelCommands(manifest);
  const skills = kernelSkills(manifest);
  const body = {
    name,
    ...(text(manifest.description) ? { description: text(manifest.description) } : {}),
    ...(commands.length > 0 ? { commands: `./${KERNEL_COMMANDS_DIR}` } : {}),
    ...(skills.length > 0 ? { skills: `./${KERNEL_SKILLS_DIR}` } : {}),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** 从一份 `nibi-go.plugin.json` 生成内核可发现的 `.nibi-plugin/plugin.json`、commands 与 skills 文件。 */
export function synthesizeKernelFilesForManifest(
  manifest: Record<string, unknown>,
  fallbackName: string,
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [
    { path: `${KERNEL_MANIFEST_DIR}/plugin.json`, content: kernelManifest(manifest, fallbackName) },
  ];
  for (const command of kernelCommands(manifest)) {
    files.push({ path: `${KERNEL_COMMANDS_DIR}/${command.name}.md`, content: commandFile(command) });
  }
  for (const skill of kernelSkills(manifest)) {
    files.push({ path: `${KERNEL_SKILLS_DIR}/${skill.id}/SKILL.md`, content: skillFile(skill) });
  }
  return files;
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

export function hostProfile(): HostProfile {
  return { appVersion: appVersion(), caps: APP_CAPABILITIES, host: "local" };
}

let prepared: Promise<void> | null = null;

async function writeIfChanged(file: File, content: string): Promise<void> {
  if (file.exists) {
    try {
      if ((await file.text()) === content) return;
    } catch {
      // 读不出来就覆盖写。
    }
  }
  await file.write(content);
}

/** 首次使用时把内置插件落盘，并清理已退役的旧版示例插件目录；幂等。 */
async function ensurePluginFiles(): Promise<void> {
  if (!prepared) {
    prepared = (async () => {
      for (const retired of RETIRED_SAMPLE_DIRS) {
        try {
          const oldDir = new Directory(Paths.document, PLUGINS_DIR, retired);
          if (oldDir.exists) oldDir.delete();
        } catch {
          // 清理失败不阻断启动。
        }
      }
      for (const plugin of BUNDLED_PLUGINS) {
        const dir = new Directory(Paths.document, PLUGINS_DIR, plugin.dir);
        dir.create({ intermediates: true, idempotent: true });
        await writeIfChanged(
          new File(dir, MANIFEST_FILE),
          `${JSON.stringify(plugin.manifest, null, 2)}\n`,
        );
        for (const [name, content] of Object.entries(plugin.files)) {
          await writeIfChanged(new File(dir, name), content);
        }

        // 内核标准插件面：命令与技能按 NIBI 插件格式落盘，内核在回合里展开。
        const kernelDir = new Directory(dir, KERNEL_MANIFEST_DIR);
        kernelDir.create({ intermediates: true, idempotent: true });
        await writeIfChanged(
          new File(kernelDir, "plugin.json"),
          kernelManifest(plugin.manifest, plugin.dir),
        );
        const commandsDir = new Directory(dir, KERNEL_COMMANDS_DIR);
        commandsDir.create({ intermediates: true, idempotent: true });
        for (const command of kernelCommands(plugin.manifest)) {
          await writeIfChanged(new File(commandsDir, `${command.name}.md`), commandFile(command));
        }
        const skillsDir = new Directory(dir, KERNEL_SKILLS_DIR);
        skillsDir.create({ intermediates: true, idempotent: true });
        for (const skill of kernelSkills(plugin.manifest)) {
          const skillDir = new Directory(skillsDir, skill.id);
          skillDir.create({ intermediates: true, idempotent: true });
          await writeIfChanged(new File(skillDir, "SKILL.md"), skillFile(skill));
        }
      }
    })().catch((error: unknown) => {
      prepared = null;
      throw error;
    });
  }
  return prepared;
}

function stateFile(): File {
  return new File(Paths.document, STATE_FILE);
}

async function readDisabled(): Promise<Set<string>> {
  try {
    const file = stateFile();
    if (!file.exists) return new Set();
    const parsed = JSON.parse(await file.text()) as PluginState | null;
    return new Set(
      Array.isArray(parsed?.disabled)
        ? parsed.disabled.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [],
    );
  } catch (error) {
    console.warn("[nibigo] 读取插件状态失败", error);
    return new Set();
  }
}

async function writeDisabled(disabled: Set<string>): Promise<void> {
  await stateFile().write(
    `${JSON.stringify({ version: 1, disabled: [...disabled].sort() }, null, 2)}\n`,
  );
}

function settingsFile(): File {
  return new File(Paths.document, SETTINGS_FILE);
}

async function readSettings(): Promise<Record<string, Record<string, unknown>>> {
  try {
    const file = settingsFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(await file.text()) as PluginSettingsState | null;
    const plugins = record(parsed?.plugins) ?? {};
    const result: Record<string, Record<string, unknown>> = {};
    for (const [id, values] of Object.entries(plugins)) {
      const entry = record(values);
      if (entry) result[id] = entry;
    }
    return result;
  } catch (error) {
    console.warn("[nibigo] 读取插件设置失败", error);
    return {};
  }
}

async function writeSettings(plugins: Record<string, Record<string, unknown>>): Promise<void> {
  await settingsFile().write(
    `${JSON.stringify({ version: 1, plugins }, null, 2)}\n`,
  );
}

/** 生效值：清单默认值被用户保存值覆盖，并收敛到声明类型（坏值退回默认）。 */
function effectiveSettings(
  manifest: ParsedPlugin["manifest"],
  stored: Record<string, unknown> | undefined,
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const setting of manifest.settings ?? []) {
    const raw = stored?.[setting.id];
    if (setting.type === "toggle") {
      values[setting.id] =
        typeof raw === "boolean" ? raw : (setting.default ?? false);
      continue;
    }
    if (setting.type === "text") {
      values[setting.id] =
        typeof raw === "string"
          ? raw.slice(0, setting.maxLength ?? 256)
          : (setting.default ?? "");
      continue;
    }
    const allowed = setting.options.some((option) => option.value === raw);
    values[setting.id] =
      typeof raw === "string" && allowed
        ? raw
        : (setting.default ?? setting.options[0]?.value ?? "");
  }
  return values;
}

/** 保存一项设置（按 manifest id 存）；未知插件的写入忽略。 */
export async function setPluginSetting(
  id: string,
  key: string,
  value: string | boolean,
): Promise<void> {
  const plugins = await readSettings();
  plugins[id] = { ...(plugins[id] ?? {}), [key]: value };
  await writeSettings(plugins);
}

function envFile(): File {
  return new File(Paths.document, ENV_FILE);
}

const MAX_ENV_VALUE_LENGTH = 4096;

async function readCustomEnvs(): Promise<Record<string, Record<string, string>>> {
  try {
    const file = envFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(await file.text()) as PluginEnvState | null;
    const plugins = record(parsed?.plugins) ?? {};
    const result: Record<string, Record<string, string>> = {};
    for (const [id, rawEntry] of Object.entries(plugins)) {
      const entry = record(rawEntry);
      if (!entry) continue;
      const clean: Record<string, string> = {};
      for (const [name, val] of Object.entries(entry)) {
        if (!PLUGIN_ENV_NAME_RE.test(name) || isBlockedPluginEnvName(name)) continue;
        if (typeof val !== "string") continue;
        const trimmed = val.trim();
        if (trimmed.length > 0 && !trimmed.includes("\0")) {
          clean[name] = trimmed.slice(0, MAX_ENV_VALUE_LENGTH);
        }
      }
      if (Object.keys(clean).length > 0) result[id] = clean;
    }
    return result;
  } catch (error) {
    console.warn("[nibigo] 读取插件环境变量失败", error);
    return {};
  }
}

async function writeCustomEnvs(
  plugins: Record<string, Record<string, string>>,
): Promise<void> {
  await envFile().write(`${JSON.stringify({ version: 1, plugins }, null, 2)}\n`);
}

/** 新增或更新某插件的一项自定义环境变量（按 manifest id 存；空值视为删除）。 */
export async function setPluginEnvVar(
  id: string,
  rawName: string,
  rawValue: string,
): Promise<void> {
  const validated = validatePluginEnvName(rawName);
  if (!validated.ok) throw new Error(validated.reason);
  const trimmed = rawValue.trim();
  if (trimmed.includes("\0")) {
    throw new Error(
      pickText("环境变量值包含非法字符", "Environment variable value contains invalid characters"),
    );
  }
  const plugins = await readCustomEnvs();
  const nextForPlugin = { ...(plugins[id] ?? {}) };
  if (trimmed.length === 0) {
    delete nextForPlugin[validated.name];
  } else {
    nextForPlugin[validated.name] = trimmed.slice(0, MAX_ENV_VALUE_LENGTH);
  }
  if (Object.keys(nextForPlugin).length === 0) {
    delete plugins[id];
  } else {
    plugins[id] = nextForPlugin;
  }
  await writeCustomEnvs(plugins);
}

/** 删除某插件的一项自定义环境变量。 */
export async function deletePluginEnvVar(id: string, name: string): Promise<void> {
  const plugins = await readCustomEnvs();
  const current = plugins[id];
  if (!current || !(name in current)) return;
  const nextForPlugin = { ...current };
  delete nextForPlugin[name];
  if (Object.keys(nextForPlugin).length === 0) {
    delete plugins[id];
  } else {
    plugins[id] = nextForPlugin;
  }
  await writeCustomEnvs(plugins);
}

const detectedEnvCache = new Map<string, readonly string[]>();

function detectInstalledNpmEnvVars(
  dir: Directory,
  pluginDir: string,
  sourceMeta: LoadedPluginSourceMeta | undefined,
  manifest: ParsedPlugin["manifest"],
): readonly string[] | undefined {
  const runtime = manifest.runtime;
  if (sourceMeta?.kind !== "npm" || !sourceMeta.npmPackage || runtime?.type !== "mcp") {
    return undefined;
  }
  // 清单已经自带 envMap 时无需重复扫描（安装阶段已完成探测）。
  if (runtime.envMap && Object.keys(runtime.envMap).length > 0) return undefined;
  const cacheKey = `${pluginDir}|${sourceMeta.npmPackage}|${sourceMeta.installedAt ?? manifest.version}`;
  const cached = detectedEnvCache.get(cacheKey);
  if (cached) return cached.length > 0 ? cached : undefined;
  try {
    const names = scanNpmPackageEnvSpecs(dir, sourceMeta.npmPackage, {
      pluginEntry: runtime.entry,
    }).map((item) => item.name);
    detectedEnvCache.set(cacheKey, names);
    return names.length > 0 ? names : undefined;
  } catch {
    return undefined;
  }
}

/** 插件目录清单：内置按 samples 顺序在前，市场安装的按目录名排在后面。 */
function pluginDirs(): Array<{ dir: string; bundled: boolean }> {
  const root = new Directory(Paths.document, PLUGINS_DIR);
  const present = new Set<string>();
  try {
    for (const item of root.list()) {
      if (item instanceof Directory && !item.name.startsWith(".")) present.add(item.name);
    }
  } catch {
    // 目录还不存在：下面按内置清单兜底。
  }
  const bundled = BUNDLED_PLUGINS.filter((spec) => present.size === 0 || present.has(spec.dir)).map(
    (spec) => ({ dir: spec.dir, bundled: true }),
  );
  const bundledDirs = new Set(bundled.map((entry) => entry.dir));
  const installed = [...present]
    .filter((dir) => !bundledDirs.has(dir))
    .sort()
    .map((dir) => ({ dir, bundled: false }));
  return [...bundled, ...installed];
}

const SOURCE_META_FILE = ".nibi-go-source.json";

function readStandardManifestFromDir(dir: Directory): Record<string, unknown> | null {
  for (const rel of STANDARD_MANIFEST_PATHS) {
    try {
      const file = new File(dir, rel);
      if (!file.exists) continue;
      const parsed: unknown = JSON.parse(file.textSync());
      const obj = record(parsed);
      if (obj) return obj;
    } catch {
      // 继续尝试下一个标准清单路径
    }
  }
  return null;
}

function readSourceMetaFromDir(dir: Directory): LoadedPluginSourceMeta | undefined {
  try {
    const file = new File(dir, SOURCE_META_FILE);
    if (!file.exists) return undefined;
    const obj = record(JSON.parse(file.textSync()));
    if (!obj || typeof obj.kind !== "string") return undefined;
    return obj as unknown as LoadedPluginSourceMeta;
  } catch {
    return undefined;
  }
}

/** 读全部插件（内置 + 市场/个人安装；含标准 .nibi-plugin/.claude-plugin/.codex-plugin 目录）。 */
export async function loadPlugins(): Promise<LoadedPlugin[]> {
  await ensurePluginFiles();
  const disabled = await readDisabled();
  const stored = await readSettings();
  const storedEnvs = await readCustomEnvs();
  const profile = hostProfile();
  await ensureLicenseLoaded();
  const paid = await paidPluginIds();
  return pluginDirs().map(({ dir: pluginDir, bundled }) => {
    const dir = new Directory(Paths.document, PLUGINS_DIR, pluginDir);
    const standardRaw = readStandardManifestFromDir(dir);
    const sourceMeta = readSourceMetaFromDir(dir);
    let parsed: ParsedPlugin;
    let kernelName: string | undefined =
      (typeof standardRaw?.name === "string" && standardRaw.name.trim()) ||
      sourceMeta?.kernelName ||
      undefined;
    try {
      const goFile = new File(dir, MANIFEST_FILE);
      if (goFile.exists) {
        const input: unknown = JSON.parse(goFile.textSync());
        parsed = readPluginManifest(input, profile, pluginDir);
      } else if (standardRaw) {
        // 标准跨端插件目录无 nibi-go.plugin.json 时，按需合成宿主展示清单，不拒绝加载。
        const synth = synthesizeHostManifestFromStandard(standardRaw, { fallbackId: pluginDir });
        kernelName = synth.kernelName;
        parsed = readPluginManifest(JSON.parse(synth.manifestJson), profile, pluginDir);
      } else {
        parsed = readPluginManifest(null, profile, pluginDir);
      }
    } catch (error) {
      console.warn(`[nibigo] 插件清单读取失败：${pluginDir}`, error);
      parsed = readPluginManifest(null, profile, pluginDir);
    }
    const runtime = parsed.manifest.runtime;
    const inferredNpmPackage =
      !sourceMeta && runtime?.type === "mcp"
        ? inferNpmPackageFromEntry(runtime.entry)
        : undefined;
    const effectiveSourceMeta: LoadedPluginSourceMeta | undefined =
      sourceMeta ?? (inferredNpmPackage ? { kind: "npm", npmPackage: inferredNpmPackage } : undefined);
    const entryPath = runtime
      ? stripFileScheme(new File(dir, runtime.entry).uri)
      : undefined;
    const manifestId = parsed.manifest.id;
    const license = paid.has(manifestId) ? pluginLicenseDecision(manifestId) : null;
    const licenseBlocked = license && !license.allowed ? license.reason : undefined;
    const detectedEnvVars = detectInstalledNpmEnvVars(
      dir,
      pluginDir,
      effectiveSourceMeta,
      parsed.manifest,
    );
    return {
      dir: pluginDir,
      root: stripFileScheme(dir.uri),
      parsed,
      enabled: parsed.status === "ready" && !disabled.has(manifestId) && !licenseBlocked,
      bundled,
      ...(kernelName ? { kernelName } : {}),
      ...(effectiveSourceMeta ? { sourceMeta: effectiveSourceMeta } : {}),
      settings: effectiveSettings(parsed.manifest, stored[manifestId]),
      customEnv: storedEnvs[manifestId] ?? {},
      ...(detectedEnvVars ? { detectedEnvVars } : {}),
      ...(entryPath ? { entryPath } : {}),
      ...(licenseBlocked ? { licenseBlocked } : {}),
    };
  });
}

/** 启用/停用（按 manifest id 存；同一个 id 换目录也保持状态）。 */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await ensureLicenseLoaded();
    const paid = await paidPluginIds();
    if (paid.has(id)) {
      const decision = pluginLicenseDecision(id);
      if (!decision.allowed) throw new Error(decision.reason);
    }
  }
  const disabled = await readDisabled();
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  await writeDisabled(disabled);
}

/** 已启用且可用的插件。 */
export function enabledPlugins(plugins: readonly LoadedPlugin[]): LoadedPlugin[] {
  return plugins.filter((plugin) => plugin.enabled && plugin.parsed.slotsAvailable);
}

/** 会话的 MCP 配置：只取已启用、有 runtime 的插件；同名服务器只保留第一个。 */
export function pluginMcpServers(plugins: readonly LoadedPlugin[]): KernelMcpServer[] {
  const seen = new Set<string>();
  const servers: KernelMcpServer[] = [];
  for (const plugin of enabledPlugins(plugins)) {
    const runtime = plugin.parsed.manifest.runtime;
    if (!runtime || !plugin.entryPath || seen.has(runtime.serverName)) continue;
    seen.add(runtime.serverName);
    const env = resolvePluginMcpEnv({
      settings: plugin.settings,
      envMap: runtime.envMap,
      customEnv: plugin.customEnv,
    });
    servers.push({
      name: runtime.serverName,
      command: "node",
      args: [plugin.entryPath, ...(runtime.args ?? [])],
      ...(env.length > 0 ? { env } : {}),
      alwaysLoad: runtime.alwaysLoad ?? true,
      ...(runtime.timeoutMs === undefined ? {} : { timeoutMs: runtime.timeoutMs }),
    });
  }
  return servers;
}

/** 把插件根与启停态写进内核用户配置（`~/.nibi/cli/config.json` 的 `plugins` 段）。 */
export async function syncKernelPluginConfig(
  plugins: readonly LoadedPlugin[],
): Promise<void> {
  const configDir = new Directory(Paths.document, KERNEL_CONFIG_DIR);
  configDir.create({ intermediates: true, idempotent: true });
  const file = new File(configDir, KERNEL_CONFIG_FILE);
  let current: Record<string, unknown> = {};
  if (file.exists) {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const value = record(parsed);
      if (value) current = value;
    } catch {
      // 坏配置按空对象重写：内核本身也会忽略坏文件。
    }
  }
  const section = record(current.plugins) ?? {};
  // `plugins.dirs` 是**插件目录本身**的列表，不是父目录：内核把每一项当候选，
  // 在它下面找 `.nibi-plugin/.claude-plugin/.codex-plugin/plugin.json`。
  const dirs = plugins.map((plugin) => plugin.root);
  const enabledPlugins = record(section.enabledPlugins) ?? {};
  for (const plugin of plugins) {
    const id = plugin.parsed.manifest.id;
    const fallbackName = /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id) ? id : plugin.dir;
    const kName = plugin.kernelName ?? fallbackName;
    enabledPlugins[`${kName}@${KERNEL_PLUGIN_MARKETPLACE}`] = plugin.enabled;
  }
  const next = {
    ...current,
    plugins: {
      ...section,
      enabled: true,
      dirs,
      enabledPlugins,
    },
  };
  await writeIfChanged(file, `${JSON.stringify(next, null, 2)}\n`);
}

/** 新会话/恢复会话前调用：确保插件文件存在，返回当前应带上的 MCP 配置。 */
export async function loadPluginMcpServers(): Promise<KernelMcpServer[]> {
  const plugins = await loadPlugins();
  await syncKernelPluginConfig(plugins);
  return pluginMcpServers(plugins);
}

/** 插件在模型语境里的能力声明（`<plugin_reference>` 的 identifiers-only 载荷）。 */
export interface PluginCapability {
  /** 稳定身份：`<插件名>@inline`。 */
  id: string;
  name: string;
  skills: string[];
  mcpServers: string[];
  commands: string[];
}

export function pluginKernelId(plugin: LoadedPlugin): string {
  const id = plugin.parsed.manifest.id;
  const fallbackName = /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id) ? id : plugin.dir;
  return `${plugin.kernelName ?? fallbackName}@${KERNEL_PLUGIN_MARKETPLACE}`;
}

export function pluginCapability(plugin: LoadedPlugin): PluginCapability {
  const manifest = plugin.parsed.manifest;
  const name = pluginKernelId(plugin).split("@")[0] ?? plugin.dir;
  const commands = new Set<string>();
  for (const action of [
    ...manifest.contributes.composerActions,
    ...manifest.contributes.composerTools,
  ]) {
    if (action.token?.kind === "command") commands.add(action.token.value);
  }
  for (const action of manifest.contributes.messageActions) {
    if (action.command) commands.add(action.command);
  }
  return {
    id: pluginKernelId(plugin),
    name: manifest.name,
    skills: (manifest.skills ?? []).map((skill) => `${name}:${skill.id}`),
    mcpServers: manifest.runtime ? [manifest.runtime.serverName] : [],
    commands: [...commands].sort(),
  };
}

/** 已启用插件的引用载荷；停用/不可用插件不会被模型看到。 */
export function enabledPluginCapabilities(
  plugins: readonly LoadedPlugin[],
): PluginCapability[] {
  return enabledPlugins(plugins).map(pluginCapability);
}
