// 首页即会话（D2：会话即首页）的内核侧状态：启动内核、列/建/恢复会话、收发、通知。
//
// 只做“把 kernel-session 接到 React 状态”这一层；行模型与协议都在 @nibi-go/kernel-session。
// dev 下没有真实 Provider 时按本机 mock 模型启动（scripts/dev/mock-openai.mjs）。
import { Paths } from "expo-file-system";
import {
  ConversationController,
  KernelSessionClient,
  type ConversationRow,
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
  rows: readonly ConversationRow[];
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
  const [rows, setRows] = useState<readonly ConversationRow[]>([]);
  const [turn, setTurn] = useState<TurnState>("idle");
  const [status, setStatus] = useState("初始化…");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [sessions, setSessions] = useState<readonly KernelSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const clientRef = useRef<KernelSessionClient | null>(null);
  const controllerRef = useRef<ConversationController | null>(null);

  const attachController = useCallback((client: KernelSessionClient) => {
    controllerRef.current?.dispose();
    const controller = new ConversationController(client);
    controller.subscribe(() => {
      setRows([...controller.rows]);
      setTurn(controller.turn);
    });
    controllerRef.current = controller;
    return controller;
  }, []);

  const refreshSessions = useCallback(async (client: KernelSessionClient) => {
    try {
      // 不按 workspace 过滤：内核的 workspaceKey 比较是精确串（目录尾斜杠会不相等），
      // 单工作区阶段先列全部、客户端按 updatedAt 排序；多工作区时再按规范化路径过滤。
      const list = await client.listSessions();
      const visible = list
        .filter((session) => !session.parentSessionId)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setSessions(visible);
      return visible;
    } catch {
      // 列表读失败不该打断会话本身。
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
        // 启动时恢复「最近一条有消息的会话」；全是空会话就停在最新那条，不每次多建。
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
        if (cancelled) return;
        const controller = attachController(client);
        await controller.refresh();
        if (!cancelled) {
          setActiveSessionId(client.currentSessionId);
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
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [attachController, refreshSessions]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      const client = clientRef.current;
      if (!content || !client || client.currentSessionId === null) return;
      setSending(true);
      try {
        await client.sendPrompt(content);
        await controllerRef.current?.refresh();
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
      setRows([]);
      setTurn("idle");
      await client.createSession(workspaceRef());
      const controller = attachController(client);
      await controller.refresh();
      setActiveSessionId(client.currentSessionId);
      await refreshSessions(client);
      setStatus("就绪");
    } catch (error) {
      setStatus(`新建失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [attachController, refreshSessions]);

  const openSession = useCallback(
    async (sessionId: string) => {
      const client = clientRef.current;
      if (!client || sessionId === client.currentSessionId) return;
      try {
        setRows([]);
        setTurn("idle");
        await client.resumeSession(sessionId);
        const controller = attachController(client);
        await controller.refresh();
        setActiveSessionId(sessionId);
        setStatus("就绪");
      } catch (error) {
        setStatus(`打开失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [attachController],
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
