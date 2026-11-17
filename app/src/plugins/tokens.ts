// COMPOSE 里的输入 token：插件引用 / 命令 / 技能。
//
// 语义对齐 NIBI 客户端：
// - 插件 token 真正发给内核的是 `[@名字](plugin://name@inline)`，只引用插件；
// - 命令 token 真正发给内核的是 `/命令名`，由内核展开命令模板（可带 skill/MCP）；
// - 技能 token 是 ` /技能名`（前导空格避免被当成命令），内核按 `/名字` 识别 skill mention。
//
// UI 只显示彩色胶囊，不把插件提示词/大段 SKILL 文本塞进输入框。

import type {
  ComposerActionContribution,
  ComposerToolContribution,
  Effect,
} from "@nibi-go/plugin-contract";

import type { LoadedPlugin } from "./store";
import { pluginKernelId } from "./store";

export type ComposerTokenKind = "plugin" | "command" | "skill" | "mode" | "message";

export interface ComposerToken {
  /** 列表内唯一（同一个插件可选一次；命令只允许一个）。 */
  id: string;
  kind: ComposerTokenKind;
  pluginId: string;
  pluginName: string;
  /** 展示名（插件名 / 动作名 / “这条消息”）。 */
  label: string;
  /** 发送时的值：插件稳定 id / 命令名 / 技能限定名 / 消息行 key。 */
  value: string;
  accent?: string;
  icon?: string;
  /** kind=message：被引用消息的原文与角色（作为 transform 引用发送，不是注释）。 */
  messageText?: string;
  messageRole?: "user" | "assistant";
  /** kind=mode：计划模式/退出计划。 */
  mode?: "plan" | "build";
}

export interface ComposerDisplayToken {
  kind: "plugin" | "command" | "skill";
  label: string;
  pluginId?: string;
  value?: string;
}

export interface ParsedComposerText {
  tokens: ComposerDisplayToken[];
  body: string;
}

const PLUGIN_LINK = /\[@((?:\\.|[^\]])*)\]\(plugin:\/\/([A-Za-z0-9][A-Za-z0-9._@-]{0,255})\)/gu;
const COMMAND_TAGS =
  /^\s*<command-message>([\s\S]*?)<\/command-message>\s*<command-name>\/?([^<]+)<\/command-name>(?:\s*<command-args>([\s\S]*?)<\/command-args>)?/u;
const COMMAND_HEAD = /^\/([a-z0-9][a-z0-9._-]{0,63})(?:\s+|$)/u;
// 兼容旧 token（`$name`）与内核 skill mention（` /name`；命令名不含冒号，`/plugin:skill` 不会被误判成命令）。
const SKILL_HEAD = /^\s*(?:\$|\/)([A-Za-z0-9][A-Za-z0-9._:@/-]{0,127})(?:\s+|$)/u;

function escapeLabel(label: string): string {
  return label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export function pluginStableId(plugin: LoadedPlugin): string {
  return pluginKernelId(plugin);
}

export function pluginMentionMarkdown(plugin: LoadedPlugin): string {
  return `[@${escapeLabel(plugin.parsed.manifest.name)}](plugin://${pluginStableId(plugin)})`;
}

/** 从 manifest 的 token 生成一个 COMPOSE token；旧清单没有 token 时返回 null。 */
export function tokenFromContribution(
  plugin: LoadedPlugin,
  action: ComposerActionContribution | ComposerToolContribution,
): ComposerToken | null {
  const token = action.token;
  if (!token) return null;
  const manifest = plugin.parsed.manifest;
  if (token.kind === "plugin") {
    return {
      id: `plugin:${manifest.id}`,
      kind: "plugin",
      pluginId: manifest.id,
      pluginName: manifest.name,
      label: manifest.name,
      value: pluginStableId(plugin),
      ...(manifest.accent ? { accent: manifest.accent } : {}),
      ...(action.icon ? { icon: action.icon } : {}),
    };
  }
  return {
    id: `${token.kind}:${token.value}`,
    kind: token.kind,
    pluginId: manifest.id,
    pluginName: manifest.name,
    label: action.title,
    value: token.value,
    ...(manifest.accent ? { accent: manifest.accent } : {}),
    ...(action.icon ? { icon: action.icon } : {}),
  };
}

/** 胶囊列表：composer.actions + composer.tools，按插件顺序。 */
export interface CapsuleEntry {
  plugin: LoadedPlugin;
  action: ComposerActionContribution | ComposerToolContribution;
  title: string;
  icon?: string;
  token: ComposerToken | null;
  effects: readonly Effect[];
}

export function pluginCapsules(plugins: readonly LoadedPlugin[]): CapsuleEntry[] {
  return plugins.flatMap((plugin) => {
    const manifest = plugin.parsed.manifest;
    return [
      ...manifest.contributes.composerActions.map((action) => ({
        plugin,
        action,
        title: action.title,
        ...(action.icon ? { icon: action.icon } : {}),
        token: tokenFromContribution(plugin, action),
        effects: action.effects ?? [],
      })),
      ...manifest.contributes.composerTools.map((action) => ({
        plugin,
        action,
        title: action.title,
        ...(action.icon ? { icon: action.icon } : {}),
        token: tokenFromContribution(plugin, action),
        effects: action.effects ?? [],
      })),
    ];
  });
}

/** 把 token + 草稿拼成真正发给内核的正文（命令在前，插件/技能引用随后）。 */
export function composePrompt(tokens: readonly ComposerToken[], draft: string): string {
  const command = tokens.find((token) => token.kind === "command");
  const rest = tokens.filter((token) => token.kind !== "command");
  const parts: string[] = [];
  if (command) parts.push(`/${command.value}`);
  for (const token of rest) {
    if (token.kind === "plugin") parts.push(`[@${escapeLabel(token.pluginName)}](plugin://${token.value})`);
    else if (token.kind === "skill") parts.push(` /${token.value}`);
  }
  const body = draft.trim();
  if (body) parts.push(body);
  return parts.join(" ");
}

function displayTokenForPlugin(
  plugins: readonly LoadedPlugin[],
  pluginId: string,
  label: string,
): ComposerDisplayToken {
  const plugin = plugins.find(
    (candidate) =>
      candidate.parsed.manifest.id === pluginId ||
      pluginStableId(candidate) === pluginId,
  );
  return {
    kind: "plugin",
    label,
    ...(plugin ? { pluginId: plugin.parsed.manifest.id } : {}),
  };
}

function commandLabel(
  plugins: readonly LoadedPlugin[],
  command: string,
): { label: string; pluginId?: string } {
  for (const plugin of plugins) {
    const manifest = plugin.parsed.manifest;
    const actions = [
      ...manifest.contributes.composerActions,
      ...manifest.contributes.composerTools,
    ];
    for (const action of actions) {
      if (action.token?.kind === "command" && action.token.value === command) {
        return { label: action.title, pluginId: manifest.id };
      }
    }
    for (const action of manifest.contributes.messageActions) {
      if (action.command === command) {
        return { label: action.title, pluginId: manifest.id };
      }
    }
  }
  return { label: `/${command}` };
}

/**
 * 回显解析：把用户行/乐观气泡里的插件链接、命令、技能 token 拆出来。
 * 返回的 body 是用户真正输入的文字；token 由 UI 画成彩色胶囊。
 */
export function parseComposerText(
  text: string,
  plugins: readonly LoadedPlugin[] = [],
): ParsedComposerText {
  const tokens: ComposerDisplayToken[] = [];
  let rest = text;
  // 内核展开命令后，用户行正文是 `<command-message>…</command-message>` 标签；
  // 回显时只画命令胶囊，不把内部标签漏给用户。
  const tags = COMMAND_TAGS.exec(rest);
  if (tags?.[2]) {
    const name = tags[2].trim();
    const found = commandLabel(plugins, name);
    tokens.push({
      kind: "command",
      label: found.label,
      value: name,
      ...(found.pluginId ? { pluginId: found.pluginId } : {}),
    });
    rest = (tags[3] ?? "").trim();
  } else {
    const commandMatch = COMMAND_HEAD.exec(rest);
    if (commandMatch?.[1]) {
      const command = commandMatch[1];
      const found = commandLabel(plugins, command);
      tokens.push({
        kind: "command",
        label: found.label,
        value: command,
        ...(found.pluginId ? { pluginId: found.pluginId } : {}),
      });
      rest = rest.slice(commandMatch[0].length);
    } else {
      const skillMatch = SKILL_HEAD.exec(rest);
      if (skillMatch?.[1]) {
        tokens.push({ kind: "skill", label: skillMatch[1], value: skillMatch[1] });
        rest = rest.slice(skillMatch[0].length);
      }
    }
  }
  const matches: Array<{ index: number; length: number; token: ComposerDisplayToken }> = [];
  PLUGIN_LINK.lastIndex = 0;
  for (const match of rest.matchAll(PLUGIN_LINK)) {
    const label = (match[1] ?? "").replaceAll("\\]", "]").replaceAll("\\[", "[").replaceAll("\\\\", "\\");
    const stableId = match[2] ?? "";
    if (!stableId) continue;
    const pluginId = stableId.split("@")[0] ?? stableId;
    matches.push({
      index: match.index ?? 0,
      length: match[0].length,
      token: displayTokenForPlugin(plugins, pluginId, label),
    });
  }
  if (matches.length > 0) {
    let body = "";
    let cursor = 0;
    for (const match of matches) {
      body += rest.slice(cursor, match.index);
      cursor = match.index + match.length;
      tokens.push(match.token);
    }
    body += rest.slice(cursor);
    rest = body;
  }
  return { tokens, body: rest.trim() };
}