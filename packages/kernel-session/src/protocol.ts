// 内核 app-server 协议里本包用到的最小集合（真机 2026-11-15 核对）。
//
// 来源：nibi-client `kernel/crates/protocol-nibi/src/server.rs` 的方法表 —— 内核**没有**
// `session/events` 订阅；实时状态是通知帧（`v4/telemetry/event`、`computer-use/operation-event`），
// 消息内容要主动 `session/messages` 读。

/** 传输面：一行一个 JSON 帧。App 里由 `nibi-kernel-host` 提供。 */
export interface KernelTransport {
  /** 送入一行（缺 LF 由内核补）；返回是否入队成功。 */
  sendLine(line: string): boolean;
  /** 订阅内核输出行；返回取消函数。 */
  onLine(listener: (line: string) => void): () => void;
}

/** `session/create` 的模型选择（内核 `commands::selection`：providerId/modelId/thoughtLevel）。 */
export interface KernelModelSelection {
  providerId: string;
  modelId: string;
  /** 内核的 `thoughtLevel`（推理档位）。 */
  thoughtLevel?: string;
}

/** 会话权限模式（内核 `PermissionMode::from_node_name` 的 Node 名）。plan 不是权限模式，是独立 `planEnabled`。 */
export type KernelPermissionMode = "build" | "edit" | "guarded" | "yolo";

/** `nibiWorkspaceRefSchema`：创建会话必填。 */
export interface KernelWorkspaceRef {
  workspacePath: string;
  workspaceKey: string;
}

/**
 * `session/create` / `session/resume` 的 `mcpServers` 一项（内核 `commands::session_mcp_servers`）。
 *
 * GO 插件宿主把插件的 MCP 入口按这个形状交给内核：`command`/`args` 走 stdio，`type`+`url`
 * 走 HTTP/SSE。凭据不进这里——插件只拿到 `nibi-run`/node 的环境白名单。
 */
export interface KernelMcpServer {
  name: string;
  /** stdio 服务器：可执行文件（PATH 查找，例如 `node`）。 */
  command?: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  /** HTTP/SSE 服务器。 */
  type?: "http" | "sse";
  url?: string;
  headers?: Array<{ name: string; value: string }>;
  /** 工具不延迟加载（插件工具卡需要模型能直接看到）。 */
  alwaysLoad?: boolean;
  timeoutMs?: number;
  isolation?: "session" | "workspace";
}

/**
 * `sendText` 的结构化引用（内核 `conversationQuotes`）：用户选中的原文 + 可选评论/指令。
 *
 * 行上的正文仍是用户输入；这份数据只在模型边界追加成 `<conversation_quote>`，界面把它
 * 画成小卡片，不把原文抄进气泡。
 */
export interface KernelConversationQuote {
  text: string;
  path?: string;
  senderName?: string;
  senderId?: string;
  messageId?: string;
  sentAt?: string;
  kind?: "annotation" | "transform" | "quote";
  comment?: string;
  instruction?: string;
  number?: number;
  messageKey?: string;
  messageRole?: "user" | "assistant";
}

/** 插件引用（内核 `pluginReferences`）：identifiers-only 的能力元数据。 */
export interface KernelPluginReference {
  id: string;
  name?: string;
  skills?: string[];
  mcpServers?: string[];
  commands?: string[];
}

/** `skills/referenceCatalog` 的一条技能（内核 `SkillReference` 的展示子集）。 */
export interface KernelSkillReference {
  id: string;
  name: string;
  description?: string;
  path?: string;
  scope?: "workspace" | "user" | "plugin";
  pluginName?: string;
  enabled?: boolean;
}

export interface KernelAttachmentRef {
  ref: string;
  fileName: string;
  mime: string;
  bytes: number;
  sourceKind?: "clipboard-text" | "topic-history";
  messageCount?: number;
  previewRef?: string;
}

export interface KernelSendTextOptions {
  attachments?: readonly KernelAttachmentRef[];
  conversationQuotes?: readonly KernelConversationQuote[];
  pluginReferences?: readonly KernelPluginReference[];
  /** 新输入默认 `startNow`；排队/引导沿用内核的 `requestedDelivery`。 */
  requestedDelivery?: "startNow" | "queue" | "guide";
  inputOrigin?: "desktop" | "mobile";
  /** 提交时切换到哪个权限模式；与 `planEnabled` 独立。 */
  mode?: KernelPermissionMode;
  /** 提交时打开/关闭计划模式（不改权限模式）。 */
  planEnabled?: boolean;
  /** 提交时切换模型（不在选择时立刻改会话）。 */
  modelSelection?: Pick<KernelModelSelection, "providerId" | "modelId"> & {
    reasoningLevel?: string;
  };
}

export interface KernelMessagePart {
  partId?: string;
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** `session/messages` 返回的 legacy 消息形状（`{info, parts}`）。 */
export interface KernelMessage {
  info: {
    messageId: string;
    sessionId?: string;
    role: string;
    time?: { created?: number; completed?: number };
    model?: { providerId?: string; modelId?: string };
    [key: string]: unknown;
  };
  parts: KernelMessagePart[];
}

/** 内核 → 宿主的通知帧（没有数字 id 的 method 帧）。 */
export interface KernelNotification {
  method: string;
  params?: unknown;
}

export interface KernelSessionCreateResult {
  sessionId: string;
  session?: {
    sessionId?: string;
    status?: string;
    title?: string;
    model?: { providerId?: string; modelId?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** `session/list` 的一行（内核 `session_directory::info`）。 */
export interface KernelSessionSummary {
  sessionId: string;
  title: string;
  mode?: string;
  status?: string;
  sessionKind?: string;
  createdAt?: number;
  updatedAt?: number;
  workspace?: { workspacePath?: string; workspaceKey?: string };
  parentSessionId?: string;
  [key: string]: unknown;
}

/** `v4/storage/sessionData/purge` 的结果（内核 `SessionDataPurge`）。 */
export interface KernelSessionDataPurge {
  /** 已彻底删除的会话（`bytes` 是实际删掉的磁盘文件字节；数据库行不计入）。 */
  deleted: { sessionId: string; bytes: number }[];
  /** 运行中/被引用的会话，整棵保留。 */
  kept: { sessionId: string; reason: "running" | "referenced" }[];
  /** 逐项失败（`sessionId` 或 `workspacePath` + 错误码）。 */
  failed: { sessionId?: string; workspacePath?: string; code: string }[];
  /** 目录项目记忆的字节数（本次不传目录时为空）。 */
  memory: { workspacePath: string; bytes: number }[];
}

export const KERNEL_METHODS = {
  sessionCreate: "session/create",
  sessionSend: "session/send",
  sessionMessages: "session/messages",
  sessionList: "session/list",
  sessionResume: "session/resume",
  /** 旧会话面的模式切换（plan/build）；v4 sendText 的 mode 也走同一条 Command::SetMode。 */
  sessionSetMode: "session/setMode",
  /** 目标管理（show/set/pause/resume/clear）：返回一句人读回执，用来在输入栏上方回显。 */
  sessionGoal: "session/goal",
  conversationSubscribe: "v4/conversation/subscribe",
  conversationUnsubscribe: "v4/conversation/unsubscribe",
  conversationFrame: "v4/conversation/frame",
  requestRuntimePreferences: "session/requestRuntimePreferences",
  /** 前向命令面：回答权限/提问等交互（`resolveInteraction`）。 */
  command: "v4/command",
  /** 一轮的文件改动明细（按轮头行取）。 */
  fileChanges: "v4/conversation/fileChanges",
  /** 会话数据的彻底删除（行 + 附件/轨迹文件；`measure` 是它的只读体量查询）。 */
  sessionDataMeasure: "v4/storage/sessionData/measure",
  sessionDataPurge: "v4/storage/sessionData/purge",
} as const;
