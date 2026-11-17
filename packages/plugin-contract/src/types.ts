// GO 插件契约 v1 的公共类型。
//
// 与桌面插件体系（D13）没有共享类型：这里的 manifest、view、slot、effect 都是 GO 自己的
// `nibi-go-native-ui` 面。插件逻辑在 Node/Python 子进程，App 只渲染声明式 JSON。
//
// 兼容性口径：
// - manifest 里不认识的字段直接忽略（老 App 不因为新字段拒插件）；
// - 单个 contribution 出错只丢这一条，不拒整份 manifest；
// - view 里不认识的组件走 adaptView，换成 v1 的替身并在 issues 里留证据。

/** 视图/清单里的数据绑定：`{ "$": "data.host.appVersion" }`。 */
export interface Binding {
  $: string;
}

/** 文本字段：字面量或数据绑定（字面量支持 `{{data.x.y}}` 插值）。 */
export type ViewText = string | Binding;

export type ViewTextStyle = "title" | "body" | "caption" | "mono" | "label";

/** 颜色只给语义名，插件不能指定任意色值（避免拼出像授权/警告的界面）。 */
export type ViewTone = "default" | "sub" | "faint" | "brand" | "ok" | "warn" | "danger";

export interface ViewListItem {
  label: ViewText;
  value?: ViewText;
  tone?: ViewTone;
}

export type ViewNode =
  | {
      type: "text";
      text: ViewText;
      style?: ViewTextStyle;
      tone?: ViewTone;
      maxLines?: number;
    }
  | {
      type: "row";
      gap?: number;
      align?: "start" | "center" | "between";
      children: ViewNode[];
    }
  | { type: "column"; gap?: number; children: ViewNode[] }
  | { type: "card"; title?: ViewText; children: ViewNode[] }
  | { type: "badge"; text: ViewText; tone?: ViewTone }
  | { type: "divider" }
  | { type: "progress"; value: number | Binding; label?: ViewText }
  | { type: "list"; items: Binding | ViewListItem[]; empty?: string }
  | {
      type: "button";
      label: ViewText;
      action: string;
      style?: "primary" | "secondary" | "danger";
    }
  | { type: "spacer"; size?: number };

/** 视图预算：超出即丢这一条 contribution（工具卡退回纯文本行）。 */
export interface ViewBudget {
  /** 序列化后的 UTF-8 字节上限。 */
  bytes: number;
  /** 节点数上限。 */
  nodes: number;
  /** 嵌套深度上限（根节点算 1）。 */
  depth: number;
}

export type ViewKind = "toolCard" | "panel" | "strip";

/** 各 slot 的预算；与 docs/design/android-native-runtime.md §7 一致。 */
export const VIEW_BUDGETS: Record<ViewKind, ViewBudget> = {
  toolCard: { bytes: 8 * 1024, nodes: 40, depth: 6 },
  panel: { bytes: 32 * 1024, nodes: 120, depth: 8 },
  strip: { bytes: 2 * 1024, nodes: 8, depth: 3 },
};

/** 单个 slot 每插件的条数上限（设计文档 §7 的表格）。 */
export const SLOT_LIMITS = {
  toolCards: Number.POSITIVE_INFINITY,
  "composer.actions": 2,
  "message.actions": 2,
  "composer.strip": 1,
  panels: 4,
  "composer.tools": 2,
  "session.actions": 2,
  "turn.note": 1,
  webIslands: 2,
} as const;

export type SlotName = keyof typeof SLOT_LIMITS;

/** App 实现的能力面；插件 manifest 的 `caps` 只做声明，缺能力时走降级。 */
export type Capability = "view.v1" | "slots.v1" | "effects.v1" | "mcp.v1";

export const APP_CAPABILITIES: readonly Capability[] = [
  "view.v1",
  "slots.v1",
  "effects.v1",
  "mcp.v1",
];

/** 宿主档案：本机与远端主机的能力差（远端没有插件槽，如实降级）。 */
export interface HostProfile {
  appVersion: string;
  caps: readonly Capability[];
  host: "local" | "remote";
}

/** 校验/解析过程中的一条问题（JSON Pointer 风格路径）。 */
export interface ContractIssue {
  path: string;
  message: string;
}

export interface ToolCardContribution {
  id: string;
  title?: string;
  /** 匹配 MCP 工具名（服务器内的名字，不是 `mcp__server__tool` 全名）。缺省匹配该服务器全部工具。 */
  tool?: string;
  view: ViewNode;
  actions: PanelAction[];
}

/**
 * 一个输入 token 的语义（对齐 NIBI 客户端的 mention / 命令，而不是把提示词塞进输入框）：
 * - `plugin`：插件引用，发送时序列化成 `[@名字](plugin://stable-id)`，内核在回合边界注入能力说明；
 * - `command`：插件/用户命令，发送时序列化成 `/命令名`，内核展开命令模板（可带 skill/tool/MCP 上下文）；
 * - `skill`：技能引用，发送时序列化成 `$技能名`，内核按技能提及注入。
 */
export interface ComposerTokenContribution {
  kind: "plugin" | "command" | "skill";
  value: string;
}

export interface ComposerActionContribution {
  id: string;
  title: string;
  icon?: string;
  /** 点击后插入 COMPOSE 的 token；缺省表示执行 `effects`（旧清单兼容）。 */
  token?: ComposerTokenContribution;
  /** 生成插件命令时使用的正文（只在 `token.kind === "command"` 时有意义）。 */
  prompt?: string;
  /** 命令展开前要求模型先加载的 skill（`<插件名>:<技能目录名>`）。 */
  skills?: string[];
  effects?: Effect[];
}

/** 助手消息长按菜单里的一项（每插件 ≤2）。 */
export interface MessageActionContribution {
  id: string;
  title: string;
  /** 作为“针对这条消息的注释指令”发送；有它时不再执行 effects。 */
  instruction?: string;
  effects?: Effect[];
}

/** 输入栏快捷动作（多层胶囊列表）里的一项（每插件 ≤2）。 */
export interface ComposerToolContribution {
  id: string;
  title: string;
  icon?: string;
  token?: ComposerTokenContribution;
  prompt?: string;
  skills?: string[];
  effects?: Effect[];
}

/** 会话操作行里的一项（每插件 ≤2）。 */
export interface SessionActionContribution {
  id: string;
  title: string;
  effects: Effect[];
}

/** 回合脚注末尾的只读文字（每插件 ≤1）。 */
export interface TurnNoteContribution {
  id: string;
  text: ViewText;
  tone?: ViewTone;
}

/** Web Island：插件声明的网页面板；url 只允许 https，或使用内联 html（≤16KiB）。 */
export interface WebIslandContribution {
  id: string;
  title: string;
  url?: string;
  html?: string;
}

export interface PanelContribution {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  /** 静态数据，和宿主的 `host` 数据合并后供 view 绑定。 */
  data?: Record<string, unknown>;
  view: ViewNode;
  actions: PanelAction[];
}

export interface StripContribution {
  id: string;
  text: ViewText;
  tone?: ViewTone;
}

export interface PanelAction {
  id: string;
  label: string;
  effects: Effect[];
}

export interface PluginRuntime {
  type: "mcp";
  /** MCP 服务器名（`mcp__<name>__<tool>` 的第二段）。 */
  serverName: string;
  /** 相对插件根目录的入口脚本。 */
  entry: string;
  alwaysLoad?: boolean;
  timeoutMs?: number;
}

/** 插件自带的技能：App 写成 `<插件根>/skills/<id>/SKILL.md`，内核按插件技能发现。 */
export interface PluginSkillContribution {
  id: string;
  name?: string;
  description?: string;
  body: string;
}

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  minApp?: string;
  /** 输入 token 的强调色（只能选语义色，不能写任意色值）。 */
  accent?: ViewTone;
  caps: string[];
  runtime?: PluginRuntime;
  skills?: PluginSkillContribution[];
  contributes: {
    toolCards: ToolCardContribution[];
    composerActions: ComposerActionContribution[];
    messageActions: MessageActionContribution[];
    composerTools: ComposerToolContribution[];
    sessionActions: SessionActionContribution[];
    panels: PanelContribution[];
    strips: StripContribution[];
    turnNotes: TurnNoteContribution[];
    webIslands: WebIslandContribution[];
  };
}

/** 一条插件清单解析后的结果；`status` 决定 App 是否执行它的运行时/渲染它的槽。 */
export interface ParsedPlugin {
  manifest: PluginManifest;
  status: "ready" | "incompatible" | "invalid";
  /** App 展示的原因（不可兼容/远端降级）。 */
  reason?: string;
  issues: ContractIssue[];
  /** `host === "remote"` 时槽被摘掉，插件仍可在详情页里看到。 */
  slotsAvailable: boolean;
  /** 有组件被替换成 v1 替身的槽（`toolCards:<id>` / `panels:<id>`）。 */
  degraded: string[];
}

export type Effect =
  | { kind: "insert"; text: string; mode?: "append" | "replace" }
  | { kind: "toast"; text: string }
  | { kind: "copy"; text: string }
  | { kind: "open"; panel: string }
  | { kind: "link"; url: string }
  | { kind: "command"; name: string; args?: unknown }
  | { kind: "refresh" };

/** 动作执行时 App 交给渲染层的运行时（不在契约包里实现）。 */
export interface SlotActionContext {
  pluginId: string;
  panelId?: string;
  toolCallId?: string;
}

/** 数据绑定求值用到的数据根：`{ data: { host, tool, plugin } }`。 */
export interface SlotData {
  data: Record<string, unknown>;
}
