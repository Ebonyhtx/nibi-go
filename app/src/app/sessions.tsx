import { router } from "expo-router";
import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { SessionSummary } from "@nibi-go/shared-extract";

import { ScreenHeader } from "../components/ui/ScreenHeader";
import { useI18n } from "../i18n";
import { useResponsiveBodyStyle } from "../layout/responsive";
import { PressableScale } from "../motion/PressableScale";
import { useChat } from "../relay/useChat";
import { useSession } from "../relay/useSession";
import { radius, space, text, useNibiTheme, type NibiTheme } from "../theme";

// A2 会话列表（sessions-index topic）：workspace 内全部会话，点击切换订阅。
// 2.0：ScreenHeader + 主题 token 统一；会话排序/切换订阅逻辑不变。
export default function SessionsScreen() {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(3),
    paddingBottom: insets.bottom + space(6),
    gap: space(2),
  });
  const styles = useMemo(() => makeStyles(th), [th]);
  const { session } = useSession();
  const { chatSnapshot } = useChat(session);
  const sessions: SessionSummary[] = [...chatSnapshot.sessions].sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  );

  const phaseText = useMemo<Record<string, string>>(
    () => ({
      draft: pick("草稿", "Draft"),
      prewarming: pick("准备中", "Preparing"),
      running: pick("运行中", "Running"),
      completedSuccess: pick("已完成", "Completed"),
      completedInterrupted: pick("已中断", "Interrupted"),
      error: pick("出错", "Error"),
    }),
    [pick],
  );

  const outcomeText = useMemo<Record<string, string>>(
    () => ({
      completed: pick("完成", "Completed"),
      error: pick("失败", "Failed"),
      interrupted: pick("中断", "Interrupted"),
    }),
    [pick],
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title={pick("选择会话", "Select Session")} onBack={() => router.back()} />

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.sessionId}
        contentContainerStyle={bodyStyle}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {pick(
              "暂无会话。在桌面创建一个任务后再来。",
              "No sessions yet. Create a task on desktop first.",
            )}
          </Text>
        }
        renderItem={({ item }) => {
          const active = item.sessionId === chatSnapshot.sessionId;
          const sessionTitle = item.title?.trim() || pick("未命名会话", "Untitled session");
          return (
            <PressableScale
              scaleTo={0.985}
              style={[styles.row, active && styles.rowActive]}
              onPress={() =>
                void session.chat
                  .selectSession(item.sessionId)
                  .finally(() => router.replace("/chat"))
              }
              accessibilityRole="button"
              accessibilityLabel={sessionTitle}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {sessionTitle}
                </Text>
                <Text style={styles.rowSub}>
                  {phaseText[item.phase] ?? item.phase}
                  {item.lastOutcome ? ` · ${outcomeText[item.lastOutcome] ?? item.lastOutcome}` : ""}
                </Text>
              </View>
              {active && <Text style={styles.activeBadge}>{pick("当前", "Current")}</Text>}
            </PressableScale>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (th: NibiTheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: th.bg },
    empty: {
      ...text("small"),
      color: th.inkFaint,
      textAlign: "center",
      marginTop: space(8),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space(3),
      padding: space(3.5),
      borderRadius: radius.control,
      backgroundColor: th.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: th.hairline,
    },
    rowActive: { backgroundColor: th.brandSoft, borderColor: th.brand },
    rowText: { flex: 1, gap: space(0.5) },
    rowTitle: { ...text("body"), fontWeight: "600", color: th.ink },
    rowSub: { ...text("micro"), color: th.inkSub },
    activeBadge: { ...text("micro"), color: th.brand, fontWeight: "700" },
  });
