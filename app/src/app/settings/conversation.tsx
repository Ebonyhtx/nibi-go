// 会话显示配置：消息流里思考过程 / 工具调用的显示与自动折叠。
//
// 只影响展示；隐藏的内容仍存在于会话记录里，随时可以重新打开。
// 2.0：ScreenHeader + SectionCard + ui/ToggleRow 统一实现；偏好键与写入逻辑不变。

import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { IconName } from "../../components/Icon";
import { ToggleRow, type RowTone } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import type { ConversationPreferenceKey } from "../../conversation/preferences";
import { useConversationPreferences } from "../../conversation/useConversationPreferences";
import { useI18n } from "../../i18n";
import { useResponsiveBodyStyle } from "../../layout/responsive";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { space, useNibiTheme } from "../../theme";

interface ToggleSpec {
  key: ConversationPreferenceKey;
  icon: IconName;
  tone: RowTone;
  titleZh: string;
  titleEn: string;
  detailZh: string;
  detailEn: string;
}

const TOGGLES: readonly ToggleSpec[] = [
  {
    key: "showReasoning",
    icon: "sparkles",
    tone: "brand",
    titleZh: "显示思考过程",
    titleEn: "Show thinking",
    detailZh: "在消息流里显示思考内容",
    detailEn: "Display reasoning blocks in the conversation",
  },
  {
    key: "showTools",
    icon: "puzzle",
    tone: "steel",
    titleZh: "显示工具调用",
    titleEn: "Show tool calls",
    detailZh: "在消息流里显示工具调用摘要",
    detailEn: "Display tool call summaries in the conversation",
  },
  {
    key: "autoCollapseReasoning",
    icon: "chevron-down",
    tone: "plain",
    titleZh: "思考自动折叠",
    titleEn: "Auto-collapse thinking",
    detailZh: "一轮结束后自动收起",
    detailEn: "Collapse automatically after each turn",
  },
  {
    key: "autoCollapseTools",
    icon: "chevron-down",
    tone: "plain",
    titleZh: "工具自动折叠",
    titleEn: "Auto-collapse tools",
    detailZh: "一轮结束后自动收起",
    detailEn: "Collapse automatically after each turn",
  },
];

export default function ConversationSettingsScreen() {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(4),
  });
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
      <ScreenHeader title={pick("会话显示", "Conversation display")} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={bodyStyle}>
        {/* 2.0.1：删页顶说明段与页底免责段——开关名+副题已自明，「即时生效/只存本机」是实现默认。 */}

        <AppearIn delay={staggerDelay(1, 32, 240)}>
          <SectionCard>
            {TOGGLES.map((item, index) => (
              <View key={item.key}>
                {index > 0 ? <Divider /> : null}
                <ToggleRow
                  icon={item.icon}
                  tone={item.tone}
                  title={pick(item.titleZh, item.titleEn)}
                  detail={pick(item.detailZh, item.detailEn)}
                  value={preferences[item.key]}
                  onChange={(checked) => setPreference(item.key, checked)}
                />
              </View>
            ))}
          </SectionCard>
        </AppearIn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
