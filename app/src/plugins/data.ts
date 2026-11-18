// 插件槽的宿主数据（`data.host`）：本机事实，不含凭据/会话正文。
//
// 面板和工具卡都能绑定这些字段。远端主机会话在 contract 层已经被摘掉槽，这里不需要
// 区分远端（`host` 恒为 local）。

import { APP_CAPABILITIES, type SlotData } from "@nibi-go/plugin-contract";
import Constants from "expo-constants";
import { Platform } from "react-native";

export interface HostDataOptions {
  enabledPlugins: number;
  plugin?: { id: string; name: string; version: string };
  session?: { title?: string; model?: string; rows?: number };
  /** 插件设置在槽里的绑定：`data.host.settings.*`。 */
  settings?: Record<string, string | boolean>;
  /** 插件随工具结果推给槽的数据（`_meta.nibiGo.push`），槽里绑定 `data.push.*`。 */
  push?: Record<string, unknown>;
}

export function hostSlotData(options: HostDataOptions): SlotData {
  const now = new Date();
  return {
    data: {
      ...(options.push ? { push: options.push } : {}),
      host: {
        appVersion: Constants.expoConfig?.version ?? "0.0.0",
        host: "local",
        platform: Platform.OS,
        now: `${now.toISOString().replace("T", " ").slice(0, 19)} UTC`,
        capabilities: [...APP_CAPABILITIES],
        enabledPlugins: options.enabledPlugins,
        ...(options.settings ? { settings: options.settings } : {}),
        ...(options.plugin
          ? {
              plugin: options.plugin,
              pluginName: options.plugin.name,
              pluginVersion: options.plugin.version,
            }
          : {}),
        ...(options.session ? { session: options.session } : {}),
      },
    },
  };
}

/** 工具卡的 `data.tool`：MCP display + 行上的输出（都做安全解析）。 */
export function toolSlotData(options: {
  host: SlotData;
  name: string;
  server?: string;
  status: string;
  structuredContent?: string;
  widgetMeta?: string;
  text?: string;
  error?: string;
}): SlotData {
  const parse = (raw: string | undefined): unknown => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const host = (options.host.data.host as Record<string, unknown> | undefined) ?? {};
  return {
    data: {
      host,
      tool: {
        name: options.name,
        server: options.server ?? "",
        status: options.status,
        structured: parse(options.structuredContent) ?? {},
        meta: parse(options.widgetMeta) ?? {},
        text: options.text ?? "",
        error: options.error ?? "",
      },
    },
  };
}
