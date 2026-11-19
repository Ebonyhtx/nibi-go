// 首页即会话（D2）：内核会话状态。
//
// 数据流对齐 dsh-Go：订阅 V4 会话投影（snapshot + row.delta），行模型由快照派生；
// 不再轮询 session/messages。dev 下没有真实 Provider 时按本机 mock 模型启动。
import { Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
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
import { AppState, PermissionsAndroid, Platform } from "react-native";

import {
  kernelHostAvailable,
  onKernelLine,
  onKernelRestart,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

import { loadArchivedSessionIds, saveArchivedSessionIds } from "./archiveStore";
import { kernelStartEnv } from "./kernelEnv";
import { providerKeysEnv, pushProviderKeys } from "./providerKeys";
import { fetchProviderState } from "./providerSettings";
import { splitSessions } from "./sessionArchive";
import { documentRootOf, legacyWorkspaceRef } from "./workspace";
import {
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

async function createWithDefaultModel(client: KernelSessionClient) {
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
  if (!model) throw new Error("没有可用的默认模型：请先在设置里配置 Provider");
  // 会话 ID 由 Host 先生成：workspace 目录名要用它，而内核在 create 之后才返回 ID。
  // deferred：未发过消息的「新对话」不落库、不进会话抽屉（内核首条输入时才提升为正式会话）。
  const sessionId = Crypto.randomUUID();
  const workspace = ensureSessionWorkspace(workspaceRoot(), sessionId);
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
  /** 顶栏显示的当前默认模型（设置页的 `defaultModelSelection.modelId`）。 */
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
    breakdown: readonly { source: string; chars: number }[];
  } | null;
  ready: boolean;
  sending: boolean;
  /** 未归档的会话（抽屉主列表）。 */
  sessions: readonly KernelSessionSummary[];
  /** 已归档的会话（归档管理）；归档是 GO 本地的会话管理状态，不写内核。 */
  archivedSessions: readonly KernelSessionSummary[];
  activeSessionId: string | null;
  send: (text: string, options?: KernelSendOptions) => Promise<void>;
  /** 压缩上下文（内核 `compact`）；返回错误文案，成功为 null。 */
  compact: () => Promise<string | null>;
  /** 重试最后一轮（内核 `retryTurn`）；返回错误文案，成功为 null。 */
  retryTurn: (target: { rowId: number; entityId: string }) => Promise<string | null>;
  /** 目标管理（内核 `session/goal`）：show/set/pause/resume/clear。 */
  runGoal: (
    action: "show" | "set" | "pause" | "resume" | "clear",
    objective?: string,
  ) => Promise<{ message: string; startedTurn: boolean }>;
  newSession: () => Promise<void>;
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

export function useKernelConversation(): KernelConversation {
  const [rows, setRows] = useState<readonly ChatRow[]>([]);
  const [turn, setTurn] = useState<TurnState>("idle");
  const [status, setStatus] = useState("初始化…");
  const [modelLabel, setModelLabel] = useState("未配置模型");
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
    const fallbackHitRate =
      cumulative && cumulative.inputTokens > 0
        ? cumulative.cacheReadTokens / cumulative.inputTokens
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
    setContextUsage({
      usedTokens: usage.usedTokens,
      maxTokens: usage.maxTokens,
      cacheHitRate: usage.cache?.hitRate ?? fallbackHitRate,
      breakdown,
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
    controller.subscribe(() => {
      setRows([...controller.rows]);
      setTurn(controller.turn);
      setPluginSlotData(controller.pluginSlots);
      syncContextUsage(controller);
      syncPending(controller);
      syncTurnChanges(controller);
    });
    feedRef.current = feed;
    controllerRef.current = controller;
    pendingRef.current = [];
    controller.setPending([]);
    requestedChanges.current.clear();
    setTurnChanges({});
    setPluginSlotData({});
    await feed.start(sessionId);
    setRows([]);
    setTurn("idle");
    setContextUsage(null);
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
        setStatus("就绪");
      } catch (error) {
        setStatus(`刷新手机工具失败：${error instanceof Error ? error.message : String(error)}`);
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
          setStatus("内核不可用");
          return;
        }
        const client = new KernelSessionClient({
          transport: { sendLine: sendKernelLine, onLine: onKernelLine },
        });
        clientRef.current = client;
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
          setStatus("就绪");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(`失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
      controllerRef.current?.dispose();
      controllerRef.current = null;
      void feedRef.current?.stop().catch(() => undefined);
      feedRef.current = null;
      clientRef.current?.close();
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
    previousClient?.close();

    const client = new KernelSessionClient({
      transport: { sendLine: sendKernelLine, onLine: onKernelLine },
    });
    clientRef.current = client;
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
      if (!sessionId) throw new Error("没有可用会话");
      await attach(client, sessionId);
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      await refreshSessions(client);
      setReady(true);
      setStatus("就绪");
    } catch (error) {
      setStatus(`内核重连失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [attach, refreshSessions]);

  useEffect(() => {
    if (KERNEL_MODE !== "service") return;
    return onKernelRestart((event) => {
      if (event.status === "restarting") {
        setStatus("内核重启中…");
        setReady(false);
        // 旧内核的请求全部作废：先收掉旧 client/订阅，等 ready 再重建。
        clientRef.current?.close();
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
    async (text: string, options: KernelSendOptions = {}) => {
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
        return;
      }
      setSending(true);
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
        setStatus(`发送失败：${error instanceof Error ? error.message : String(error)}`);
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
    if (!client || client.currentSessionId === null) return "没有可以压缩的会话";
    try {
      await client.compact();
      return null;
    } catch (error) {
      const message = `压缩失败：${error instanceof Error ? error.message : String(error)}`;
      setStatus(message);
      return message;
    }
  }, []);

  /** 重试最后一轮（内核 `retryTurn`）；返回错误文案，成功为 null。 */
  const retryTurn = useCallback(
    async (target: { rowId: number; entityId: string }): Promise<string | null> => {
      const client = clientRef.current;
      if (!client || client.currentSessionId === null) return "没有可重试的会话";
      const snapshot = controllerRef.current?.snapshot;
      if (!snapshot) return "会话还没准备好";
      try {
        await client.retryTurn(target, {
          revision: snapshot.revision,
          logEpoch: snapshot.logEpoch,
        });
        return null;
      } catch (error) {
        const message = `重试失败：${error instanceof Error ? error.message : String(error)}`;
        setStatus(message);
        return message;
      }
    },
    [],
  );

  /**
   * 内核 `session/goal` 的回执是英文短句（`goal_summary` 里写死的），这里按同一组格式
   * 换成中文；认不出的原样返回，不吞信息。
   */
function localizeGoalReply(response: string): string {
  const text = response.trim();
  if (text.startsWith("No goal is set")) return "当前没有目标。用「目标」命令设定一个。";
  const matched = /^Goal (active|achieved|paused|failed)\nObjective: ([\s\S]*)$/.exec(text);
  if (matched) {
    const label =
      matched[1] === "active"
        ? "目标进行中"
        : matched[1] === "achieved"
          ? "目标已达成"
          : matched[1] === "paused"
            ? "目标已暂停"
            : "目标未达成";
    return `${label}：${matched[2]?.trim() ?? ""}`;
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
        return { message: "没有可操作的会话", startedTurn: false };
      }
      try {
        const result = await client.goal(action, objective);
        const reply = localizeGoalReply(result.response);
        return {
          message:
            reply || (action === "set" ? "目标已设置" : action === "clear" ? "目标已清除" : "已执行"),
          startedTurn: result.startedTurn,
        };
      } catch (error) {
        return {
          message: `目标操作失败：${error instanceof Error ? error.message : String(error)}`,
          startedTurn: false,
        };
      }
    },
    [],
  );

  const newSession = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      rememberSessionSnapshot(await createWithDefaultModel(client));
      const sessionId = client.currentSessionId;
      if (!sessionId) return;
      await attach(client, sessionId);
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      await refreshSessions(client);
      setStatus("就绪");
    } catch (error) {
      setStatus(`新建失败：${error instanceof Error ? error.message : String(error)}`);
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
        setStatus("就绪");
      } catch (error) {
        setStatus(`打开失败：${error instanceof Error ? error.message : String(error)}`);
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
      if (!nextId) throw new Error("没有可用会话");
      await attach(client, nextId);
      activeSessionIdRef.current = nextId;
      setActiveSessionId(nextId);
      setReady(true);
      setStatus("就绪");
    },
    [attach, refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const client = clientRef.current;
      if (!client) throw new Error("内核会话客户端不可用");
      // purge 会整棵保留「运行中」的会话；当前会话先让开。
      if (activeSessionIdRef.current === sessionId) {
        try {
          await openFallback(client, sessionId);
        } catch (error) {
          throw new Error(
            `切换会话失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // 记录真实 workspace：旧会话是 filesDir（不会被回收），新会话是 workspaces/<id>。
      const workspacePath = sessionWorkspacesRef.current.get(sessionId)?.workspacePath;
      // 先软删（中断并关闭内核里打开着的会话），再彻底删行与文件。
      await client.deleteSession(sessionId);
      const purged = await client.purgeSessionData([sessionId]);
      const failure = purged.failed.find((item) => item.sessionId === sessionId);
      if (failure) throw new Error(`删除失败（${failure.code}）`);
      if (purged.kept.some((item) => item.sessionId === sessionId)) {
        throw new Error("会话正在运行或被引用，暂时不能删除");
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
        if (error instanceof Error && error.message.includes("被引用")) kept += 1;
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
        setStatus(`回答失败：${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },
    [],
  );

  return {
    rows,
    turn,
    status,
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
