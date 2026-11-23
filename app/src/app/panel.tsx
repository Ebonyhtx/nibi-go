// 插件面板页：渲染某个插件声明的 panel（视图 + 动作）。
//
// 面板只读宿主数据（`data.host`）与清单里的静态 data；没有插件代码参与渲染。动作里的
// `insert` 会把文字带回首页草稿，`refresh` 重算宿主数据。

import { resolveView, type SlotData } from "@nibi-go/plugin-contract";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../components/Icon";
import { PluginPanelView } from "../components/PluginView";
import { useI18n } from "../i18n";
import { useResponsiveBodyStyle } from "../layout/responsive";
import { PressableScale } from "../motion/PressableScale";
import { runPluginAction, toast } from "../plugins/actions";
import { hostSlotData } from "../plugins/data";
import { setPendingInsert } from "../plugins/pendingInsert";
import { usePlugins } from "../plugins/usePlugins";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export default function PluginPanelScreen() {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const headerStyle = useResponsiveBodyStyle({
    paddingTop: insets.top + space(1),
    paddingBottom: space(2),
  });
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(3),
  });
  const params = useLocalSearchParams<{ pluginId?: string; panelId?: string }>();
  const plugins = usePlugins();
  const [tick, setTick] = useState(0);

  const plugin = plugins.plugins.find(
    (entry) => entry.parsed.manifest.id === params.pluginId,
  );
  const panel = plugin?.parsed.manifest.contributes.panels.find(
    (entry) => entry.id === params.panelId,
  );

  const host = hostSlotData({
    enabledPlugins: plugins.enabled.length,
    ...(plugin
      ? {
          plugin: {
            id: plugin.parsed.manifest.id,
            name: plugin.parsed.manifest.name,
            version: plugin.parsed.manifest.version,
          },
          settings: plugin.settings,
        }
      : {}),
  });
  const data: SlotData = {
    data: {
      ...(panel?.data ?? {}),
      ...host.data,
      panel: panel?.data ?? {},
    },
  };

  const header = (title: string, subtitle?: string) => (
    <View style={[styles.header, headerStyle]}>
      <PressableScale
        scaleTo={0.95}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={pick("返回", "Back")}
        style={({ pressed }) => [
          styles.back,
          { backgroundColor: pressed ? t.hover : t.card, borderColor: t.hairline },
        ]}
      >
        <Icon name="chevron-left" size={17} color={t.ink} />
      </PressableScale>
      <View style={styles.headerText}>
        <Text style={[styles.title, { color: t.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: t.inkFaint }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!plugin || !panel) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        {header(pick("面板不可用", "Panel unavailable"))}
        <View style={[styles.empty, bodyStyle]}>
          <Text style={[styles.emptyText, { color: t.inkSub }]}>
            {plugins.loading
              ? pick("正在读取插件…", "Loading plugins…")
              : pick(
                  "插件不存在，或这个面板已被移除。",
                  "Plugin not found, or this panel has been removed.",
                )}
          </Text>
        </View>
      </View>
    );
  }

  const disabledReason = !plugin.parsed.slotsAvailable
    ? plugin.parsed.reason ?? pick("插件槽不可用", "Plugin slot unavailable")
    : !plugin.enabled
      ? pick("插件已停用，在插件中心启用后再打开。", "Plugin is disabled. Enable it in Plugin Center first.")
      : plugin.parsed.status !== "ready"
        ? plugin.parsed.reason ?? pick("插件清单不兼容", "Incompatible plugin manifest")
        : null;
  const degraded = plugin.parsed.degraded.includes(`panels:${panel.id}`);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      {header(panel.title, `${plugin.parsed.manifest.name} · v${plugin.parsed.manifest.version}`)}
      <ScrollView contentContainerStyle={bodyStyle} showsVerticalScrollIndicator={false}>
        {degraded ? (
          <View style={[styles.banner, { backgroundColor: t.amberSoft }]}>
            <Text style={[styles.bannerText, { color: t.amber }]}>
              {pick(
                "这个面板用了当前版本不认识的组件，已按 v1 替身渲染。",
                "This panel uses components not recognized by this version and is rendered with v1 fallbacks.",
              )}
            </Text>
          </View>
        ) : null}
        {disabledReason ? (
          <View style={[styles.banner, { backgroundColor: t.panel }]}>
            <Text style={[styles.bannerText, { color: t.inkSub }]}>{disabledReason}</Text>
          </View>
        ) : (
          <View style={[styles.surface, { backgroundColor: t.card, borderColor: t.hairline }]}>
            <PluginPanelView
              key={tick}
              plugin={plugin}
              node={resolveView(panel.view, data)}
              actions={panel.actions}
              onAction={(target, action) => {
                runPluginAction(
                  target,
                  { id: action.id, effects: action.effects ?? [] },
                  {
                  insertText: (text) => {
                    setPendingInsert(text);
                    router.dismissTo("/");
                  },
                  openPanel: (pluginId, panelId) => {
                    router.push({ pathname: "/panel", params: { pluginId, panelId } });
                  },
                  refresh: () => setTick((value) => value + 1),
                  command: {
                    // 面板只有导航能力；newSession/compact 由 dispatcher 如实提示不可用。
                    navigate: (path) => router.push(path),
                    toast,
                  },
                });
              }}
            />
          </View>
        )}
        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          {pick(
            "这是插件提供的面板（只读清单/信息 + 动作），不是设置页；插件代码不在 UI 进程执行。",
            "Plugin-provided panel (read-only manifest/info + actions), not settings. Plugin code does not run in the UI process.",
          )}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 1 },
  title: { fontSize: typeScale.title, fontWeight: "700" },
  subtitle: { fontSize: typeScale.micro },
  surface: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(4),
  },
  banner: { borderRadius: radius.control, padding: space(3) },
  bannerText: { fontSize: 12, lineHeight: 17 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: typeScale.small, textAlign: "center" },
  footnote: { fontSize: 10.5, lineHeight: 15, paddingTop: space(2) },
});
