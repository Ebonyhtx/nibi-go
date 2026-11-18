// 会话里切换模型用的 Provider 目录：providers + 每个模型的生效能力。
//
// 设置页写的是同一份 provider_config.json；首页聚焦时重读，保存后回来就能看到新模型。
// 独立 client 不碰会话，避免和 useKernelConversation 的连接生命周期耦合。

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { KernelSessionClient } from "@nibi-go/kernel-session";
import {
  kernelHostAvailable,
  onKernelLine,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

import {
  fetchProviderState,
  type ProviderState,
} from "./providerSettings";
import { kernelStartEnv } from "./kernelEnv";
import { providerKeysEnv } from "./providerKeys";

export function useProviderCatalog(): {
  state: ProviderState;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [state, setState] = useState<ProviderState>({ providers: [], presets: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<KernelSessionClient | null>(null);
  const cancelledRef = useRef(false);

  const ensureClient = useCallback(async (): Promise<KernelSessionClient | null> => {
    if (clientRef.current) return clientRef.current;
    const env = { ...((await kernelStartEnv()) ?? {}), ...(await providerKeysEnv()) };
    const started =
      (await startKernelHost(Object.keys(env).length > 0 ? env : undefined, {
        useService: true,
      })) ||
      (await startKernelHost(Object.keys(env).length > 0 ? env : undefined, {
        useService: false,
      }));
    if (!started && !kernelHostAvailable()) return null;
    const client = new KernelSessionClient({
      transport: { sendLine: sendKernelLine, onLine: onKernelLine },
      requestTimeoutMs: 60_000,
    });
    clientRef.current = client;
    return client;
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = await ensureClient();
      if (!client) throw new Error("内核不可用");
      const next = await fetchProviderState(client);
      if (!cancelledRef.current) setState(next);
    } catch (cause) {
      if (!cancelledRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [ensureClient]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  return { state, loading, error, reload };
}