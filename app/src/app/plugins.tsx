// 插件中心：内置样例插件的启停、状态、降级原因与面板入口。
//
// 只显示 manifest 与解析结果；插件代码不会在 UI 进程执行（MCP 工具在 `:kernel` 的
// 子进程里跑）。这里也是“为什么不能渲染”的唯一解释入口：不兼容、清单有误、已降级。

import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../components/Icon";
import { usePlugins } from "../plugins/usePlugins";
import type { LoadedPlugin } from "../plugins/store";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

function statusOf(plugin: LoadedPlugin): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (plugin.parsed.status === "invalid") return { label: "清单有误", tone: "danger" };
  if (plugin.parsed.status === "incompatible") return { label: "不兼容", tone: "warn" };
  if (!plugin.parsed.slotsAvailable) return { label: "已降级", tone: "warn" };
  if (!plugin.enabled) return { label: "已停用", tone: "muted" };
  return { label: "可用", tone: "ok" };
}

function PluginCard({
  plugin,
  busy,
  onToggle,
}: {
  plugin: LoadedPlugin;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useNibiTheme();
  const manifest = plugin.parsed.manifest;
  const status = statusOf(plugin);
  const tone =
    status.tone === "ok" ? t.ok : status.tone === "warn" ? t.amber : status.tone === "danger" ? t.red : t.inkFaint;
  const toneSoft =
    status.tone === "ok" ? t.okSoft : status.tone === "warn" ? t.amberSoft : status.tone === "danger" ? t.redSoft : t.panel;
  const panels = manifest.contributes.panels;
  const canEnable = plugin.parsed.status === "ready" && plugin.parsed.slotsAvailable;

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleWrap}>
          <Text style={[styles.cardTitle, { color: t.ink }]} numberOfLines={1}>
            {manifest.name}
          </Text>
          <Text style={[styles.cardMeta, { color: t.inkFaint }]} numberOfLines={1}>
            {manifest.id} · v{manifest.version}
          </Text>
        </View>
        <View style={[styles.status, { backgroundColor: toneSoft }]}>
          <Text style={[styles.statusText, { color: tone }]}>{status.label}</Text>
        </View>
        <Switch
          value={plugin.enabled}
          disabled={!canEnable || busy}
          onValueChange={onToggle}
          trackColor={{ true: t.brand, false: t.hairline }}
          thumbColor={plugin.enabled ? t.brandFg : undefined}
          accessibilityLabel={`启用 ${manifest.name}`}
        />
      </View>

      {manifest.description ? (
        <Text style={[styles.description, { color: t.inkSub }]}>{manifest.description}</Text>
      ) : null}

      <View style={styles.chips}>
        {manifest.caps.map((cap) => (
          <View key={cap} style={[styles.chip, { backgroundColor: t.panel }]}>
            <Text style={[styles.chipText, { color: t.inkFaint }]}>{cap}</Text>
          </View>
        ))}
        {manifest.runtime ? (
          <View style={[styles.chip, { backgroundColor: t.steelSoft }]}>
            <Text style={[styles.chipText, { color: t.steel }]}>MCP · {manifest.runtime.serverName}</Text>
          </View>
        ) : (
          <View style={[styles.chip, { backgroundColor: t.panel }]}>
            <Text style={[styles.chipText, { color: t.inkFaint }]}>纯声明</Text>
          </View>
        )}
        {plugin.parsed.degraded.length > 0 ? (
          <View style={[styles.chip, { backgroundColor: t.amberSoft }]}>
            <Text style={[styles.chipText, { color: t.amber }]}>已降级</Text>
          </View>
        ) : null}
      </View>

      {plugin.parsed.reason ? (
        <Text style={[styles.reason, { color: tone }]}>{plugin.parsed.reason}</Text>
      ) : null}

      {plugin.parsed.issues.length > 0 ? (
        <View style={styles.issues}>
          <Text style={[styles.issueTitle, { color: t.amber }]}>
            {plugin.parsed.issues.length} 项有误（可用部分仍生效）
          </Text>
          {plugin.parsed.issues.slice(0, 3).map((issue, index) => (
            <Text key={index} style={[styles.issue, { color: t.inkFaint }]} numberOfLines={2}>
              {issue.path || "/"} · {issue.message}
            </Text>
          ))}
        </View>
      ) : null}

      {panels.length > 0 ? (
        <View style={styles.panels}>
          <Text style={[styles.panelsTitle, { color: t.inkFaint }]}>面板</Text>
          {panels.map((panel) => {
            const degraded = plugin.parsed.degraded.includes(`panels:${panel.id}`);
            return (
              <Pressable
                key={panel.id}
                disabled={!canEnable}
                onPress={() =>
                  router.push({
                    pathname: "/panel",
                    params: { pluginId: manifest.id, panelId: panel.id },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`打开面板 ${panel.title}`}
                style={({ pressed }) => [
                  styles.panelRow,
                  { borderColor: t.hairline, opacity: canEnable ? (pressed ? 0.6 : 1) : 0.45 },
                ]}
              >
                <View style={styles.panelTextWrap}>
                  <Text style={[styles.panelTitle, { color: t.ink }]}>{panel.title}</Text>
                  {panel.description ? (
                    <Text style={[styles.panelDesc, { color: t.inkFaint }]} numberOfLines={1}>
                      {panel.description}
                    </Text>
                  ) : null}
                </View>
                {degraded ? (
                  <Text style={[styles.panelDegraded, { color: t.amber }]}>已降级</Text>
                ) : null}
                <Icon name="chevron-right" size={14} color={t.inkGhost} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export default function PluginsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const plugins = usePlugins();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + space(1) }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={[styles.back, { backgroundColor: t.glass, borderColor: t.glassBorder }]}
        >
          <Icon name="chevron-left" size={17} color={t.ink} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: t.ink }]}>插件</Text>
          <Text style={[styles.subtitle, { color: t.inkFaint }]}>
            声明式槽 · 插件代码跑在子进程
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(6) }]}
        showsVerticalScrollIndicator={false}
      >
        {plugins.loading && plugins.plugins.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.brand} />
            <Text style={[styles.loadingText, { color: t.inkFaint }]}>读取插件清单…</Text>
          </View>
        ) : null}

        {plugins.error ? (
          <Text style={[styles.error, { color: t.red }]}>{plugins.error}</Text>
        ) : null}

        {plugins.plugins.map((plugin) => (
          <PluginCard
            key={plugin.dir}
            plugin={plugin}
            busy={busy === plugin.parsed.manifest.id}
            onToggle={(enabled) => {
              const id = plugin.parsed.manifest.id;
              setBusy(id);
              void plugins
                .setEnabled(id, enabled)
                .catch((error: unknown) => {
                  plugins.reload().catch(() => undefined);
                  console.warn("[nibigo] 插件启停失败", error);
                })
                .finally(() => setBusy((current) => (current === id ? null : current)));
            }}
          />
        ))}

        <View style={[styles.note, { borderColor: t.hairline }]}>
          <Text style={[styles.noteText, { color: t.inkFaint }]}>
            插件只能渲染受限 JSON 视图（文字/行/列/卡/徽标/进度/列表/按钮），不能改导航、主题或
            权限。工具卡的数据来自插件的 MCP 工具；插件子进程拿不到 Provider key。
          </Text>
          <Text style={[styles.noteText, { color: t.inkFaint }]}>
            远端桌面会话没有插件槽：同一份清单会如实降级为不渲染。
          </Text>
        </View>
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
    paddingHorizontal: space(4),
    paddingBottom: space(2),
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { gap: 1 },
  title: { fontSize: typeScale.title, fontWeight: "700" },
  subtitle: { fontSize: typeScale.micro },
  content: { paddingHorizontal: space(4), gap: space(3), paddingTop: space(2) },
  loading: { alignItems: "center", gap: space(2), paddingVertical: space(10) },
  loadingText: { fontSize: typeScale.small },
  error: { fontSize: typeScale.small },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3.5),
    gap: space(2.5),
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space(2) },
  cardTitleWrap: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardMeta: { fontSize: 10.5 },
  status: { paddingHorizontal: space(2.5), paddingVertical: 3, borderRadius: radius.chip },
  statusText: { fontSize: 10.5, fontWeight: "700" },
  description: { fontSize: 12.5, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  chip: { paddingHorizontal: space(2), paddingVertical: 2, borderRadius: radius.chip },
  chipText: { fontSize: 10, fontWeight: "600" },
  reason: { fontSize: 11.5 },
  issues: { gap: 2 },
  issueTitle: { fontSize: 11, fontWeight: "600" },
  issue: { fontSize: 10.5, lineHeight: 14 },
  panels: { gap: space(1.5) },
  panelsTitle: { fontSize: 10.5, fontWeight: "700" },
  panelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    minHeight: 44,
  },
  panelTextWrap: { flex: 1, gap: 1 },
  panelTitle: { fontSize: 13, fontWeight: "600" },
  panelDesc: { fontSize: 10.5 },
  panelDegraded: { fontSize: 10, fontWeight: "600" },
  note: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(3),
    gap: space(2),
    marginTop: space(2),
  },
  noteText: { fontSize: 11, lineHeight: 16 },
});
