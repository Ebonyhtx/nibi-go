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
import { useCallback, useEffect, useRef, useState } from "react";

import {
  kernelHostAvailable,
  onKernelLine,
  onKernelRestart,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

const DEV_MOCK_ENV = {
  NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
  NIBI_API_KEY: "mock-key",
  NIBI_MODEL: "mock-model",
};

/**
 * D20 承载模式：`EXPO_PUBLIC_NIBI_KERNEL_MODE=service` 时内核跑在 `:kernel` 进程；
 * 默认仍是进程内（先保住现有行为，服务模式真机验收后再翻默认）。
 */
const USE_KERNEL_SERVICE = process.env.EXPO_PUBLIC_NIBI_KERNEL_MODE === "service";

function workspaceRef(): KernelWorkspaceRef {
  const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
  return { workspacePath, workspaceKey: workspacePath };
}

export interface KernelConversation {
  rows: readonly ChatRow[];
  turn: TurnState;
  status: string;
  ready: boolean;
  sending: boolean;
  sessions: readonly KernelSessionSummary[];
  activeSessionId: string | null;
  send: (text: string) => Promise<void>;
  newSession: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
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
  const [sessions, setSessions] = useState<readonly KernelSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [turnChanges, setTurnChanges] = useState<Record<string, readonly ChatFileChange[]>>({});
  // 已经请求过明细的轮（stale 水位时才允许重试；其他失败不反复打内核）。
  const requestedChanges = useRef(new Set<string>());
  const clientRef = useRef<KernelSessionClient | null>(null);
  const feedRef = useRef<ConversationFeed | null>(null);
  const controllerRef = useRef<ConversationController | null>(null);
  // 重启重连时用来恢复「当前这条会话」（state 在回调里会过期）。
  const activeSessionIdRef = useRef<string | null>(null);
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
      const visible = list
        .filter((session) => !session.parentSessionId)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setSessions(visible);
      return visible;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const started = await startKernelHost(__DEV__ ? DEV_MOCK_ENV : undefined, {
          useService: USE_KERNEL_SERVICE,
        });
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
    if (!USE_KERNEL_SERVICE) return;
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
    activeSessionId,
    send,
    newSession,
    openSession,
    respondInteraction,
    turnChanges,
  };
}
