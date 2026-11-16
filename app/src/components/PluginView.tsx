// 声明式插件槽的 RN 渲染层：工具卡、输入框胶囊、面板。
//
// 只认 contract 包解析后的 `RenderedViewNode`（字符串/数字都已求值），不执行插件代码。
// 组件目录、字色都是语义 token；插件拿不到任意色值/字号/布局。

import type {
  Effect,
  PanelAction,
  RenderedListItem,
  RenderedViewNode,
  ToolCardContribution,
  ViewTone,
} from "@nibi-go/plugin-contract";
import type { ChatToolRow } from "@nibi-go/kernel-session";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { LoadedPlugin } from "../plugins/store";
import { radius, space, useNibiTheme, type NibiTheme } from "../theme";

/** 可执行动作的最小形状：面板动作有 label，输入胶囊动作有 title。 */
export interface PluginActionLike {
  id: string;
  effects: Effect[];
}

export type PluginActionHandler = (plugin: LoadedPlugin, action: PluginActionLike) => void;

function toneColor(t: NibiTheme, tone: ViewTone | undefined): string {
  switch (tone) {
    case "sub":
      return t.inkSub;
    case "faint":
      return t.inkFaint;
    case "brand":
      return t.brand;
    case "ok":
      return t.ok;
    case "warn":
      return t.amber;
    case "danger":
      return t.red;
    default:
      return t.ink;
  }
}

function toneBackground(t: NibiTheme, tone: ViewTone | undefined): string {
  switch (tone) {
    case "brand":
      return t.brandSoft;
    case "ok":
      return t.okSoft;
    case "warn":
      return t.amberSoft;
    case "danger":
      return t.redSoft;
    default:
      return t.panel;
  }
}

function textStyle(style: string | undefined): { fontSize: number; lineHeight?: number; fontWeight?: "600" | "700"; fontFamily?: string } {
  switch (style) {
    case "title":
      return { fontSize: 15.5, fontWeight: "700" };
    case "caption":
      return { fontSize: 11.5, lineHeight: 16 };
    case "mono":
      return { fontSize: 11.5, lineHeight: 16, fontFamily: "monospace" };
    case "label":
      return { fontSize: 11.5, lineHeight: 16, fontWeight: "600" };
    default:
      return { fontSize: 13.5, lineHeight: 19 };
  }
}

function PluginListItem({ item }: { item: RenderedListItem }) {
  const t = useNibiTheme();
  return (
    <View style={styles.listItem}>
      <Text style={[styles.listLabel, { color: toneColor(t, item.tone ?? "default") }]} numberOfLines={2}>
        {item.label}
      </Text>
      {item.value ? (
        <Text style={[styles.listValue, { color: t.inkFaint }]} numberOfLines={1}>
          {item.value}
        </Text>
      ) : null}
    </View>
  );
}

/** 视图节点递归渲染。`onButton` 按 action id 回调。 */
export function PluginViewNode({
  node,
  onButton,
}: {
  node: RenderedViewNode;
  onButton: (action: string) => void;
}) {
  const t = useNibiTheme();
  switch (node.type) {
    case "text":
      return (
        <Text
          style={[
            textStyle(node.style),
            { color: toneColor(t, node.tone) },
          ]}
          numberOfLines={node.maxLines}
        >
          {node.text}
        </Text>
      );
    case "row":
      return (
        <View
          style={[
            styles.row,
            node.gap === undefined ? null : { gap: space(node.gap) },
            node.align === "between"
              ? styles.rowBetween
              : node.align === "start"
                ? styles.rowStart
                : styles.rowCenter,
          ]}
        >
          {node.children.map((child, index) => (
            <PluginViewNode key={index} node={child} onButton={onButton} />
          ))}
        </View>
      );
    case "column":
      return (
        <View style={[styles.column, node.gap === undefined ? null : { gap: space(node.gap) }]}>
          {node.children.map((child, index) => (
            <PluginViewNode key={index} node={child} onButton={onButton} />
          ))}
        </View>
      );
    case "card":
      return (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          {node.title ? (
            <Text style={[styles.cardTitle, { color: t.ink }]}>{node.title}</Text>
          ) : null}
          {node.children.map((child, index) => (
            <PluginViewNode key={index} node={child} onButton={onButton} />
          ))}
        </View>
      );
    case "badge":
      return (
        <View style={[styles.badge, { backgroundColor: toneBackground(t, node.tone) }]}>
          <Text style={[styles.badgeText, { color: toneColor(t, node.tone ?? "default") }]}>
            {node.text}
          </Text>
        </View>
      );
    case "divider":
      return <View style={[styles.divider, { backgroundColor: t.hairline }]} />;
    case "progress":
      return (
        <View style={styles.progress}>
          {node.label ? (
            <Text style={[styles.progressLabel, { color: t.inkFaint }]}>{node.label}</Text>
          ) : null}
          <View style={[styles.progressTrack, { backgroundColor: t.panel }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: t.brand, width: `${node.value}%` },
              ]}
            />
          </View>
        </View>
      );
    case "list":
      if (node.items.length === 0) {
        return node.empty ? (
          <Text style={[styles.empty, { color: t.inkFaint }]}>{node.empty}</Text>
        ) : null;
      }
      return (
        <View style={styles.list}>
          {node.items.map((item, index) => (
            <PluginListItem key={index} item={item} />
          ))}
        </View>
      );
    case "button": {
      const primary = node.style === "primary";
      const danger = node.style === "danger";
      return (
        <Pressable
          onPress={() => onButton(node.action)}
          accessibilityRole="button"
          accessibilityLabel={node.label}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: danger ? t.redSoft : primary ? t.brand : t.panel,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.buttonText,
              { color: danger ? t.red : primary ? t.brandFg : t.inkSub },
            ]}
          >
            {node.label}
          </Text>
        </Pressable>
      );
    }
    case "spacer":
      return <View style={{ height: space(node.size ?? 2) }} />;
  }
}

function ActionRow({
  actions,
  onPress,
}: {
  actions: readonly PanelAction[];
  onPress: (action: PanelAction) => void;
}) {
  const t = useNibiTheme();
  if (actions.length === 0) return null;
  return (
    <View style={styles.actions}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          onPress={() => onPress(action)}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: t.steelSoft, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.actionText, { color: t.steel }]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** 工具行对应的插件卡；没有匹配时返回 undefined（调用方退回普通工具行）。 */
export function matchPluginToolCard(
  plugins: readonly LoadedPlugin[],
  row: ChatToolRow,
): { plugin: LoadedPlugin; card: ToolCardContribution } | undefined {
  const display = row.display;
  if (!display || display.kind !== "mcp_tool" || !display.serverName) return undefined;
  const tool = display.toolName ?? row.name;
  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.parsed.slotsAvailable) continue;
    if (plugin.parsed.manifest.runtime?.serverName !== display.serverName) continue;
    const card = plugin.parsed.manifest.contributes.toolCards.find(
      (entry) => entry.tool === undefined || entry.tool === tool,
    );
    if (card) return { plugin, card };
  }
  return undefined;
}

/** 工具卡：视图 + 插件署名 + 动作。 */
export function PluginToolCard({
  plugin,
  card,
  node,
  onAction,
}: {
  plugin: LoadedPlugin;
  card: ToolCardContribution;
  node: RenderedViewNode;
  onAction: PluginActionHandler;
}) {
  const t = useNibiTheme();
  const degraded = plugin.parsed.degraded.includes(`toolCards:${card.id}`);
  return (
    <View style={styles.toolCard}>
      <PluginViewNode node={node} onButton={(actionId) => {
        const action = card.actions.find((entry) => entry.id === actionId);
        if (action) onAction(plugin, action);
      }} />
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: t.inkGhost }]} numberOfLines={1}>
          插件 · {plugin.parsed.manifest.name}
          {degraded ? " · 已降级" : ""}
        </Text>
        <ActionRow actions={card.actions} onPress={(action) => onAction(plugin, action)} />
      </View>
    </View>
  );
}

/** 输入框上方的动作胶囊（每插件 ≤2 个，文字 ≤10 字已由 contract 保证）。 */
export function PluginComposerActions({
  plugins,
  onAction,
}: {
  plugins: readonly LoadedPlugin[];
  onAction: PluginActionHandler;
}) {
  const t = useNibiTheme();
  const actions = plugins.flatMap((plugin) =>
    plugin.parsed.manifest.contributes.composerActions.map((action) => ({ plugin, action })),
  );
  if (actions.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // 横向 ScrollView 在弹性列里会吃掉剩余高度（真机表现为胶囊下面半屏空白、宠物被顶到中间），
      // 这里必须让它按内容高度收缩。
      style={styles.composerScroll}
      contentContainerStyle={styles.composerRow}
    >
      {actions.map(({ plugin, action }) => (
        <Pressable
          key={`${plugin.parsed.manifest.id}:${action.id}`}
          onPress={() => onAction(plugin, action)}
          accessibilityRole="button"
          accessibilityLabel={`${action.title}（${plugin.parsed.manifest.name}）`}
          style={({ pressed }) => [
            styles.composerAction,
            { backgroundColor: t.glass, borderColor: t.glassBorder, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.composerActionText, { color: t.inkSub }]}>{action.title}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** 面板视图 + 动作行（插件中心/面板页共用）。 */
export function PluginPanelView({
  plugin,
  node,
  actions,
  onAction,
}: {
  plugin: LoadedPlugin;
  node: RenderedViewNode;
  actions: readonly PanelAction[];
  onAction: PluginActionHandler;
}) {
  return (
    <View style={styles.panel}>
      <PluginViewNode
        node={node}
        onButton={(actionId) => {
          const action = actions.find((entry) => entry.id === actionId);
          if (action) onAction(plugin, action);
        }}
      />
      <ActionRow actions={actions} onPress={(action) => onAction(plugin, action)} />
    </View>
  );
}

const styles = StyleSheet.create({
  toolCard: { gap: space(2), marginVertical: space(0.5) },
  panel: { gap: space(3) },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    gap: space(2),
  },
  cardTitle: { fontSize: 12, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap" },
  rowBetween: { alignItems: "center", justifyContent: "space-between" },
  rowCenter: { alignItems: "center" },
  rowStart: { alignItems: "flex-start" },
  column: { gap: space(2) },
  badge: { paddingHorizontal: space(2.5), paddingVertical: 3, borderRadius: radius.chip },
  badgeText: { fontSize: 11, fontWeight: "700" },
  divider: { height: StyleSheet.hairlineWidth, width: "100%", marginVertical: 2 },
  progress: { gap: 4 },
  progressLabel: { fontSize: 11 },
  progressTrack: { height: 6, borderRadius: radius.chip, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: radius.chip },
  list: { gap: 5 },
  listItem: { flexDirection: "row", alignItems: "baseline", gap: space(2) },
  listLabel: { flex: 1, fontSize: 12.5 },
  listValue: { fontSize: 11.5, fontFamily: "monospace" },
  empty: { fontSize: 11.5 },
  button: {
    minHeight: 32,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 12, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  action: {
    minHeight: 30,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontSize: 11.5, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
    flexWrap: "wrap",
  },
  footerText: { fontSize: 10.5, flexShrink: 1 },
  composerRow: { gap: space(2), paddingBottom: space(1.5), alignItems: "center" },
  composerScroll: { flexGrow: 0, flexShrink: 0 },
  composerAction: {
    height: 30,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(3),
    alignItems: "center",
    justifyContent: "center",
  },
  composerActionText: { fontSize: 11.5, fontWeight: "600" },
});
