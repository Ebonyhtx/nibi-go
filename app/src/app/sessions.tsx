import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import type { SessionSummary } from "@nibi-go/shared-extract";

import { useChat } from "../relay/useChat";
import { useSession } from "../relay/useSession";

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
export default function SessionsScreen() {
  const { session } = useSession();
  const { chatSnapshot } = useChat(session);
  const sessions: SessionSummary[] = [...chatSnapshot.sessions].sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.title}>选择会话</Text>
        <View style={styles.back} />
      </View>

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
            <Pressable
              style={[styles.row, active && styles.rowActive]}
              onPress={() =>
                void session.chat
                  .selectSession(item.sessionId)
                  .finally(() => router.replace("/chat"))
              }
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
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  back: { width: 64, paddingVertical: 4 },
  backText: { fontSize: 14, color: "#2563eb" },
  title: { flex: 1, fontSize: 15, fontWeight: "600", textAlign: "center" },
  list: { padding: 12, gap: 8 },
  empty: { fontSize: 13, color: "#999", textAlign: "center", marginTop: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#f5f7fa",
  },
  rowActive: { backgroundColor: "#e8f0fe" },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "600" },
  rowSub: { fontSize: 11, color: "#666", marginTop: 2 },
  activeBadge: { fontSize: 11, color: "#2563eb", fontWeight: "600" },
});
