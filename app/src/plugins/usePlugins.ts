// 插件宿主的 React 入口：读落盘清单/启停状态，页面聚焦时刷新。

import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  enabledPlugins as filterEnabled,
  loadPlugins,
  setPluginEnabled,
  setPluginSetting,
  type LoadedPlugin,
} from "./store";

export interface PluginsState {
  plugins: readonly LoadedPlugin[];
  /** 已启用且可用的插件（槽只用这一份）。 */
  enabled: readonly LoadedPlugin[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<readonly LoadedPlugin[]>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  setSetting: (id: string, key: string, value: string | boolean) => Promise<void>;
}

export function usePlugins(): PluginsState {
  const [plugins, setPlugins] = useState<readonly LoadedPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async (): Promise<readonly LoadedPlugin[]> => {
    const current = ++seq.current;
    setLoading(true);
    try {
      const next = await loadPlugins();
      if (seq.current === current) {
        setPlugins(next);
        setError(null);
      }
      return next;
    } catch (cause) {
      if (seq.current === current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      return [];
    } finally {
      if (seq.current === current) setLoading(false);
    }
  }, []);

  // 从插件中心返回首页时重新读启停状态（新会话会用新配置）。
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await setPluginEnabled(id, enabled);
      await reload();
    },
    [reload],
  );

  const enabled = useMemo(() => filterEnabled(plugins), [plugins]);

  // 设置保存后重读：MCP 服务器在下一个会话拿到新的启动 env，槽里的 `data.host.settings` 也同步。
  const setSetting = useCallback(
    async (id: string, key: string, value: string | boolean) => {
      await setPluginSetting(id, key, value);
      await reload();
    },
    [reload],
  );

  return { plugins, enabled, loading, error, reload, setEnabled, setSetting };
}
