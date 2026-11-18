// 设置首页：先分页，不再把所有配置堆在一页。
//
// 模型/Provider、COMPOSE 快捷动作、插件、关于分开；后续新设置按入口加，不继续往下堆。

import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "../../components/Icon";
import { radius, space, type as typeScale, useNibiTheme } from "../../theme";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const t = useNibiTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.inkFaint }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: t.card, borderColor: t.hairline }]}>
        {children}
      </View>
    </View>
  );
}

function Row({
  icon,
  title,
  detail,
  onPress,
  last,
}: {
  icon: IconName;
  title: string;
  detail: string;
  onPress: () => void;
  last?: boolean;
}) {
  const t = useNibiTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.hairline },
        { opacity: pressed ? 0.65 : 1 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: t.panel }]}>
        <Icon name={icon} size={16} color={t.inkSub} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.ink }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: t.inkFaint }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Icon name="chevron-right" size={15} color={t.inkGhost} />
    </Pressable>
  );
}

export default function SettingsHomeScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? "0.0.0";

  // 从首页带着输入框焦点进来时，键盘会弹一下又收回去；进入设置先明确收起。
  useFocusEffect(
    useCallback(() => {
      Keyboard.dismiss();
    }, []),
  );

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
        <Text style={[styles.title, { color: t.ink }]}>设置</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <Section title="交互">
          <Row
            icon="sliders"
            title="COMPOSE 快捷动作"
            detail="胶囊、加号菜单、长按消息菜单的启用与排序"
            onPress={() => router.push("/settings/composer")}
          />
          <Row
            icon="sparkles"
            title="会话"
            detail="思考与工具调用的显示方式"
            onPress={() => router.push("/settings/conversation")}
            last
          />
        </Section>

        <Section title="模型">
          <Row
            icon="monitor"
            title="Provider 与模型"
            detail="供应商、模型能力、思考档位与 API Key"
            onPress={() => router.push("/settings/provider")}
            last
          />
        </Section>

        <Section title="插件">
          <Row
            icon="puzzle"
            title="插件管理"
            detail="启用/停用插件、查看面板与网页入口"
            onPress={() => router.push("/plugins")}
            last
          />
        </Section>

        <Section title="关于">
          <View style={styles.about}>
            <Text style={[styles.aboutTitle, { color: t.ink }]}>NIBI-GO</Text>
            <Text style={[styles.aboutDetail, { color: t.inkFaint }]}>
              版本 {version} · 本机内核 · 模型请求按当前 Provider 发出
            </Text>
          </View>
        </Section>
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
  section: { gap: space(1.5) },
  sectionTitle: { fontSize: 10.5, fontWeight: "700", paddingLeft: space(1) },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    minHeight: 58,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 13.5, fontWeight: "600" },
  rowDetail: { fontSize: 10.5 },
  about: { padding: space(3), gap: 2 },
  aboutTitle: { fontSize: 13, fontWeight: "700" },
  aboutDetail: { fontSize: 10.5 },
});