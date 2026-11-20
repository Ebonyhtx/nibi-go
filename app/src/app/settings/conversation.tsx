// 会话显示配置：消息流里思考过程 / 工具调用的显示与自动折叠。
//
// 只影响展示；隐藏的内容仍存在于会话记录里，随时可以重新打开。
// 2.0：ScreenHeader + SectionCard + ui/ToggleRow 统一实现；偏好键与写入逻辑不变。

import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { IconName } from "../../components/Icon";
import { ToggleRow, type RowTone } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import type { ConversationPreferenceKey } from "../../conversation/preferences";
import { useConversationPreferences } from "../../conversation/useConversationPreferences";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { space, text, useNibiTheme } from "../../theme";

interface ToggleSpec {
  key: ConversationPreferenceKey;
  icon: IconName;
  tone: RowTone;
  title: string;
  detail: string;
}

const TOGGLES: readonly ToggleSpec[] = [
  {
    key: "showReasoning",
    icon: "sparkles",
    tone: "brand",
    title: "显示思考过程",
    detail: "在消息流里展示模型的思考内容；关闭后只显示最终回复。",
  },
  {
    key: "showTools",
    icon: "puzzle",
    tone: "steel",
    title: "显示工具调用",
    detail: "在消息流里展示工具调用摘要；关闭后只显示最终回复。",
  },
  {
    key: "autoCollapseReasoning",
    icon: "chevron-down",
    tone: "plain",
    title: "思考自动折叠",
    detail: "一轮结束后自动收起思考内容，可手动展开。",
  },
  {
    key: "autoCollapseTools",
    icon: "chevron-down",
    tone: "plain",
    title: "工具自动折叠",
    detail: "一轮结束后自动收起工具调用详情，可手动展开。",
  },
];

export default function ConversationSettingsScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { preferences, setPreference } = useConversationPreferences();

  return (
    <View style={styles.root}>
      {/* 页面纸面：与首页同一条竖向渐变（顶部暖光 → 纸面 → 纸底）。 */}
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="会话显示" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: th.inkSub }]}>
            这些开关只影响消息流的展示方式，不改变模型实际执行的步骤；隐藏的内容仍保留在会话记录里。
          </Text>
        </AppearIn>

        <AppearIn delay={staggerDelay(1, 32, 240)}>
          <SectionCard>
            {TOGGLES.map((item, index) => (
              <View key={item.key}>
                {index > 0 ? <Divider /> : null}
                <ToggleRow
                  icon={item.icon}
                  tone={item.tone}
                  title={item.title}
                  detail={item.detail}
                  value={preferences[item.key]}
                  onChange={(checked) => setPreference(item.key, checked)}
                />
              </View>
            ))}
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <Text style={[styles.footnote, { color: th.inkGhost }]}>
            设置即时生效并只保存在本机；关闭显示不会改动会话内容本身。
          </Text>
        </AppearIn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(4) },
  intro: { ...text("small") },
  footnote: { ...text("micro") },
});
