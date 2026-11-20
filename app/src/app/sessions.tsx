import { router } from "expo-router";
import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import type { SessionSummary } from "@nibi-go/shared-extract";

import { ScreenHeader } from "../components/ui/ScreenHeader";
import { PressableScale } from "../motion/PressableScale";
import { useChat } from "../relay/useChat";
import { useSession } from "../relay/useSession";
import { radius, space, text, useNibiTheme, type NibiTheme } from "../theme";

const PHASE_TEXT: Record<string, string> = {
  draft: "草稿",
  prewarming: "准备中",
  running: "运行中",
  completedSuccess: "已完成",
  completedInterrupted: "已中断",
  error: "出错",
};

const OUTCOME_TEXT: Record<string, string> = {
  completed: "完成",
  error: "失败",
  interrupted: "中断",
};

// A2 会话列表（sessions-index topic）：workspace 内全部会话，点击切换订阅。
// 2.0：ScreenHeader + 主题 token 统一；会话排序/切换订阅逻辑不变。
export default function SessionsScreen() {
  const th = useNibiTheme();
  const styles = useMemo(() => makeStyles(th), [th]);
  const { session } = useSession();
  const { chatSnapshot } = useChat(session);
  const sessions: SessionSummary[] = [...chatSnapshot.sessions].sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title="选择会话" onBack={() => router.back()} />

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.sessionId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>暂无会话。在桌面创建一个任务后再来。</Text>
        }
        renderItem={({ item }) => {
          const active = item.sessionId === chatSnapshot.sessionId;
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
              accessibilityLabel={item.title?.trim() || "未命名会话"}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title?.trim() || "未命名会话"}
                </Text>
                <Text style={styles.rowSub}>
                  {PHASE_TEXT[item.phase] ?? item.phase}
                  {item.lastOutcome ? ` · ${OUTCOME_TEXT[item.lastOutcome] ?? item.lastOutcome}` : ""}
                </Text>
              </View>
              {active && <Text style={styles.activeBadge}>当前</Text>}
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
    list: { padding: space(3), gap: space(2) },
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
