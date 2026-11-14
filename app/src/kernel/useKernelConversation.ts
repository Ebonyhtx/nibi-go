// 首页即会话（D2：会话即首页）的内核侧状态：启动内核、建会话、收发、通知。
//
// 只做“把 kernel-session 接到 React 状态”这一层；行模型与协议都在 @nibi-go/kernel-session。
// dev 下没有真实 Provider 时按本机 mock 模型启动（scripts/dev/mock-openai.mjs）。
import { Paths } from "expo-file-system";
import {
  ConversationController,
  KernelSessionClient,
  type ConversationRow,
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

export interface KernelConversation {
  rows: readonly ConversationRow[];
  turn: TurnState;
  status: string;
  ready: boolean;
  sending: boolean;
  send: (text: string) => Promise<void>;
  newSession: () => Promise<void>;
}

export function useKernelConversation(): KernelConversation {
  const [rows, setRows] = useState<readonly ConversationRow[]>([]);
  const [turn, setTurn] = useState<TurnState>("idle");
  const [status, setStatus] = useState("初始化…");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
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
        const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
        await client.createSession({ workspacePath, workspaceKey: workspacePath });
        if (cancelled) return;
        const controller = attachController(client);
        await controller.refresh();
        if (!cancelled) {
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
  }, [attachController]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    const client = clientRef.current;
    if (!content || !client || client.currentSessionId === null) return;
    setSending(true);
    try {
      await client.sendPrompt(content);
      await controllerRef.current?.refresh();
    } catch (error) {
      setStatus(`发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  }, []);

  const newSession = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
      setRows([]);
      setTurn("idle");
      await client.createSession({ workspacePath, workspaceKey: workspacePath });
      const controller = attachController(client);
      await controller.refresh();
      setStatus("就绪");
    } catch (error) {
      setStatus(`新建失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [attachController]);

  return { rows, turn, status, ready, sending, send, newSession };
}
