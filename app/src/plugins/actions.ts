// 插件效果执行器：契约层只做白名单/长度校验，这里落成 App 的真实动作。
//
// 3 秒点按窗口在 App 侧强制执行（同一个插件动作 3 秒内只执行一次），防止插件反复弹提示
// 或反复插入文本。`insert` 永远只改草稿，不自动发送。

import type { Effect } from "@nibi-go/plugin-contract";
import * as Clipboard from "expo-clipboard";
import { Alert, Linking, Platform, ToastAndroid } from "react-native";

import { runHostCommand, type HostCommandContext } from "./commands";
import type { LoadedPlugin } from "./store";

export interface RunnableAction {
  id: string;
  effects: Effect[];
}

export interface PluginActionContext {
  /** 插入草稿；`replace` 直接替换。 */
  insertText: (text: string, mode: "append" | "replace") => void;
  /** 打开某个插件的面板。 */
  openPanel: (pluginId: string, panelId: string) => void;
  /** 重新计算宿主数据/重绘当前槽。 */
  refresh: () => void;
  /** 宿主命令（`command` 效果）；白名单与可用性在 commands.ts 内裁决。 */
  command: HostCommandContext;
}

const TAP_WINDOW_MS = 3_000;
const lastRun = new Map<string, number>();

/** 插件相关的轻提示；命令分发也复用它（Android Toast / iOS Alert）。 */
export function toast(text: string): void {
  if (Platform.OS === "android") {
    ToastAndroid.show(text, ToastAndroid.SHORT);
    return;
  }
  Alert.alert("插件", text);
}

/** 执行一个动作；返回是否实际执行（被 3 秒窗口挡住时 false）。 */
export function runPluginAction(
  plugin: LoadedPlugin,
  action: RunnableAction,
  context: PluginActionContext,
): boolean {
  const key = `${plugin.parsed.manifest.id}:${action.id}`;
  const now = Date.now();
  const previous = lastRun.get(key);
  if (previous !== undefined && now - previous < TAP_WINDOW_MS) {
    toast("操作太频繁，请稍后再试");
    return false;
  }
  lastRun.set(key, now);

  for (const effect of action.effects) {
    switch (effect.kind) {
      case "insert":
        context.insertText(effect.text, effect.mode ?? "append");
        break;
      case "toast":
        toast(effect.text);
        break;
      case "open":
        context.openPanel(plugin.parsed.manifest.id, effect.panel);
        break;
      case "link":
        void Linking.openURL(effect.url).catch(() => toast("打不开这个链接"));
        break;
      case "refresh":
        context.refresh();
        break;
      case "copy":
        // 写剪贴板是异步的；抛错或平台返回 false 都如实提示，绝不假装成功。
        void Clipboard.setStringAsync(effect.text)
          .then((saved) => toast(saved ? "已复制" : "复制失败，请手动选择文本"))
          .catch(() => toast("复制失败，请手动选择文本"));
        break;
      case "command":
        runHostCommand(effect.name, effect.args, context.command);
        break;
    }
  }
  return true;
}