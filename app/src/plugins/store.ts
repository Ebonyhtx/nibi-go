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
  /** MCP 入口的绝对路径（没有 runtime 时为 undefined）。 */
  entryPath?: string;
}

interface PluginState {
  version: 1;
  disabled: string[];
}

const PLUGINS_DIR = "plugins";
const STATE_FILE = "nibi-plugins.json";

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//u, "");
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

/** 新会话/恢复会话前调用：确保插件文件存在，返回当前应带上的 MCP 配置。 */
export async function loadPluginMcpServers(): Promise<KernelMcpServer[]> {
  return pluginMcpServers(await loadPlugins());
}
