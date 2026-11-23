// 首页即会话（D2）：内核会话状态。
//
// 数据流对齐 dsh-Go：订阅 V4 会话投影（snapshot + row.delta），行模型由快照派生；
// 不再轮询 session/messages。dev 下没有真实 Provider 时按本机 mock 模型启动。
import { Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  ConversationController,
  ConversationFeed,
  KernelProtocolError,
  KernelSessionClient,
  type ChatFileChange,
  type ChatRow,
  type KernelAttachmentRef,
  type KernelConversationQuote,
  type KernelMcpServer,
  type KernelPermissionMode,
  type KernelPluginReference,
  type KernelSkillReference,
  type KernelSessionSummary,
  type KernelWorkspaceRef,
  type PluginSlotData,
  type TurnState,
} from "@nibi-go/kernel-session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  PermissionsAndroid,
  Platform,
  type AppStateStatus,
} from "react-native";

import {
  kernelHostAvailable,
  onKernelLine,
  onKernelRestart,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

import { getCachedMemoryPreferences, loadMemoryPreferences } from "../memory/preferences";
import { extractPetRowSignals, isDeliveryToolName } from "../components/petMachine";
import { pickText, useLocale, type Locale } from "../i18n";
import { notifyAgent } from "../relay/notifications";
import { completionAlert, turnFinishedState } from "./completionAlert";
import { getCachedDevicePreferences, subscribeDevicePreferences } from "../settings/devicePreferences";
import { loadArchivedSessionIds, saveArchivedSessionIds } from "./archiveStore";
import { registerKernelClient, unregisterKernelClient } from "./kernelRegistry";
import { kernelStartEnv } from "./kernelEnv";
import { providerKeysEnv, pushProviderKeys } from "./providerKeys";
import { fetchProviderState } from "./providerSettings";
import { splitSessions } from "./sessionArchive";
import { documentRootOf, legacyWorkspaceRef, type WorkspaceRefLike } from "./workspace";
import {
  ensureProjectWorkspace,
  ensureSessionWorkspace,
  pruneOrphanWorkspaces,
  removeSessionTempDir,
  removeSessionWorkspace,
} from "./workspaceStore";
import {
  phoneMcpServer,
  phoneToolsRevision,
  refreshPhoneMcpAttachment,
  subscribePhoneToolsChanged,
} from "../phone/status";
import {
  canShowBubble,
  phoneToolsActive,
  setBubbleState,
  type PhoneBubbleState,
} from "../phone/bubble";
import { loadPluginMcpServers } from "../plugins/store";

/**
 * D20 承载模式：默认 `:kernel` 进程（前台服务，UI 死掉内核仍在）；
 * `EXPO_PUBLIC_NIBI_KERNEL_MODE=inprocess` 可强制退回进程内做对照。
 * 服务启动失败时自动回退进程内，保证首页不空。
 */
const KERNEL_MODE = process.env.EXPO_PUBLIC_NIBI_KERNEL_MODE === "inprocess" ? "inprocess" : "service";

function workspaceRoot(): string {
  return documentRootOf(Paths.document.uri);
}

function workspaceCacheRoot(): string {
  return documentRootOf(Paths.cache.uri);
}

/**
 * 新会话带上设置页的默认模型。内核启动时也算一次默认，但 Provider 可能是在 App
 * 启动后才加的；显式传 `model` 让新会话不必等内核重启。
 *
 * 插件的 MCP 服务器也在这里交给内核（`session/create.mcpServers`）。插件文件读不出来
 * 时只记日志，不影响会话本身。
 */
async function pluginMcpServers(): Promise<
  Awaited<ReturnType<typeof loadPluginMcpServers>> | undefined
> {
  try {
    const servers = await loadPluginMcpServers();
    return servers.length > 0 ? servers : undefined;
  } catch (error) {
    console.warn("[nibigo] 插件 MCP 配置读取失败，本次会话不带插件", error);
    return undefined;
  }
}

/**
 * 会话级 MCP 服务器 = 插件 + 手机。
 *
 * 每次 create/resume 都重新取：手机服务器的端口/token 随进程变化，开关也可能刚变；
 * 原生配置只交给内核，不写日志。
 */
async function sessionMcpServers(): Promise<KernelMcpServer[] | undefined> {
  const servers: KernelMcpServer[] = [];
  const plugins = await pluginMcpServers();
  if (plugins) servers.push(...plugins);
  const phone = phoneMcpServer();
  if (phone) servers.push(phone);
  return servers.length > 0 ? servers : undefined;
}

class SetupRequiredError extends Error {
  readonly code = "SETUP_REQUIRED" as const;
  constructor() {
    super(pickText("还没有可用的模型服务", "No model provider configured yet"));
  }
}

class SessionKeptError extends Error {
  readonly code = "SESSION_KEPT" as const;
  constructor() {
    super(
      pickText(
        "会话正在运行或被引用，暂时不能删除",
        "Session is running or referenced and cannot be deleted right now",
      ),
    );
  }
}

type KernelStatusCode =
  | "init"
  | "ready"
  | "restarting"
  | "kernel_unavailable"
  | "setup_required"
  | "send_failed"
  | "reconnect_failed"
  | "init_failed"
  | "error";

interface KernelStatusState {
  code: KernelStatusCode;
  detail?: string;
  zhPrefix?: string;
  enPrefix?: string;
}

function isSetupRequiredError(error: unknown): boolean {
  return (
    error instanceof SetupRequiredError ||
    (error instanceof Error &&
      (error.message.includes("还没有可用的模型服务") ||
        error.message.includes("No model provider configured")))
  );
}

function formatKernelStatus(state: KernelStatusState, locale: Locale): string {
  switch (state.code) {
    case "init":
      return pickText("初始化…", "Initializing…", locale);
    case "ready":
      return pickText("就绪", "Ready", locale);
    case "restarting":
      return pickText("内核重启中…", "Restarting kernel…", locale);
    case "kernel_unavailable":
      return pickText("内核不可用", "Kernel unavailable", locale);
    case "setup_required":
      return pickText("还没有可用的模型服务", "No model provider configured yet", locale);
    case "send_failed":
      return `${pickText("发送失败：", "Send failed: ", locale)}${state.detail ?? ""}`;
    case "reconnect_failed":
      return `${pickText("内核重连失败：", "Reconnect failed: ", locale)}${state.detail ?? ""}`;
    case "init_failed":
      return `${pickText("失败：", "Failed: ", locale)}${state.detail ?? ""}`;
    case "error": {
      const prefix = pickText(state.zhPrefix ?? "", state.enPrefix ?? "", locale);
      return `${prefix}${state.detail ?? ""}`;
    }
  }
}

async function createWithDefaultModel(
  client: KernelSessionClient,
  workspaceRef?: WorkspaceRefLike,
) {
  let model:
    | { providerId: string; modelId: string; thoughtLevel?: string }
    | undefined;
  try {
    const state = await fetchProviderState(client);
    if (state.default?.providerId && state.default?.modelId) {
      model = {
        providerId: state.default.providerId,
        modelId: state.default.modelId,
        ...(state.default.reasoningLevel
          ? { thoughtLevel: state.default.reasoningLevel }
          : {}),
      };
    }
  } catch (error) {
    // 只有“老内核没有这条 RPC”才允许交给内核缺省；冷启动超时/通道被顶掉时必须让调用方
    // 看到失败，否则会静默建出一个内核默认模型（曾因此把 mock 写进会话并一路沿用）。
    if (!(error instanceof KernelProtocolError) || error.code !== -32601) throw error;
  }
  if (!model) throw new SetupRequiredError();
  // 会话 ID 由 Host 先生成：workspace 目录名要用它，而内核在 create 之后才返回 ID。
  // deferred：未发过消息的「新对话」不落库、不进会话抽屉（内核首条输入时才提升为正式会话）。
  // 项目会话的 workspace 是项目目录（多会话共享；记忆/项目级 agents 都挂它），在创建前建好。
  const sessionId = Crypto.randomUUID();
  const workspace = workspaceRef ?? ensureSessionWorkspace(workspaceRoot(), sessionId);
  return client.createSession(workspace, model, await sessionMcpServers(), {
    persistence: "deferred",
    sessionId,
  });
}

/** 恢复会话时也把插件 + 手机 MCP 交回去（内核不持久化这份配置）。 */
async function resumeWithMcpServers(client: KernelSessionClient, sessionId: string) {
  return client.resumeSession(sessionId, await sessionMcpServers());
}

/** Android 13+ 前台服务通知需要运行时授权；拒绝不影响内核，只是通知不显示。 */
async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (!granted) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
  } catch {
    // 权限 API 不可用时忽略。
  }
}

export interface KernelSendOptions {
  /** 图片/文件附件（内核按内容块注入模型上下文）。 */
  attachments?: readonly KernelAttachmentRef[];
  /** 权限模式（变更前确认/自主模式/完全访问）。 */
  mode?: KernelPermissionMode;
  /** 计划模式是独立开关，不改权限模式。 */
  planEnabled?: boolean;
  /** 下一条消息使用的模型与思考档位。 */
  modelSelection?: {
    providerId: string;
    modelId: string;
    reasoningLevel?: string;
  };
  /** 注释/选段：只进模型文本与历史引用卡，不进用户气泡正文。 */
  conversationQuotes?: readonly KernelConversationQuote[];
  /** 选中的插件：identifiers-only 能力说明。 */
  pluginReferences?: readonly KernelPluginReference[];
}

export interface KernelConversation {
  rows: readonly ChatRow[];
  turn: TurnState;
  status: string;
  /** 状态横幅分类：ok 不显示；busy 是进行中（初始化/重启）；error 常驻并可带重试。 */
  statusKind: "ok" | "busy" | "error";
  /** 当前状态是否为未配置模型服务的引导态（结构化标志，不依赖文案字符串匹配）。 */
  setupIssue: boolean;
  /** 这条失败状态有没有对应的重试动作（横幅只在此为 true 时画「重试」）。 */
  statusRetryable: boolean;
  /** 状态横幅的「重试」：发送失败原样重发；初始化/重连失败重建连接。 */
  retryStatus: () => Promise<void>;
  /** 顶栏显示的当前默认模型（设置页的 `defaultModelSelection.modelId`）；未配置为空串。 */
  modelLabel: string;
  /** 当前会话快照里的模型选择（打开会话时同步给 COMPOSE）。 */
  currentModelSelection: {
    providerId: string;
    modelId: string;
    reasoningLevel?: string;
  } | null;
  /** 当前会话快照里的权限模式与计划开关。 */
  sessionMode: "build" | "guarded" | "yolo";
  sessionPlanEnabled: boolean;
  /** 上下文窗口占用、缓存命中率与构成分项（会话快照 usage.contextWindow）。 */
  contextUsage: {
    usedTokens: number;
    maxTokens: number;
    cacheHitRate: number | null;
    /** 会话累计缓存读/写；两项都为 0 时表示 Provider 未回传缓存数据。 */
    cacheReadTokens: number;
    cacheWriteTokens: number;
    breakdown: readonly { source: string; chars: number }[];
  } | null;
  ready: boolean;
  sending: boolean;
  /** 未归档的会话（抽屉主列表）。 */
  sessions: readonly KernelSessionSummary[];
  /** 已归档的会话（归档管理）；归档是 GO 本地的会话管理状态，不写内核。 */
  archivedSessions: readonly KernelSessionSummary[];
  activeSessionId: string | null;
  send: (text: string, options?: KernelSendOptions) => Promise<boolean>;
  /** 停止当前轮（内核 `stop`）；返回错误文案，成功为 null。 */
  stopTurn: () => Promise<string | null>;
  /** 编辑并重发最后一条用户输入（内核 `editUserQuery`）；返回错误文案，成功为 null。 */
  editResend: (
    target: { rowId: number; entityId: string },
    newText: string,
  ) => Promise<string | null>;
  /** 压缩上下文（内核 `compact`）；返回错误文案，成功为 null。 */
  compact: () => Promise<string | null>;
  /** 重试最后一轮（内核 `retryTurn`）；返回错误文案，成功为 null。 */
  retryTurn: (target: { rowId: number; entityId: string }) => Promise<string | null>;
  /** 目标管理（内核 `session/goal`）：show/set/pause/resume/clear。 */
  runGoal: (
    action: "show" | "set" | "pause" | "resume" | "clear",
    objective?: string,
  ) => Promise<{ message: string; startedTurn: boolean }>;
  newSession: (projectId?: string) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  /** 归档一条会话（隐藏出主列表，可在归档管理里恢复或删除）。 */
  archiveSession: (sessionId: string) => Promise<void>;
  /** 取消归档。 */
  unarchiveSession: (sessionId: string) => Promise<void>;
  /** 删除一条会话（`deleteSession` 关闭 + `sessionData/purge` 彻底删行与文件）；返回释放的文件字节。 */
  deleteSession: (sessionId: string) => Promise<number>;
  /** 彻底删除全部已归档会话；返回成功/失败/保留数与释放字节。 */
  deleteAllArchived: () => Promise<{
    succeeded: number;
    failed: number;
    kept: number;
    bytes: number;
  }>;
  /** 回答审批/提问（`v4/command` 的 `resolveInteraction`）。 */
  respondInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
  /** 轮末改动卡：键是 turn 行的 key（`turn<rowId>`）。 */
  turnChanges: Readonly<Record<string, readonly ChatFileChange[]>>;
  /** 当前会话可用的本机/插件技能（Composer 的 $ 技能引用）。 */
  skills: readonly KernelSkillReference[];
  /** 插件主动推的槽数据（serverName → slotId → data）；live-only，切会话即清空。 */
  pluginSlotData: PluginSlotData;
}

/** 工具行是否在执行/等审批（气泡 tools 状态的判定口径，对齐会话行卡的 running 口径）。 */
function isActiveToolStatus(status: string): boolean {
  return status === "running" || status === "inputStreaming" || status === "pendingApproval";
}

function hasActiveToolRow(row: ChatRow): boolean {
  if (row.kind === "tool") return isActiveToolStatus(row.status);
  if (row.kind === "toolGroup") return row.tools.some((tool) => isActiveToolStatus(tool.status));
  return false;
}

export function useKernelConversation(): KernelConversation {
  const [rows, setRows] = useState<readonly ChatRow[]>([]);
  const [turn, setTurn] = useState<TurnState>("idle");
  // 任务运行时保持唤醒（桌面 keepAwakeWhileRunning 的移植语义，设备偏好可开关）。
  const keepAwakeRef = useRef(getCachedDevicePreferences().keepAwakeWhileRunning);
  useEffect(() =>
    subscribeDevicePreferences((preferences) => {
      keepAwakeRef.current = preferences.keepAwakeWhileRunning;
    }), []);
  useEffect(() => {
    if (turn !== "running" || !keepAwakeRef.current) return;
    void activateKeepAwakeAsync("nibi-turn").catch(() => undefined);
    return () => {
      void deactivateKeepAwake("nibi-turn");
    };
  }, [turn]);
  const locale = useLocale();
  const [statusState, setStatusState] = useState<KernelStatusState>({ code: "init" });
  const status = useMemo(() => formatKernelStatus(statusState, locale), [statusState, locale]);
  const [modelLabel, setModelLabel] = useState("");
  const [currentModelSelection, setCurrentModelSelection] = useState<{
    providerId: string;
    modelId: string;
    reasoningLevel?: string;
  } | null>(null);
  const [sessionMode, setSessionMode] = useState<"build" | "guarded" | "yolo">("build");
  const [sessionPlanEnabled, setSessionPlanEnabled] = useState(false);
  const [contextUsage, setContextUsage] = useState<{
    usedTokens: number;
    maxTokens: number;
    cacheHitRate: number | null;
    /** 会话累计缓存读/写；两项都为 0 时表示 Provider 未回传缓存数据。 */
    cacheReadTokens: number;
    cacheWriteTokens: number;
    breakdown: readonly { source: string; chars: number }[];
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  // 内核返回的全部顶层会话（含已归档）；列表按本地归档集合拆成两份。
  const [allSessions, setAllSessions] = useState<readonly KernelSessionSummary[]>([]);
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(new Set());
  // 会话 → 内核持久化的 workspace。创建/恢复的快照与 session/list 都会带；
  // 技能目录、删除清理都按这份真实路径走，不能按当前布局现算（旧会话仍是 filesDir）。
  const sessionWorkspacesRef = useRef(new Map<string, KernelWorkspaceRef>());
  const rememberSessionSnapshot = useCallback((result: unknown) => {
    const value = result as
      | {
          session?: {
            sessionId?: unknown;
            workspace?: { workspacePath?: unknown; workspaceKey?: unknown };
            mode?: unknown;
            permissionMode?: unknown;
            planEnabled?: unknown;
            model?: { providerId?: unknown; modelId?: unknown };
          };
          settings?: { thoughtLevel?: { current?: unknown } };
        }
      | null;
    const session = value?.session;
    const snapshotSessionId = session?.sessionId;
    const workspacePath = session?.workspace?.workspacePath;
    if (
      typeof snapshotSessionId === "string" &&
      snapshotSessionId &&
      typeof workspacePath === "string" &&
      workspacePath
    ) {
      const workspaceKey = session?.workspace?.workspaceKey;
      sessionWorkspacesRef.current.set(snapshotSessionId, {
        workspacePath,
        workspaceKey: typeof workspaceKey === "string" && workspaceKey ? workspaceKey : workspacePath,
      });
    }
    const providerId = session?.model?.providerId;
    const modelId = session?.model?.modelId;
    if (typeof providerId === "string" && typeof modelId === "string") {
      const reasoning = value?.settings?.thoughtLevel?.current;
      setCurrentModelSelection({
        providerId,
        modelId,
        ...(typeof reasoning === "string" && reasoning ? { reasoningLevel: reasoning } : {}),
      });
      setModelLabel(modelId);
    }
    const permission =
      typeof session?.permissionMode === "string"
        ? session.permissionMode
        : session?.mode === "plan"
          ? "build"
          : session?.mode;
    if (permission === "guarded" || permission === "yolo" || permission === "build") {
      setSessionMode(permission);
    }
    if (typeof session?.planEnabled === "boolean") {
      setSessionPlanEnabled(session.planEnabled);
    } else if (session?.mode === "plan") {
      setSessionPlanEnabled(true);
    }
  }, []);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [turnChanges, setTurnChanges] = useState<Record<string, readonly ChatFileChange[]>>({});
  const [skills, setSkills] = useState<readonly KernelSkillReference[]>([]);
  // 插件槽的实时数据：只在当前订阅代际里有效，切会话/重连必须清空。
  const [pluginSlotData, setPluginSlotData] = useState<PluginSlotData>({});
  // 已经请求过明细的轮（stale 水位时才允许重试；其他失败不反复打内核）。
  const requestedChanges = useRef(new Set<string>());
  const clientRef = useRef<KernelSessionClient | null>(null);
  const feedRef = useRef<ConversationFeed | null>(null);
  const controllerRef = useRef<ConversationController | null>(null);
  // 内核重启重连时用来恢复「当前这条会话」（state 在回调里会过期）。
  const activeSessionIdRef = useRef<string | null>(null);
  // 归档集合的回调读值（refreshSessions/删除等回调不重建）。
  const archivedIdsRef = useRef<ReadonlySet<string>>(new Set());
  // 本机已发出、内核还没回显的提示（dsh-Go PendingRow）。
  const pendingRef = useRef<
    Array<{
      id: string;
      text: string;
      baselineRowId: number;
      attachments?: readonly KernelAttachmentRef[];
      conversationQuotes?: readonly KernelConversationQuote[];
      pluginReferences?: readonly KernelPluginReference[];
    }>
  >([]);
  const pendingSeq = useRef(1);
  // 最近一次发送的内容（含附件/引用/模式）：发送失败后状态横幅的「重试」原样重发。
  const lastSendRef = useRef<{ text: string; options: KernelSendOptions } | null>(null);

  const syncPending = useCallback((controller: ConversationController) => {
    const snapshot = controller.snapshot;
    if (!snapshot) return;
    const remaining = pendingRef.current.filter((entry) => {
      const commandName = entry.text.startsWith("/")
        ? (entry.text.slice(1).split(/\s+/u)[0] ?? "")
        : "";
      return !snapshot.rows.window.some((row) => {
        if (row.kind !== "userInput" || row.rowId <= entry.baselineRowId) return false;
        if (row.text === entry.text) return true;
        // 命令展开后内核把用户行写成 `<command-name>/命令</command-name>` 标签，
        // 正文不再等于草稿；按命令名认领，避免乐观气泡永远停在“发送中”。
        return (
          commandName.length > 0 &&
          row.text.includes(`<command-name>/${commandName}</command-name>`)
        );
      });
    });
    if (remaining.length !== pendingRef.current.length) {
      pendingRef.current = remaining;
      controller.setPending(
        remaining.map(({ id, text, attachments, conversationQuotes, pluginReferences }) => ({
          id,
          text,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          ...(conversationQuotes && conversationQuotes.length > 0
            ? { conversationQuotes }
            : {}),
          ...(pluginReferences && pluginReferences.length > 0 ? { pluginReferences } : {}),
        })),
      );
    }
  }, []);

  const syncContextUsage = useCallback((controller: ConversationController) => {
    const usage = controller.snapshot?.usage.contextWindow;
    if (!usage) {
      setContextUsage(null);
      return;
    }
    const cumulative = controller.snapshot?.usage.cumulative;
    const cumulativeTotalInput = cumulative
      ? cumulative.inputTokens +
        cumulative.cacheReadTokens +
        (cumulative.cacheWriteTokens ?? 0)
      : 0;
    const fallbackHitRate =
      cumulative && cumulativeTotalInput > 0
        ? Math.min(1, cumulative.cacheReadTokens / cumulativeTotalInput)
        : null;
    // 内核 /context 分析器的分项（chars 是 4 字符/token 折算）：右侧面板用它回答“上下文由什么组成”。
    const breakdown = Array.isArray(usage.breakdown)
      ? usage.breakdown
          .filter(
            (item: unknown): item is { source: string; chars: number } =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as { source?: unknown }).source === "string" &&
              typeof (item as { chars?: unknown }).chars === "number",
          )
          .map(({ source, chars }: { source: string; chars: number }) => ({ source, chars }))
      : [];
    const next = {
      usedTokens: usage.usedTokens,
      maxTokens: usage.maxTokens,
      cacheHitRate: usage.cache?.hitRate ?? fallbackHitRate,
      // 有的 Provider 不回传缓存读写（两项都是 0）：这时 0% 是“没有数据”而不是“没命中”，
      // 面板要分开显示（SideStatus 判这两项）。
      cacheReadTokens: usage.cache?.cacheReadTokens ?? cumulative?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cache?.cacheWriteTokens ?? cumulative?.cacheWriteTokens ?? 0,
      breakdown,
    };
    // 流式增量每帧都会重算用量；数值没变就不要换对象引用——右侧悬浮环的弧线
    // 动画以 usage 为依赖，引用一换就从零重播，看起来一直在抖。
    setContextUsage((prev) => {
      if (!prev) return next;
      if (
        prev.usedTokens === next.usedTokens &&
        prev.maxTokens === next.maxTokens &&
        prev.cacheHitRate === next.cacheHitRate &&
        prev.cacheReadTokens === next.cacheReadTokens &&
        prev.cacheWriteTokens === next.cacheWriteTokens &&
        prev.breakdown.length === next.breakdown.length &&
        prev.breakdown.every(
          (item, index) =>
            item.source === next.breakdown[index]?.source &&
            item.chars === next.breakdown[index]?.chars,
        )
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  // 轮末改动卡：对最近结束的几轮取 `v4/conversation/fileChanges`（按轮头行 + 快照水位）。
  // 只取最近 3 轮，避免会话一打开就对几十条历史轮各发一次 RPC。
  const syncTurnChanges = useCallback((controller: ConversationController) => {
    const snapshot = controller.snapshot;
    const client = clientRef.current;
    if (!snapshot || !client) return;
    const completed: Array<{ rowId: number; entityId: string }> = [];
    for (const row of snapshot.rows.window) {
      if (row.kind !== "turnHeader") continue;
      if (row.state === "running" || row.endedAt === undefined) continue;
      if (typeof row.entityId !== "string" || row.entityId.length === 0) continue;
      completed.push({ rowId: row.rowId, entityId: row.entityId });
    }
    for (const turn of completed.slice(-3)) {
      const key = `turn${turn.rowId}`;
      if (requestedChanges.current.has(key)) continue;
      requestedChanges.current.add(key);
      void client
        .fileChanges(turn, { revision: snapshot.revision, logEpoch: snapshot.logEpoch })
        .then((report) => {
          if (report.items.length === 0) return;
          setTurnChanges((current) => ({
            ...current,
            [key]: report.items.map((item) => ({
              path: item.path,
              additions: item.additions,
              deletions: item.deletions,
              edits: item.writeCount,
            })),
          }));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          // 水位刚过期：下一帧用新快照重试；其他失败（unsupported 等）不反复打。
          if (message.includes("staleRevision") || message.includes("staleLogEpoch")) {
            requestedChanges.current.delete(key);
          }
        });
    }
  }, []);

  const attach = useCallback(async (client: KernelSessionClient, sessionId: string) => {
    const previousController = controllerRef.current;
    const previousFeed = feedRef.current;
    controllerRef.current = null;
    feedRef.current = null;
    previousController?.dispose();
    await previousFeed?.stop().catch(() => undefined);

    const feed = new ConversationFeed(client);
    const controller = new ConversationController(feed);
    // 一帧只提交一次：内核一帧可能推好几个增量帧，逐帧 setState 会让消息流按
    // 增量次数重渲染（长会话里每个 token 都全量 reconcile）。合并到下一帧，
    // 视觉上仍是逐帧增长，React 只提交一次。切会话后 controllerRef 变了，
    // 迟到的 flush 会自行放弃。
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      if (controllerRef.current !== controller) return;
      setRows([...controller.rows]);
      setTurn(controller.turn);
      setPluginSlotData(controller.pluginSlots);
      syncContextUsage(controller);
      syncPending(controller);
      syncTurnChanges(controller);
    };
    controller.subscribe(() => {
      if (flushScheduled) return;
      flushScheduled = true;
      requestAnimationFrame(flush);
    });
    feedRef.current = feed;
    controllerRef.current = controller;
    pendingRef.current = [];
    controller.setPending([]);
    requestedChanges.current.clear();
    setTurnChanges({});
    setPluginSlotData({});
    setRows([]);
    setTurn("idle");
    setContextUsage(null);
    await feed.start(sessionId);
    const workspace =
      sessionWorkspacesRef.current.get(sessionId) ?? legacyWorkspaceRef(workspaceRoot());
    void client
      .request<{ skills?: KernelSkillReference[] }>("skills/referenceCatalog", {
        workspace,
        sessionId,
      })
      .then((result) => setSkills(Array.isArray(result.skills) ? result.skills : []))
      .catch(() => setSkills([]));
  }, [syncTurnChanges]);

  /**
   * 手机工具开关变化后，在当前会话上原地 resume 一次并重建投影订阅：
   * 内核只在 create/resume 时读取 MCP 列表，不新建对话也能让新能力生效。
   */
  const refreshSessionServers = useCallback(
    async (sessionId: string) => {
      const client = clientRef.current;
      if (!client || client.currentSessionId !== sessionId) return;
      try {
        const servers = await sessionMcpServers();
        // 读配置期间可能切了会话或内核重连；不是同一个 client/会话就放弃。
        if (clientRef.current !== client || client.currentSessionId !== sessionId) return;
        rememberSessionSnapshot(await client.resumeSession(sessionId, servers));
        if (clientRef.current !== client || activeSessionIdRef.current !== sessionId) return;
        await attach(client, sessionId);
        setStatusState({ code: "ready" });
      } catch (error) {
        setStatusState({
          code: "error",
          zhPrefix: "刷新手机工具失败：",
          enPrefix: "Failed to refresh phone tools: ",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [attach, rememberSessionSnapshot],
  );

  // 已应用的手机工具版本：初值取当前值，挂载时不会触发 resume。
  const appliedPhoneToolsRevision = useRef(phoneToolsRevision());
  const phoneRefreshInFlight = useRef(false);
  // 订阅回调只负责把 effect 叫醒；是否真的要 resume 由 revision 水位决定。
  const [phoneToolsSignal, setPhoneToolsSignal] = useState(0);

  useEffect(
    () => subscribePhoneToolsChanged(() => setPhoneToolsSignal((value) => value + 1)),
    [],
  );

  // 回到前台时确认 loopback MCP 服务器还在：进程被系统回收后服务器会重建，
  // 代次变化会走上面的订阅，把新地址 resume 给内核（否则旧客户端只会报 MCP is shut down）。
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshPhoneMcpAttachment();
    });
    return () => subscription.remove();
  }, []);

  // ── 全局悬浮像素宠物气泡 ─────────────────────────────────────────────
  // 离开 NIBI-GO 或手机操控执行中时，像素小鸟悬浮在屏幕侧边同步反映思考/干活/搬运/等审批/完成/报错；
  // 单击小鸟切回应用，拖动小鸟自动切入飞行态。状态只由这里驱动，无悬浮窗权限时静默。
  const bubbleAppStateRef = useRef<AppStateStatus>("active");
  const bubbleToolsBusyRef = useRef(false);
  // 回合结束（running→idle）后的短暂提示窗口（completed→done 2.4s，failed→error 3.2s）。
  const bubbleOutcomeRef = useRef<{ kind: "done" | "error"; until: number } | null>(null);
  const bubbleAutoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleLastRef = useRef<PhoneBubbleState>("hidden");
  const bubblePrevTurnRef = useRef<TurnState>("idle");
  const bubbleInputRef = useRef<{ turn: TurnState; rows: readonly ChatRow[] }>({ turn, rows });

  /** 汇总当前应显示的悬浮宠物状态；与上次相同就不打原生（流式期间 rows 高频变化）。 */
  const applyBubbleState = useCallback(() => {
    const current = bubbleInputRef.current;
    let next: PhoneBubbleState = "hidden";
    if (canShowBubble()) {
      if (bubbleToolsBusyRef.current) {
        // 手机操控进行中：无论前后台都亮（工具信号来自 1s 轮询）。
        next = "working";
      } else if (bubbleAppStateRef.current !== "active") {
        const signals = extractPetRowSignals(current.rows);
        if (signals.hasPendingInteraction) {
          next = "waiting";
        } else if (current.turn === "running") {
          if (signals.activeToolName) {
            next = isDeliveryToolName(signals.activeToolName) ? "carrying" : "working";
          } else if (signals.streamingAssistantHasText) {
            next = "working";
          } else {
            next = "thinking";
          }
        } else if (signals.hasRunningSubagent) {
          next = "working";
        } else {
          const outcome = bubbleOutcomeRef.current;
          // 切出应用且没有正在进行的事情时也要有“栖在桌面上”的常态小鸟；
          // 之前这里留 hidden，用户开了开关离开 App 却什么都看不到。
          next = outcome && Date.now() < outcome.until ? outcome.kind : "idle";
        }
      }
    }
    if (next === bubbleLastRef.current) return;
    bubbleLastRef.current = next;
    setBubbleState(next);
  }, []);

  useEffect(() => {
    bubbleInputRef.current = { turn, rows };
    if (turn === "running") {
      bubbleOutcomeRef.current = null;
      if (bubbleAutoHideTimerRef.current) {
        clearTimeout(bubbleAutoHideTimerRef.current);
        bubbleAutoHideTimerRef.current = null;
      }
    } else if (bubblePrevTurnRef.current === "running") {
      // 仅按真实回合结论决定 done 还是 error，不再把失败回合误亮成 done。
      let lastTurnState: string | null = null;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if (row.kind === "turn") {
          lastTurnState = row.state;
          break;
        }
      }
      const outcomeKind =
        turnFinishedState(lastTurnState) === "error"
          ? "error"
          : turnFinishedState(lastTurnState) === "complete"
            ? "done"
            : null;
      if (outcomeKind) {
        const stayMs = outcomeKind === "done" ? 2_400 : 3_200;
        bubbleOutcomeRef.current = { kind: outcomeKind, until: Date.now() + stayMs };
        if (bubbleAutoHideTimerRef.current) clearTimeout(bubbleAutoHideTimerRef.current);
        bubbleAutoHideTimerRef.current = setTimeout(() => {
          bubbleAutoHideTimerRef.current = null;
          bubbleOutcomeRef.current = null;
          // 与原生 autoHide 对齐，重置 bubbleLastRef，防止后续状态被误判成“未变化”。
          if (bubbleLastRef.current === outcomeKind) {
            bubbleLastRef.current = "hidden";
          }
          applyBubbleState();
        }, stayMs + 80);
      }
    }
    bubblePrevTurnRef.current = turn;
    applyBubbleState();
  }, [turn, rows, applyBubbleState]);

  useEffect(() => {
    return () => {
      if (bubbleAutoHideTimerRef.current) clearTimeout(bubbleAutoHideTimerRef.current);
    };
  }, []);

  // ── 本机对话提醒（任务完成 / 待审批 / 提问 / 出错）──────────────────────
  // 与桌面 PulseTracker 同一口径：一次性事件按 id 去重；首次投影只建基线，
  // 恢复历史会话时不会把已在等待的卡片补响一遍。前台由 notifyAgent 直接播
  // NIBI 三音色，后台走系统通知（渠道声音同源）。
  //
  // 回合完成不能只看 `turn` 的 running→idle 边沿：内核的 control.phase 可能先变 idle、
  // 最后一条 turn 行才落成 completed，这一帧错过就永远不会再响（真机上表现为“完成没声音”）。
  // 这里同时跟踪“最后一条 turn 行”的 rowId：见过它 running 后变成 completed/failed 就响，
  // 且每个 rowId 只响一次。
  const notifySessionRef = useRef<string | null>(null);
  const notifyPrevTurnRef = useRef<TurnState>("idle");
  const notifySeenRef = useRef<Set<string>>(new Set());
  const notifyBaselineRef = useRef(false);
  const notifyArmedRowRef = useRef<string | null>(null);
  const notifyDoneRowRef = useRef<string | null>(null);

  useEffect(() => {
    // 切会话：下一帧只重建基线，不把历史交互/旧回合当新事件提示。
    if (notifySessionRef.current !== activeSessionId) {
      notifySessionRef.current = activeSessionId;
      notifyBaselineRef.current = false;
      notifySeenRef.current = new Set();
      notifyPrevTurnRef.current = turn;
      notifyArmedRowRef.current = null;
      notifyDoneRowRef.current = null;
      return;
    }
    const previousTurn = notifyPrevTurnRef.current;
    notifyPrevTurnRef.current = turn;
    if (!ready) {
      notifyBaselineRef.current = false;
      notifySeenRef.current = new Set();
      notifyArmedRowRef.current = null;
      notifyDoneRowRef.current = null;
      return;
    }
    const current = new Set<string>();
    for (const row of rows) {
      if (row.kind === "approval" || row.kind === "question") current.add(row.interactionId);
    }
    if (!notifyBaselineRef.current) {
      notifySeenRef.current = current;
      notifyBaselineRef.current = true;
      return;
    }
    const fresh = [...current].filter((id) => !notifySeenRef.current.has(id));
    notifySeenRef.current = current;
    if (fresh.length > 0) {
      // 审批与提问共用 approval 音（桌面 D21：permission_request / elicitation_request
      // 都是同一双音风铃）。
      const isApproval = rows.some(
        (row) => row.kind === "approval" && fresh.includes(row.interactionId),
      );
      void notifyAgent({
        kind: "approval",
        title: isApproval
          ? pickText("需要审批", "Approval needed")
          : pickText("有一个问题", "Question"),
        body: isApproval
          ? pickText("AGENT 在等你批准一项操作", "The agent is waiting for your approval")
          : pickText("AGENT 在等你回答", "The agent is waiting for your reply"),
      });
      return;
    }
    let lastTurn: { key: string; rowId?: number; state: string } | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]!;
      if (row.kind === "turn") {
        lastTurn = {
          key: String(row.rowId ?? row.key),
          ...(typeof row.rowId === "number" ? { rowId: row.rowId } : {}),
          state: row.state,
        };
        break;
      }
    }
    const rowKey = lastTurn?.key ?? null;
    if (lastTurn?.state === "running" && rowKey) {
      notifyArmedRowRef.current = rowKey;
    }
    const alert = completionAlert({
      previousTurn,
      turn,
      lastTurn,
      armedRow: notifyArmedRowRef.current,
      doneRow: notifyDoneRowRef.current,
    });
    if (alert) {
      notifyDoneRowRef.current = alert.rowKey;
      notifyArmedRowRef.current = null;
      const failed = alert.kind === "error";
      void notifyAgent({
        kind: alert.kind,
        title: failed
          ? pickText("任务失败", "Task failed")
          : pickText("任务完成", "Task completed"),
        body: pickText("点按查看会话详情", "Tap to view the conversation"),
      });
    }
  }, [activeSessionId, ready, turn, rows]);

  // 回前台立即收起（手机工具在途时保留 tools）。
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      bubbleAppStateRef.current = state;
      applyBubbleState();
    });
    return () => subscription.remove();
  }, [applyBubbleState]);

  // 手机工具在途没有事件通道：回合进行中用 1s 轮询查原生 toolsBusy。
  // 工具只在回合内执行，turn 离开 running 就停轮询。
  useEffect(() => {
    if (turn !== "running") {
      // 回合已结束：清掉在途标记并对账一次，避免气泡停在 tools。
      if (bubbleToolsBusyRef.current) {
        bubbleToolsBusyRef.current = false;
        applyBubbleState();
      }
      return;
    }
    if (!canShowBubble()) return;
    const timer = setInterval(() => {
      bubbleToolsBusyRef.current = phoneToolsActive();
      applyBubbleState();
    }, 1_000);
    return () => clearInterval(timer);
  }, [turn, applyBubbleState]);

  useEffect(() => {
    if (!ready || turn !== "idle" || !activeSessionId) return;
    const revision = phoneToolsRevision();
    if (revision === appliedPhoneToolsRevision.current) return;
    if (phoneRefreshInFlight.current) return;
    appliedPhoneToolsRevision.current = revision;
    phoneRefreshInFlight.current = true;
    void refreshSessionServers(activeSessionId).finally(() => {
      phoneRefreshInFlight.current = false;
      // 刷新期间开关又变过时，用一次 signal 让 effect 再评估（revision 可能已变）。
      setPhoneToolsSignal((value) => value + 1);
    });
  }, [ready, turn, activeSessionId, phoneToolsSignal, refreshSessionServers]);

  const refreshSessions = useCallback(
    async (client: KernelSessionClient, options?: { pruneWorkspaces?: boolean }) => {
      try {
        const list = await client.listSessions();
        for (const item of list) {
          const workspacePath = item.workspace?.workspacePath;
          if (typeof workspacePath === "string" && workspacePath) {
            const workspaceKey = item.workspace?.workspaceKey;
            sessionWorkspacesRef.current.set(item.sessionId, {
              workspacePath,
              workspaceKey:
                typeof workspaceKey === "string" && workspaceKey ? workspaceKey : workspacePath,
            });
          }
        }
        // 启动时清一次草稿崩溃留下的空 workspace（只删空目录，非空的一律保留）。
        if (options?.pruneWorkspaces) {
          try {
            pruneOrphanWorkspaces(
              workspaceRoot(),
              new Set(list.map((item) => item.sessionId)),
              client.currentSessionId,
            );
          } catch {
            // 清理失败不影响会话恢复；下次启动再试。
          }
        }
        const topLevel = list
          .filter((session) => !session.parentSessionId)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        setAllSessions(topLevel);
        return splitSessions(topLevel, archivedIdsRef.current).visible;
      } catch {
        return [];
      }
    },
    [],
  );

  const split = useMemo(
    () => splitSessions(allSessions, archivedIds),
    [allSessions, archivedIds],
  );
  const sessions = split.visible;
  const archivedSessions = split.archived;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (KERNEL_MODE === "service") void ensureNotificationPermission();
        // 归档集合是本地状态：先读盘，再拉会话列表，避免已归档会话在首页闪一下。
        const archived = await loadArchivedSessionIds();
        if (cancelled) return;
        archivedIdsRef.current = new Set(archived);
        setArchivedIds(archivedIdsRef.current);
        // 默认模型在 app-server 启动时就算，Keystore 的 key 必须进启动 env；启动后的
        // 新增/删除再用 provider/setKeys 补。
        const env = { ...((await kernelStartEnv()) ?? {}), ...(await providerKeysEnv()) };
        const startEnv = Object.keys(env).length > 0 ? env : undefined;
        let started = await startKernelHost(startEnv, { useService: KERNEL_MODE === "service" });
        if (!started && KERNEL_MODE === "service") {
          // 前台服务起不来（后台启动限制/机型差异）时回退进程内，首页不能空。
          console.warn("[nibigo] :kernel 服务启动失败，回退进程内");
          started = await startKernelHost(startEnv, { useService: false });
        }
        if (cancelled) return;
        if (!started && !kernelHostAvailable()) {
          setStatusState({ code: "kernel_unavailable" });
          return;
        }
        // 内核建会话时同步问 Host 要偏好；先把记忆开关读进缓存，避免落到默认值。
        await loadMemoryPreferences();
        const client = new KernelSessionClient({
          transport: { sendLine: sendKernelLine, onLine: onKernelLine },
          runtimePreferences: () => ({
            nativeSearchEnhancementsEnabled: false,
            memoryEnabled: getCachedMemoryPreferences().enabled,
          }),
        });
        clientRef.current = client;
        registerKernelClient(client);
        // 清掉上一个 Activity 实例在常驻 `:kernel` 进程上残留的旧订阅（防重复增量帧）。
        await client.closeConnection().catch(() => undefined);
        // Keystore 里的 Provider key 只进内核内存；失败不阻塞会话（设置页会再提示）。
        await pushProviderKeys(client).catch((error: unknown) => {
          console.warn("[nibigo] 下发 Provider key 失败", error);
        });
        const providerState = await fetchProviderState(client).catch(() => null);
        if (providerState?.default?.modelId) {
          setModelLabel(providerState.default.modelId);
        }

        const list = await refreshSessions(client, { pruneWorkspaces: true });
        if (cancelled) return;
        // 启动恢复「最近一条有消息的会话」；全空则停在最新一条，不每次多建。
        let opened = false;
        // 空草稿会堆在列表最前面；只翻前 3 条会停在空草稿上。这里多翻一些，
        // 优先恢复“最近一条有消息的会话”。
        for (const candidate of list.slice(0, 12)) {
          const snapshot = await resumeWithMcpServers(client, candidate.sessionId);
          const messages = await client.readMessages({ limit: 1 });
          if (messages.length > 0) {
            // 只有真的有消息的会话才认它的模型/模式；空草稿的模型可能是内核旧缺省，
            // 认下来会把“默认模型”永久顶掉（mockgateway 就是这样写进会话的）。
            rememberSessionSnapshot(snapshot);
            opened = true;
            break;
          }
        }
        if (!opened) {
          if (list.length > 0) {
            rememberSessionSnapshot(await resumeWithMcpServers(client, list[0]!.sessionId));
          } else {
            rememberSessionSnapshot(await createWithDefaultModel(client));
          }
        }
        const sessionId = client.currentSessionId;
        if (cancelled || !sessionId) return;
        await attach(client, sessionId);
        if (!cancelled) {
          activeSessionIdRef.current = sessionId;
          setActiveSessionId(sessionId);
          setReady(true);
          setStatusState({ code: "ready" });
        }
      } catch (error) {
        if (!cancelled) {
          if (isSetupRequiredError(error)) {
            setStatusState({ code: "setup_required" });
          } else {
            setStatusState({
              code: "init_failed",
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      controllerRef.current?.dispose();
      controllerRef.current = null;
      void feedRef.current?.stop().catch(() => undefined);
      feedRef.current = null;
      const client = clientRef.current;
      if (client) unregisterKernelClient(client);
      client?.close();
      clientRef.current = null;
    };
  }, [attach, refreshSessions]);

  // D20：`:kernel` 进程重启后重建 client/订阅并恢复当前会话。
  // 恢复口径 = 内核自己逐条落库 + 宿主重连后 resume，watchdog 不重放。
  const reconnect = useCallback(async () => {
    const previousController = controllerRef.current;
    const previousFeed = feedRef.current;
    const previousClient = clientRef.current;
    controllerRef.current = null;
    feedRef.current = null;
    clientRef.current = null;
    previousController?.dispose();
    await previousFeed?.stop().catch(() => undefined);
    if (previousClient) {
      unregisterKernelClient(previousClient);
      previousClient.close();
    }

    // 重连入口也被「内核不可用」的状态重试复用：宿主不在时先按启动路径拉起
    // （服务优先，起不来回退进程内），否则 client 的请求只会全部失败。
    if (!kernelHostAvailable()) {
      const env = { ...((await kernelStartEnv()) ?? {}), ...(await providerKeysEnv()) };
      const startEnv = Object.keys(env).length > 0 ? env : undefined;
      let started = await startKernelHost(startEnv, { useService: KERNEL_MODE === "service" });
      if (!started && KERNEL_MODE === "service") {
        started = await startKernelHost(startEnv, { useService: false });
      }
      if (!started && !kernelHostAvailable()) {
        setStatusState({ code: "kernel_unavailable" });
        return;
      }
    }

    await loadMemoryPreferences();
    const client = new KernelSessionClient({
      transport: { sendLine: sendKernelLine, onLine: onKernelLine },
      runtimePreferences: () => ({
        nativeSearchEnhancementsEnabled: false,
        memoryEnabled: getCachedMemoryPreferences().enabled,
      }),
    });
    clientRef.current = client;
    registerKernelClient(client);
    await client.closeConnection().catch(() => undefined);
    await pushProviderKeys(client).catch((error: unknown) => {
      console.warn("[nibigo] 重连后下发 Provider key 失败", error);
    });
    const providerState = await fetchProviderState(client).catch(() => null);
    if (providerState?.default?.modelId) {
      setModelLabel(providerState.default.modelId);
    }
    try {
      let sessionId: string | null = null;
      const preferred = activeSessionIdRef.current;
      if (preferred) {
        rememberSessionSnapshot(await resumeWithMcpServers(client, preferred));
        sessionId = client.currentSessionId;
      }
      if (!sessionId) {
        const list = await refreshSessions(client);
        if (list.length > 0) {
          rememberSessionSnapshot(await resumeWithMcpServers(client, list[0]!.sessionId));
          sessionId = client.currentSessionId;
        } else {
          rememberSessionSnapshot(await createWithDefaultModel(client));
          sessionId = client.currentSessionId;
        }
      }
      if (!sessionId) throw new Error(pickText("没有可用会话", "No session available"));
      await attach(client, sessionId);
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      await refreshSessions(client);
      setReady(true);
      setStatusState({ code: "ready" });
    } catch (error) {
      if (isSetupRequiredError(error)) {
        setStatusState({ code: "setup_required" });
      } else {
        setStatusState({
          code: "reconnect_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [attach, refreshSessions]);

  useEffect(() => {
    if (KERNEL_MODE !== "service") return;
    return onKernelRestart((event) => {
      if (event.status === "restarting") {
        setStatusState({ code: "restarting" });
        setReady(false);
        // 旧内核的请求全部作废：先收掉旧 client/订阅，等 ready 再重建。
        const oldClient = clientRef.current;
        if (oldClient) unregisterKernelClient(oldClient);
        oldClient?.close();
        clientRef.current = null;
        controllerRef.current?.dispose();
        controllerRef.current = null;
        void feedRef.current?.stop().catch(() => undefined);
        feedRef.current = null;
        setRows([]);
        setTurn("idle");
        setPluginSlotData({});
        return;
      }
      void reconnect();
    });
  }, [reconnect]);

  const send = useCallback(
    async (text: string, options: KernelSendOptions = {}): Promise<boolean> => {
      const content = text.trim();
      const client = clientRef.current;
      const quotes = options.conversationQuotes ?? [];
      const pluginReferences = options.pluginReferences ?? [];
      const attachmentCount = options.attachments?.length ?? 0;
      if (
        (!content && quotes.length === 0 && attachmentCount === 0) ||
        !client ||
        client.currentSessionId === null
      ) {
        return false;
      }
      setSending(true);
      // 记下这次发送：失败后横幅「重试」原样重发；成功即清掉。
      lastSendRef.current = { text: content, options };
      const snapshot = controllerRef.current?.snapshot;
      const baselineRowId = snapshot
        ? snapshot.rows.window.reduce((max, row) => Math.max(max, row.rowId), 0)
        : 0;
      const pendingId = `p${pendingSeq.current++}`;
      pendingRef.current.push({
        id: pendingId,
        text: content,
        baselineRowId,
        ...(options.attachments && options.attachments.length > 0
          ? { attachments: options.attachments }
          : {}),
        ...(quotes.length > 0 ? { conversationQuotes: quotes } : {}),
        ...(pluginReferences.length > 0 ? { pluginReferences } : {}),
      });
      controllerRef.current?.setPending(
        pendingRef.current.map(
          ({ id, text: pendingText, attachments, conversationQuotes, pluginReferences: refs }) => ({
            id,
            text: pendingText,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
            ...(conversationQuotes && conversationQuotes.length > 0
              ? { conversationQuotes }
              : {}),
            ...(refs && refs.length > 0 ? { pluginReferences: refs } : {}),
          }),
        ),
      );
      try {
        await client.sendText(content, {
          ...(options.attachments && options.attachments.length > 0
            ? { attachments: options.attachments }
            : {}),
          ...(options.mode ? { mode: options.mode } : {}),
          ...(typeof options.planEnabled === "boolean"
            ? { planEnabled: options.planEnabled }
            : {}),
          ...(options.modelSelection ? { modelSelection: options.modelSelection } : {}),
          conversationQuotes: quotes,
          pluginReferences,
        });
        await refreshSessions(client);
        lastSendRef.current = null;
        return true;
      } catch (error) {
        // 发送失败时把乐观气泡收掉，避免它一直停在“发送中”。
        pendingRef.current = pendingRef.current.filter((entry) => entry.id !== pendingId);
        controllerRef.current?.setPending(
          pendingRef.current.map(
            ({ id, text: pendingText, attachments, conversationQuotes, pluginReferences: refs }) => ({
              id,
              text: pendingText,
              ...(attachments && attachments.length > 0 ? { attachments } : {}),
              ...(conversationQuotes && conversationQuotes.length > 0
                ? { conversationQuotes }
                : {}),
              ...(refs && refs.length > 0 ? { pluginReferences: refs } : {}),
            }),
          ),
        );
        setStatusState({
          code: "send_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        setSending(false);
      }
    },
    [refreshSessions],
  );

  /**
   * 压缩上下文（内核 `compact` 命令）。
   *
   * 不走发送链路：没有用户气泡，进度与结果由内核的 timelineMarker 行给出。
   */
  const compact = useCallback(async (): Promise<string | null> => {
    const client = clientRef.current;
    if (!client || client.currentSessionId === null) {
      return pickText("没有可以压缩的会话", "No session to compact");
    }
    try {
      await client.compact();
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatusState({
        code: "error",
        zhPrefix: "压缩失败：",
        enPrefix: "Compact failed: ",
        detail,
      });
      return `${pickText("压缩失败：", "Compact failed: ")}${detail}`;
    }
  }, []);

  /** 重试最后一轮（内核 `retryTurn`）；返回错误文案，成功为 null。 */
  const retryTurn = useCallback(
    async (target: { rowId: number; entityId: string }): Promise<string | null> => {
      const client = clientRef.current;
      if (!client || client.currentSessionId === null) {
        return pickText("没有可重试的会话", "No session to retry");
      }
      const snapshot = controllerRef.current?.snapshot;
      if (!snapshot) return pickText("会话还没准备好", "Session is not ready yet");
      try {
        await client.retryTurn(target, {
          revision: snapshot.revision,
          logEpoch: snapshot.logEpoch,
        });
        return null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatusState({
          code: "error",
          zhPrefix: "重试失败：",
          enPrefix: "Retry failed: ",
          detail,
        });
        return `${pickText("重试失败：", "Retry failed: ")}${detail}`;
      }
    },
    [],
  );

  /** 停止当前轮（内核 `stop` → `Command::Interrupt`）；空闲竞态的 noop 是良性结果。 */
  const stopTurn = useCallback(async (): Promise<string | null> => {
    const client = clientRef.current;
    if (!client || client.currentSessionId === null) return null;
    try {
      await client.stop();
      // 中断 ACK 之后对账一次：中断带来的行状态迁移如果丢了增量帧，快照重放自愈
      // （不救的话停止键永远卡住，输入也没法用——2026-11-21 真机复现）。
      setTimeout(() => {
        void feedRef.current?.resync(true);
      }, 3_000);
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatusState({
        code: "error",
        zhPrefix: "停止失败：",
        enPrefix: "Stop failed: ",
        detail,
      });
      return `${pickText("停止失败：", "Stop failed: ")}${detail}`;
    }
  }, []);

  // 运行中的陈旧看门狗：回合在跑但 90s 没有任何帧到达 → 疑似丢帧，强制对账。
  useEffect(() => {
    const timer = setInterval(() => {
      if (turn !== "running") return;
      const stale = feedRef.current?.staleMs();
      if (stale !== null && stale !== undefined && stale > 90_000) {
        void feedRef.current?.resync(true);
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [turn]);

  /**
   * 编辑并重发最后一条用户输入（内核 `editUserQuery`，CAS 提交）；返回错误文案，成功为 null。
   *
   * 只改正文：原行的附件/引用不随编辑重发（内核会整体重建这条输入），带附件/引用的行
   * 由 UI 挡掉。拒绝（不是最新输入/行过期）不抛异常，文案直接给横幅提示。
   */
  const editResend = useCallback(
    async (
      target: { rowId: number; entityId: string },
      newText: string,
    ): Promise<string | null> => {
      const client = clientRef.current;
      if (!client || client.currentSessionId === null) {
        return pickText("没有可编辑的会话", "No session to edit");
      }
      const snapshot = controllerRef.current?.snapshot;
      if (!snapshot) return pickText("会话还没准备好", "Session is not ready yet");
      const text = newText.trim();
      if (!text) return pickText("编辑后的内容不能为空", "Edited message cannot be empty");
      try {
        const result = await client.editUserQuery(target, text, {
          revision: snapshot.revision,
          logEpoch: snapshot.logEpoch,
        });
        if (!result.accepted) {
          const message =
            result.message ||
            pickText(
              "这条消息已不是最新输入，不能再编辑",
              "This message is no longer the latest input and cannot be edited",
            );
          setStatusState({
            code: "error",
            zhPrefix: "编辑重发被拒绝：",
            enPrefix: "Edit & resend rejected: ",
            detail: message,
          });
          return message;
        }
        return null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatusState({
          code: "error",
          zhPrefix: "编辑重发失败：",
          enPrefix: "Edit & resend failed: ",
          detail,
        });
        return `${pickText("编辑重发失败：", "Edit & resend failed: ")}${detail}`;
      }
    },
    [],
  );

  /**
   * 内核 `session/goal` 的回执是英文短句（`goal_summary` 里写死的），这里按当前语言呈现；
   * 认不出的原样返回，不吞信息。
   */
  function localizeGoalReply(response: string): string {
    const text = response.trim();
    if (text.startsWith("No goal is set")) {
      return pickText(
        "当前没有目标。用「目标」命令设定一个。",
        "No goal is set. Use the Goal command to set one.",
      );
    }
    const matched = /^Goal (active|achieved|paused|failed)\nObjective: ([\s\S]*)$/.exec(text);
    if (matched) {
      const label =
        matched[1] === "active"
          ? pickText("目标进行中", "Goal active")
          : matched[1] === "achieved"
            ? pickText("目标已达成", "Goal achieved")
            : matched[1] === "paused"
              ? pickText("目标已暂停", "Goal paused")
              : pickText("目标未达成", "Goal failed");
      const sep = pickText("：", ": ");
      return `${label}${sep}${matched[2]?.trim() ?? ""}`;
    }
    return text;
  }

  /**
   * 目标管理（内核 `session/goal`）。
   *
   * 返回内核的人读回执（show 时有目标/没目标都有一句），失败返回错误文案；`set` 会让内核
   * 自己开一轮，不需要再发一条消息。
   */
  const runGoal = useCallback(
    async (
      action: "show" | "set" | "pause" | "resume" | "clear",
      objective?: string,
    ): Promise<{ message: string; startedTurn: boolean }> => {
      const client = clientRef.current;
      if (!client || client.currentSessionId === null) {
        return { message: pickText("没有可操作的会话", "No active session"), startedTurn: false };
      }
      try {
        const result = await client.goal(action, objective);
        const reply = localizeGoalReply(result.response);
        return {
          message:
            reply ||
            (action === "set"
              ? pickText("目标已设置", "Goal set")
              : action === "clear"
                ? pickText("目标已清除", "Goal cleared")
                : pickText("已执行", "Done")),
          startedTurn: result.startedTurn,
        };
      } catch (error) {
        return {
          message: `${pickText("目标操作失败：", "Goal command failed: ")}${error instanceof Error ? error.message : String(error)}`,
          startedTurn: false,
        };
      }
    },
    [],
  );

  const newSession = useCallback(async (projectId?: string) => {
    const client = clientRef.current;
    if (!client) return;
    try {
      // 项目会话共享项目的 workspace 目录（记忆/文件/项目级 agents 都挂它）；
      // 不带项目沿用旧路径（每个会话独立目录）。目录建好再 create。
      const workspaceRef = projectId ? ensureProjectWorkspace(workspaceRoot(), projectId) : undefined;
      rememberSessionSnapshot(await createWithDefaultModel(client, workspaceRef));
      const sessionId = client.currentSessionId;
      if (!sessionId) return;
      await attach(client, sessionId);
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      await refreshSessions(client);
      // 首装未配 Provider 时 bootstrap 会停在 setup_required（ready=false）；用户配好服务
      // 回到首页再新建会话，会话已经真正建出来了，必须把 ready 一起拉回来——只改状态码
      // 会让输入框 editable 与发送键永久卡死在 false（0.1.7 真机复现）。
      setReady(true);
      setStatusState({ code: "ready" });
    } catch (error) {
      if (isSetupRequiredError(error)) {
        setStatusState({ code: "setup_required" });
      } else {
        setStatusState({
          code: "error",
          zhPrefix: "新建失败：",
          enPrefix: "Failed to create session: ",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [attach, refreshSessions]);

  const openSession = useCallback(
    async (sessionId: string) => {
      const client = clientRef.current;
      if (!client || sessionId === client.currentSessionId) return;
      try {
        rememberSessionSnapshot(await resumeWithMcpServers(client, sessionId));
        await attach(client, sessionId);
        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        // 与 newSession 同一条纪律：会话真的打开了就把 ready 置回真值。
        setReady(true);
        setStatusState({ code: "ready" });
      } catch (error) {
        setStatusState({
          code: "error",
          zhPrefix: "打开失败：",
          enPrefix: "Failed to open session: ",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [attach],
  );

  /** 归档集合的唯一写入口（ref + state + 落盘）。 */
  const persistArchived = useCallback(async (next: ReadonlySet<string>) => {
    archivedIdsRef.current = next;
    setArchivedIds(next);
    await saveArchivedSessionIds([...next]);
  }, []);

  const archiveSession = useCallback(
    async (sessionId: string) => {
      const next = new Set(archivedIdsRef.current);
      next.add(sessionId);
      await persistArchived(next);
    },
    [persistArchived],
  );

  const unarchiveSession = useCallback(
    async (sessionId: string) => {
      const next = new Set(archivedIdsRef.current);
      next.delete(sessionId);
      await persistArchived(next);
    },
    [persistArchived],
  );

  /** 切到最近一条可见会话（排除 excluded），没有就新建；删除当前会话前先让开。 */
  const openFallback = useCallback(
    async (client: KernelSessionClient, excluded?: string) => {
      const visible = (await refreshSessions(client)).filter(
        (session) => session.sessionId !== excluded,
      );
      if (visible.length > 0) rememberSessionSnapshot(await resumeWithMcpServers(client, visible[0]!.sessionId));
      else rememberSessionSnapshot(await createWithDefaultModel(client));
      const nextId = client.currentSessionId;
      if (!nextId) throw new Error(pickText("没有可用会话", "No session available"));
      await attach(client, nextId);
      activeSessionIdRef.current = nextId;
      setActiveSessionId(nextId);
      setReady(true);
      setStatusState({ code: "ready" });
    },
    [attach, refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const client = clientRef.current;
      if (!client) {
        throw new Error(pickText("内核会话客户端不可用", "Kernel session client unavailable"));
      }
      // purge 会整棵保留「运行中」的会话；当前会话先让开。
      if (activeSessionIdRef.current === sessionId) {
        try {
          await openFallback(client, sessionId);
        } catch (error) {
          throw new Error(
            `${pickText("切换会话失败：", "Failed to switch session: ")}${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // 记录真实 workspace：旧会话是 filesDir（不会被回收），新会话是 workspaces/<id>。
      const workspacePath = sessionWorkspacesRef.current.get(sessionId)?.workspacePath;
      // 先软删（中断并关闭内核里打开着的会话），再彻底删行与文件。
      await client.deleteSession(sessionId);
      const purged = await client.purgeSessionData([sessionId]);
      const failure = purged.failed.find((item) => item.sessionId === sessionId);
      if (failure) {
        throw new Error(
          pickText(`删除失败（${failure.code}）`, `Delete failed (${failure.code})`),
        );
      }
      if (purged.kept.some((item) => item.sessionId === sessionId)) {
        throw new SessionKeptError();
      }
      // 会话行与内核文件删掉后再回收 workspace 与临时目录；失败只记日志，不把删除报成失败。
      try {
        removeSessionWorkspace(workspaceRoot(), workspacePath);
        removeSessionTempDir(workspaceCacheRoot(), sessionId);
      } catch (error) {
        console.warn("[nibigo] 回收会话目录失败", error);
      }
      sessionWorkspacesRef.current.delete(sessionId);
      if (archivedIdsRef.current.has(sessionId)) {
        const next = new Set(archivedIdsRef.current);
        next.delete(sessionId);
        await persistArchived(next);
      }
      await refreshSessions(client);
      return purged.deleted.find((item) => item.sessionId === sessionId)?.bytes ?? 0;
    },
    [openFallback, persistArchived, refreshSessions],
  );

  const deleteAllArchived = useCallback(async () => {
    let succeeded = 0;
    let failed = 0;
    let kept = 0;
    let bytes = 0;
    for (const sessionId of [...archivedIdsRef.current]) {
      try {
        bytes += await deleteSession(sessionId);
        succeeded += 1;
      } catch (error) {
        // 「运行中/被引用」不算失败：内核整棵保留，归档状态也保留。
        if (error instanceof SessionKeptError) kept += 1;
        else failed += 1;
      }
    }
    return { succeeded, failed, kept, bytes };
  }, [deleteSession]);

  const respondInteraction = useCallback(
    async (interactionId: string, answer: Record<string, unknown>) => {
      const client = clientRef.current;
      if (!client) return;
      try {
        await client.resolveInteraction(interactionId, answer);
      } catch (error) {
        setStatusState({
          code: "error",
          zhPrefix: "回答失败：",
          enPrefix: "Response failed: ",
          detail: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [],
  );

  // 状态横幅分类完全按结构化 statusState.code 判断，不再依赖中文字符串前缀匹配。
  const setupIssue = statusState.code === "setup_required";
  const statusKind = useMemo<"ok" | "busy" | "error">(() => {
    if (statusState.code === "ready") return "ok";
    if (statusState.code === "init" || statusState.code === "restarting") return "busy";
    return "error";
  }, [statusState.code]);
  const statusRetryable = useMemo(
    () =>
      statusState.code === "send_failed" ||
      statusState.code === "reconnect_failed" ||
      statusState.code === "init_failed" ||
      statusState.code === "kernel_unavailable",
    [statusState.code],
  );
  /** 状态横幅的「重试」：发送失败原样重发；初始化/重连/配置缺失统一走 reconnect（内部会先拉起宿主）。 */
  const retryStatus = useCallback(async () => {
    if (statusState.code === "send_failed") {
      const last = lastSendRef.current;
      if (last) await send(last.text, last.options);
      return;
    }
    if (
      statusState.code === "setup_required" ||
      statusState.code === "reconnect_failed" ||
      statusState.code === "init_failed" ||
      statusState.code === "kernel_unavailable"
    ) {
      await reconnect();
    }
  }, [statusState.code, send, reconnect]);

  return {
    rows,
    turn,
    status,
    statusKind,
    setupIssue,
    statusRetryable,
    retryStatus,
    modelLabel,
    currentModelSelection,
    sessionMode,
    sessionPlanEnabled,
    contextUsage,
    ready,
    sending,
    sessions,
    archivedSessions,
    activeSessionId,
    send,
    stopTurn,
    editResend,
    compact,
    retryTurn,
    runGoal,
    newSession,
    openSession,
    archiveSession,
    unarchiveSession,
    deleteSession,
    deleteAllArchived,
    respondInteraction,
    turnChanges,
    skills,
    pluginSlotData,
  };
}
