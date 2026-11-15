// 首页即会话（D2）：内核会话状态。
//
// 数据流对齐 dsh-Go：订阅 V4 会话投影（snapshot + row.delta），行模型由快照派生；
// 不再轮询 session/messages。dev 下没有真实 Provider 时按本机 mock 模型启动。
import { Paths } from "expo-file-system";
import {
  ConversationController,
  ConversationFeed,
  KernelSessionClient,
  type ChatFileChange,
  type ChatRow,
  type KernelSessionSummary,
  type KernelWorkspaceRef,
  type TurnState,
} from "@nibi-go/kernel-session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import {
  kernelHostAvailable,
  onKernelLine,
  onKernelRestart,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

import { loadArchivedSessionIds, saveArchivedSessionIds } from "./archiveStore";
import { splitSessions } from "./sessionArchive";

const DEV_MOCK_ENV = {
  NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
  NIBI_API_KEY: "mock-key",
  NIBI_MODEL: "mock-model",
};

/**
 * D20 承载模式：默认 `:kernel` 进程（前台服务，UI 死掉内核仍在）；
 * `EXPO_PUBLIC_NIBI_KERNEL_MODE=inprocess` 可强制退回进程内做对照。
 * 服务启动失败时自动回退进程内，保证首页不空。
 */
const KERNEL_MODE = process.env.EXPO_PUBLIC_NIBI_KERNEL_MODE === "inprocess" ? "inprocess" : "service";

function workspaceRef(): KernelWorkspaceRef {
  const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
  return { workspacePath, workspaceKey: workspacePath };
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

export interface KernelConversation {
  rows: readonly ChatRow[];
  turn: TurnState;
  status: string;
  ready: boolean;
  sending: boolean;
  /** 未归档的会话（抽屉主列表）。 */
  sessions: readonly KernelSessionSummary[];
  /** 已归档的会话（归档管理）；归档是 GO 本地的会话管理状态，不写内核。 */
  archivedSessions: readonly KernelSessionSummary[];
  activeSessionId: string | null;
  send: (text: string) => Promise<void>;
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
}

export function useKernelConversation(): KernelConversation {
  const [rows, setRows] = useState<readonly ChatRow[]>([]);
  const [turn, setTurn] = useState<TurnState>("idle");
  const [status, setStatus] = useState("初始化…");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  // 内核返回的全部顶层会话（含已归档）；列表按本地归档集合拆成两份。
  const [allSessions, setAllSessions] = useState<readonly KernelSessionSummary[]>([]);
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(new Set());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [turnChanges, setTurnChanges] = useState<Record<string, readonly ChatFileChange[]>>({});
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
  const pendingRef = useRef<Array<{ id: string; text: string; baselineRowId: number }>>([]);
  const pendingSeq = useRef(1);

  const syncPending = useCallback((controller: ConversationController) => {
    const snapshot = controller.snapshot;
    if (!snapshot) return;
    const remaining = pendingRef.current.filter(
      (entry) =>
        !snapshot.rows.window.some(
          (row) => row.kind === "userInput" && row.text === entry.text && row.rowId > entry.baselineRowId,
        ),
    );
    if (remaining.length !== pendingRef.current.length) {
      pendingRef.current = remaining;
      controller.setPending(remaining.map(({ id, text }) => ({ id, text })));
    }
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
      syncPending(controller);
      syncTurnChanges(controller);
    });
    feedRef.current = feed;
    controllerRef.current = controller;
    pendingRef.current = [];
    controller.setPending([]);
    requestedChanges.current.clear();
    setTurnChanges({});
    await feed.start(sessionId);
    setRows([]);
    setTurn("idle");
  }, [syncTurnChanges]);

  const refreshSessions = useCallback(async (client: KernelSessionClient) => {
    try {
      const list = await client.listSessions();
      const topLevel = list
        .filter((session) => !session.parentSessionId)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setAllSessions(topLevel);
      return splitSessions(topLevel, archivedIdsRef.current).visible;
    } catch {
      return [];
    }
  }, []);

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
        const env = __DEV__ ? DEV_MOCK_ENV : undefined;
        let started = await startKernelHost(env, { useService: KERNEL_MODE === "service" });
        if (!started && KERNEL_MODE === "service") {
          // 前台服务起不来（后台启动限制/机型差异）时回退进程内，首页不能空。
          console.warn("[nibigo] :kernel 服务启动失败，回退进程内");
          started = await startKernelHost(env, { useService: false });
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

        const list = await refreshSessions(client);
        if (cancelled) return;
        // 启动恢复「最近一条有消息的会话」；全空则停在最新一条，不每次多建。
        let opened = false;
        for (const candidate of list.slice(0, 3)) {
          await client.resumeSession(candidate.sessionId);
          const messages = await client.readMessages({ limit: 1 });
          if (messages.length > 0) {
            opened = true;
            break;
          }
        }
        if (!opened) {
          if (list.length > 0) await client.resumeSession(list[0]!.sessionId);
          else await client.createSession(workspaceRef());
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
    try {
      let sessionId: string | null = null;
      const preferred = activeSessionIdRef.current;
      if (preferred) {
        await client.resumeSession(preferred);
        sessionId = client.currentSessionId;
      }
      if (!sessionId) {
        const list = await refreshSessions(client);
        if (list.length > 0) {
          await client.resumeSession(list[0]!.sessionId);
          sessionId = client.currentSessionId;
        } else {
          await client.createSession(workspaceRef());
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
        return;
      }
      void reconnect();
    });
  }, [reconnect]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      const client = clientRef.current;
      if (!content || !client || client.currentSessionId === null) return;
      setSending(true);
      const snapshot = controllerRef.current?.snapshot;
      const baselineRowId = snapshot
        ? snapshot.rows.window.reduce((max, row) => Math.max(max, row.rowId), 0)
        : 0;
      pendingRef.current.push({
        id: `p${pendingSeq.current++}`,
        text: content,
        baselineRowId,
      });
      controllerRef.current?.setPending(
        pendingRef.current.map(({ id, text }) => ({ id, text })),
      );
      try {
        await client.sendPrompt(content);
        await refreshSessions(client);
      } catch (error) {
        setStatus(`发送失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setSending(false);
      }
    },
    [refreshSessions],
  );

  const newSession = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.createSession(workspaceRef());
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
        await client.resumeSession(sessionId);
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
      if (visible.length > 0) await client.resumeSession(visible[0]!.sessionId);
      else await client.createSession(workspaceRef());
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
      // 先软删（中断并关闭内核里打开着的会话），再彻底删行与文件。
      await client.deleteSession(sessionId);
      const purged = await client.purgeSessionData([sessionId]);
      const failure = purged.failed.find((item) => item.sessionId === sessionId);
      if (failure) throw new Error(`删除失败（${failure.code}）`);
      if (purged.kept.some((item) => item.sessionId === sessionId)) {
        throw new Error("会话正在运行或被引用，暂时不能删除");
      }
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
    ready,
    sending,
    sessions,
    archivedSessions,
    activeSessionId,
    send,
    newSession,
    openSession,
    archiveSession,
    unarchiveSession,
    deleteSession,
    deleteAllArchived,
    respondInteraction,
    turnChanges,
  };
}
