// COMPOSE 的统一动作目录：附件、NIBI 原生命令、插件命令、插件引用、技能、消息动作。
//
// 这里只做“目录/默认值/分组”，不做持久化；设置页和首页共用同一份 id，
// 避免设置页与 COMPOSE 各自维护一套动作导致语义漂移。

import type { IconName } from "../components/Icon";
import { pickText } from "../i18n";
import {
  pluginActionTitle,
  pluginDisplayName,
  pluginSkillDescription,
  pluginSkillName,
} from "../plugins/builtinI18n";
import type { LoadedPlugin } from "../plugins/store";

export type ComposerGroup =
  | "attachment"
  | "native-command"
  | "plugin-command"
  | "plugin"
  | "skill"
  | "message";

export type ComposerSource = "nibi" | "plugin";

export type ComposerActionToken =
  | { kind: "attachment"; value: "image" | "file" }
  | { kind: "command"; value: string }
  | { kind: "skill"; value: string }
  | { kind: "plugin"; value: string }
  | { kind: "mode"; value: "plan" | "build" };

export interface ComposerCatalogItem {
  /** 稳定 id；设置持久化只认它。 */
  id: string;
  group: ComposerGroup;
  /** NIBI 原生/官方在前，用户或第三方插件在后。 */
  source: ComposerSource;
  title: string;
  detail?: string;
  icon?: IconName;
  accent?: string;
  pluginId?: string;
  /** 所属插件的人类可读名称（用于长按菜单来源标注与按插件分组）。 */
  pluginName?: string;
  /** 插件是否随包内置（用于“NIBI 插件”/“用户插件”分组）。 */
  bundled?: boolean;
  token: ComposerActionToken;
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  /** 展示名；插件清单里的中文名与内核的稳定 id 分开。 */
  title?: string;
  description?: string;
  path?: string;
  scope?: "workspace" | "user" | "plugin";
  pluginName?: string;
  enabled?: boolean;
}

/** 插件技能在内核里可能带 `plugin:` 前缀；展示与发送都只认一次前缀。 */
function bareSkillName(skill: SkillCatalogEntry): string {
  const plugin = skill.pluginName;
  if (plugin && skill.name.startsWith(`${plugin}:`)) {
    return skill.name.slice(plugin.length + 1);
  }
  return skill.name;
}

function skillIdentity(skill: SkillCatalogEntry): string {
  return `${skill.pluginName ?? ""}:${bareSkillName(skill)}`;
}

export const PLUS_GROUPS: ReadonlyArray<{
  group: Exclude<ComposerGroup, "message">;
  title: string;
  titleEn: string;
}> = [
  { group: "attachment", title: "添加附件", titleEn: "Attachments" },
  { group: "native-command", title: "NIBI 命令", titleEn: "NIBI commands" },
  { group: "plugin-command", title: "插件命令", titleEn: "Plugin commands" },
  { group: "plugin", title: "插件", titleEn: "Plugins" },
  { group: "skill", title: "技能", titleEn: "Skills" },
];

function nativeCommands(): ComposerCatalogItem[] {
  return [
    {
      id: "native:compact",
      group: "native-command",
      source: "nibi",
      title: pickText("压缩", "Compact"),
      detail: pickText("压缩当前对话的上下文", "Compact context for this chat"),
      icon: "archive",
      token: { kind: "command", value: "compact" },
    },
    {
      id: "native:goal",
      group: "native-command",
      source: "nibi",
      title: pickText("目标", "Goal"),
      detail: pickText("查看或设定本次目标", "View or set the current goal"),
      icon: "shield",
      token: { kind: "command", value: "goal" },
    },
    {
      id: "native:plan",
      group: "native-command",
      source: "nibi",
      title: pickText("计划模式", "Plan mode"),
      detail: pickText("先出计划再执行", "Draft a plan before acting"),
      icon: "doc",
      token: { kind: "mode", value: "plan" },
    },
    {
      id: "native:build",
      group: "native-command",
      source: "nibi",
      title: pickText("退出计划", "Exit plan"),
      detail: pickText("关闭计划模式", "Turn off Plan mode"),
      icon: "pen",
      token: { kind: "mode", value: "build" },
    },
    {
      id: "native:init",
      group: "native-command",
      source: "nibi",
      title: pickText("初始化", "Init"),
      detail: pickText("创建或更新工作区说明", "Create or update workspace instructions"),
      icon: "sparkles",
      token: { kind: "command", value: "init" },
    },
  ];
}

function attachments(): ComposerCatalogItem[] {
  return [
    {
      id: "attachment:image",
      group: "attachment",
      source: "nibi",
      title: pickText("图片", "Image"),
      detail: pickText("从相册选择图片", "Choose from photo library"),
      icon: "image",
      token: { kind: "attachment", value: "image" },
    },
    {
      id: "attachment:file",
      group: "attachment",
      source: "nibi",
      title: pickText("文件", "File"),
      detail: pickText("选择任意文件", "Choose any file"),
      icon: "doc",
      token: { kind: "attachment", value: "file" },
    },
  ];
}

function pluginSource(plugin: LoadedPlugin): ComposerSource {
  return plugin.bundled ? "nibi" : "plugin";
}

function pluginCommands(plugin: LoadedPlugin): ComposerCatalogItem[] {
  const manifest = plugin.parsed.manifest;
  const displayName = pluginDisplayName(manifest.id, manifest.name);
  const actions = [
    ...manifest.contributes.composerActions,
    ...manifest.contributes.composerTools,
  ];
  return actions.flatMap((action) => {
    if (action.token?.kind !== "command") return [];
    return [
      {
        id: `plugin-command:${manifest.id}:${action.id}`,
        group: "plugin-command" as const,
        source: pluginSource(plugin),
        title: pluginActionTitle(manifest.id, action.id, action.title),
        detail: displayName,
        icon: (action.icon as IconName | undefined) ?? "sparkles",
        ...(manifest.accent ? { accent: manifest.accent } : {}),
        pluginId: manifest.id,
        bundled: plugin.bundled,
        token: { kind: "command" as const, value: action.token.value },
      },
    ];
  });
}

function pluginCards(plugin: LoadedPlugin): ComposerCatalogItem[] {
  const manifest = plugin.parsed.manifest;
  const icon = manifest.contributes.composerActions[0]?.icon as IconName | undefined;
  return [
    {
      id: `plugin:${manifest.id}`,
      group: "plugin",
      source: pluginSource(plugin),
      title: pluginDisplayName(manifest.id, manifest.name),
      detail: plugin.bundled ? pickText("NIBI 插件", "NIBI plugin") : pickText("用户插件", "User plugin"),
      icon: icon ?? "puzzle",
      ...(manifest.accent ? { accent: manifest.accent } : {}),
      pluginId: manifest.id,
      bundled: plugin.bundled,
      token: { kind: "plugin", value: `${manifest.id}@inline` },
    },
  ];
}

function messageActions(plugin: LoadedPlugin): ComposerCatalogItem[] {
  const manifest = plugin.parsed.manifest;
  const displayName = pluginDisplayName(manifest.id, manifest.name);
  return manifest.contributes.messageActions.flatMap((action) => {
    if (!action.command) return [];
    return [
      {
        id: `message:${manifest.id}:${action.id}`,
        group: "message" as const,
        source: pluginSource(plugin),
        title: pluginActionTitle(manifest.id, action.id, action.title),
        detail: `${displayName} · ${pickText("引用这条消息", "Quote this message")}`,
        icon: "sparkles" as const,
        ...(manifest.accent ? { accent: manifest.accent } : {}),
        pluginId: manifest.id,
        pluginName: displayName,
        bundled: plugin.bundled,
        token: { kind: "command" as const, value: action.command },
      },
    ];
  });
}

function skillItems(skills: readonly SkillCatalogEntry[]): ComposerCatalogItem[] {
  return skills.flatMap((skill) => {
    if (skill.enabled === false) return [];
    const plugin = skill.scope === "plugin";
    const bare = bareSkillName(skill);
    const value = skill.pluginName ? `${skill.pluginName}:${bare}` : bare;
    return [
      {
        id: `skill:${skill.id}`,
        group: "skill" as const,
        source: plugin ? ("plugin" as const) : ("nibi" as const),
        title: pluginSkillName(skill.pluginName, bare, skill.title ?? bare),
        detail: skill.pluginName
          ? `${pickText("插件", "Plugin")} · ${pluginDisplayName(skill.pluginName, skill.pluginName)}`
          : pickText("本机技能", "Local skill"),
        icon: "doc" as const,
        ...(skill.pluginName ? { pluginId: skill.pluginName } : {}),
        token: { kind: "skill" as const, value },
      },
    ];
  });
}

/** 插件清单自带、但内核 skill catalog 可能还没发现的技能（尤其是无会话时）。 */
export function pluginManifestSkills(
  plugins: readonly LoadedPlugin[],
): SkillCatalogEntry[] {
  return plugins
    .filter((plugin) => plugin.enabled && plugin.parsed.slotsAvailable)
    .flatMap((plugin) => {
      const manifest = plugin.parsed.manifest;
      return (manifest.skills ?? []).map((skill) => ({
        id: `plugin-manifest:${manifest.id}:${skill.id}`,
        name: skill.id,
        title: pluginSkillName(manifest.id, skill.id, skill.name ?? skill.id),
        description: pluginSkillDescription(manifest.id, skill.id, skill.description),
        scope: "plugin" as const,
        pluginName: manifest.id,
        enabled: true,
      }));
    });
}

/** 内核目录 + 插件清单技能，按“插件名:技能名”去重。 */
export function mergeSkillCatalog(
  kernelSkills: readonly SkillCatalogEntry[],
  plugins: readonly LoadedPlugin[],
): SkillCatalogEntry[] {
  const manifestSkills = pluginManifestSkills(plugins);
  const titles = new Map(
    manifestSkills.map((skill) => [skillIdentity(skill), skill.title ?? skill.name]),
  );
  const seen = new Set<string>();
  const merged: SkillCatalogEntry[] = [];
  for (const skill of [...kernelSkills, ...manifestSkills]) {
    const key = skillIdentity(skill);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = skill.title ?? titles.get(key);
    merged.push(title ? { ...skill, title } : skill);
  }
  return merged;
}

export function buildComposerCatalog(
  plugins: readonly LoadedPlugin[],
  skills: readonly SkillCatalogEntry[] = [],
): ComposerCatalogItem[] {
  const enabled = plugins.filter((plugin) => plugin.enabled && plugin.parsed.slotsAvailable);
  return [
    ...attachments(),
    ...nativeCommands(),
    ...enabled.flatMap(pluginCommands),
    ...enabled.flatMap(pluginCards),
    ...skillItems(skills),
    ...enabled.flatMap(messageActions),
  ];
}

/** 胶囊只能放命令/技能/模式，不能放附件或插件引用卡。 */
export function capsuleEligible(item: ComposerCatalogItem): boolean {
  return (
    item.group === "native-command" ||
    item.group === "plugin-command" ||
    item.group === "skill"
  );
}

/** 长按消息菜单：内置注释之外，可放消息动作和技能。 */
export function messageEligible(item: ComposerCatalogItem): boolean {
  return item.group === "message" || item.group === "skill";
}

export function defaultCapsuleIds(catalog: readonly ComposerCatalogItem[]): string[] {
  const preferred = ["native:compact", "native:goal", "native:plan"];
  return preferred.filter((id) => catalog.some((item) => item.id === id && capsuleEligible(item)));
}
