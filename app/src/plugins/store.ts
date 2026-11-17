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

import { BUNDLED_PLUGINS, MANIFEST_FILE } from "./samples";

export interface LoadedPlugin {
  /** 插件目录名（稳定）。 */
  dir: string;
  /** 绝对目录（无 `file://`）。 */
  root: string;
  parsed: ParsedPlugin;
  /** 用户启停状态；incompatible/invalid 恒为 false。 */
  enabled: boolean;
  /** 随包内置（NIBI 官方样例）；未来用户安装的插件为 false。 */
  bundled: boolean;
  /** MCP 入口的绝对路径（没有 runtime 时为 undefined）。 */
  entryPath?: string;
}

interface PluginState {
  version: 1;
  disabled: string[];
}

const PLUGINS_DIR = "plugins";
const STATE_FILE = "nibi-plugins.json";
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

/** 首次使用时把内置插件落盘；幂等，失败的 Promise 不缓存（下次重试）。 */
async function ensurePluginFiles(): Promise<void> {
  if (!prepared) {
    prepared = (async () => {
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

/** 读全部内置插件（含 incompatible/invalid，插件中心要能解释为什么不可用）。 */
export async function loadPlugins(): Promise<LoadedPlugin[]> {
  await ensurePluginFiles();
  const disabled = await readDisabled();
  const profile = hostProfile();
  return BUNDLED_PLUGINS.map((spec) => {
    const dir = new Directory(Paths.document, PLUGINS_DIR, spec.dir);
    let parsed: ParsedPlugin;
    try {
      const input: unknown = JSON.parse(new File(dir, MANIFEST_FILE).textSync());
      parsed = readPluginManifest(input, profile, spec.dir);
    } catch (error) {
      console.warn(`[nibigo] 插件清单读取失败：${spec.dir}`, error);
      parsed = readPluginManifest(null, profile, spec.dir);
    }
    const runtime = parsed.manifest.runtime;
    const entryPath = runtime
      ? stripFileScheme(new File(dir, runtime.entry).uri)
      : undefined;
    return {
      dir: spec.dir,
      root: stripFileScheme(dir.uri),
      parsed,
      enabled: parsed.status === "ready" && !disabled.has(parsed.manifest.id),
      bundled: true,
      ...(entryPath ? { entryPath } : {}),
    };
  });
}

/** 启用/停用（按 manifest id 存；同一个 id 换目录也保持状态）。 */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
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
    servers.push({
      name: runtime.serverName,
      command: "node",
      args: [plugin.entryPath],
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
  // 在它下面找 `.nibi-plugin/plugin.json`。写父目录会让所有插件都被跳过。
  const dirs = plugins.map((plugin) => plugin.root);
  const enabledPlugins = record(section.enabledPlugins) ?? {};
  for (const plugin of plugins) {
    const id = plugin.parsed.manifest.id;
    const name = /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id) ? id : plugin.dir;
    enabledPlugins[`${name}@${KERNEL_PLUGIN_MARKETPLACE}`] = plugin.enabled;
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
  const name = /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(id) ? id : plugin.dir;
  return `${name}@${KERNEL_PLUGIN_MARKETPLACE}`;
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
