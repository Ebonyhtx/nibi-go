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

/** `nibiWorkspaceRefSchema`：创建会话必填。 */
export interface KernelWorkspaceRef {
  workspacePath: string;
  workspaceKey: string;
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

export const KERNEL_METHODS = {
  sessionCreate: "session/create",
  sessionSend: "session/send",
  sessionMessages: "session/messages",
  sessionList: "session/list",
  sessionResume: "session/resume",
  conversationSubscribe: "v4/conversation/subscribe",
  conversationUnsubscribe: "v4/conversation/unsubscribe",
  conversationFrame: "v4/conversation/frame",
  requestRuntimePreferences: "session/requestRuntimePreferences",
  /** 前向命令面：回答权限/提问等交互（`resolveInteraction`）。 */
  command: "v4/command",
  /** 一轮的文件改动明细（按轮头行取）。 */
  fileChanges: "v4/conversation/fileChanges",
} as const;
