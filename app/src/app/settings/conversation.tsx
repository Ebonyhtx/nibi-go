// 会话显示配置：消息流里思考过程 / 工具调用的显示与自动折叠。
//
// 只影响展示；隐藏的内容仍存在于会话记录里，随时可以重新打开。

import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "../../components/Icon";
import type { ConversationPreferenceKey } from "../../conversation/preferences";
import { useConversationPreferences } from "../../conversation/useConversationPreferences";
import { radius, space, type as typeScale, useNibiTheme } from "../../theme";

interface ToggleSpec {
  key: ConversationPreferenceKey;
  icon: IconName;
  title: string;
  detail: string;
}

const TOGGLES: readonly ToggleSpec[] = [
  {
    key: "showReasoning",
    icon: "sparkles",
    title: "显示思考过程",
    detail: "在消息流里展示模型的思考内容；关闭后只显示最终回复。",
  },
  {
    key: "showTools",
    icon: "puzzle",
    title: "显示工具调用",
    detail: "在消息流里展示工具调用摘要；关闭后只显示最终回复。",
  },
  {
    key: "autoCollapseReasoning",
    icon: "chevron-down",
    title: "思考自动折叠",
    detail: "一轮结束后自动收起思考内容，可手动展开。",
  },
  {
    key: "autoCollapseTools",
    icon: "chevron-down",
    title: "工具自动折叠",
    detail: "一轮结束后自动收起工具调用详情，可手动展开。",
  },
];

function ToggleRow({
  icon,
  title,
  detail,
  checked,
  onToggle,
  last,
}: {
  icon: IconName;
  title: string;
  detail: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  last?: boolean;
}) {
  const t = useNibiTheme();
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.hairline },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: t.panel }]}>
        <Icon name={icon} size={15} color={t.inkSub} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.rowDetail, { color: t.inkFaint }]} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <Switch
        value={checked}
        onValueChange={onToggle}
        trackColor={{ false: t.hairline, true: t.brandSoft }}
        thumbColor={checked ? t.brand : t.card}
      />
    </View>
  );
}

export default function ConversationSettingsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { preferences, setPreference } = useConversationPreferences();

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={[styles.head, { borderBottomColor: t.hairline }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={[styles.back, { backgroundColor: t.panel }]}
        >
          <Icon name="chevron-left" size={16} color={t.inkSub} />
        </Pressable>
        <Text style={[styles.title, { color: t.ink }]}>会话显示</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <Text style={[styles.intro, { color: t.inkSub }]}>
          这些开关只影响消息流的展示方式，不改变模型实际执行的步骤；隐藏的内容仍保留在会话记录里。
        </Text>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          {TOGGLES.map((item, index) => (
            <ToggleRow
              key={item.key}
              icon={item.icon}
              title={item.title}
              detail={item.detail}
              checked={preferences[item.key]}
              onToggle={(checked) => setPreference(item.key, checked)}
              last={index === TOGGLES.length - 1}
            />
          ))}
        </View>

        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          设置即时生效并只保存在本机；关闭显示不会改动会话内容本身。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, textAlign: "center", fontSize: typeScale.heading, fontWeight: "700" },
  body: { padding: space(4), gap: space(4) },
  intro: { fontSize: 12, lineHeight: 18 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    minHeight: 54,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 12.5, fontWeight: "600" },
  rowDetail: { fontSize: 9.5, lineHeight: 14 },
  footnote: { fontSize: 10, lineHeight: 15 },
});