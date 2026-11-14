// 首页即会话（D2）：内核会话状态。
//
// 数据流对齐 dsh-Go：订阅 V4 会话投影（snapshot + row.delta），行模型由快照派生；
// 不再轮询 session/messages。dev 下没有真实 Provider 时按本机 mock 模型启动。
import { Paths } from "expo-file-system";
import {
  ConversationController,
  ConversationFeed,
  KernelSessionClient,
  type ChatRow,
  type KernelSessionSummary,
  type KernelWorkspaceRef,
  type TurnState,
} from "@nibi-go/kernel-session";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  kernelHostAvailable,
  onKernelLine,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

const DEV_MOCK_ENV = {
  NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
  NIBI_API_KEY: "mock-key",
  NIBI_MODEL: "mock-model",
};

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
}

export function useKernelConversation(): KernelConversation {
  const [rows, setRows] = useState<readonly ChatRow[]>([]);
  const [turn, setTurn] = useState<TurnState>("idle");
  const [status, setStatus] = useState("初始化…");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [sessions, setSessions] = useState<readonly KernelSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const clientRef = useRef<KernelSessionClient | null>(null);
  const feedRef = useRef<ConversationFeed | null>(null);
  const controllerRef = useRef<ConversationController | null>(null);
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
    });
    feedRef.current = feed;
    controllerRef.current = controller;
    pendingRef.current = [];
    controller.setPending([]);
    await feed.start(sessionId);
    setRows([]);
    setTurn("idle");
  }, []);

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
        const started = await startKernelHost(__DEV__ ? DEV_MOCK_ENV : undefined);
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
        setActiveSessionId(sessionId);
        setStatus("就绪");
      } catch (error) {
        setStatus(`打开失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [attach],
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
  };
}
