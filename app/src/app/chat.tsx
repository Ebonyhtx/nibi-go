import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";

import type { ConversationRow } from "@nibi-go/shared-extract";

import type { ChatPhase } from "../relay/chat";
import { useChat } from "../relay/useChat";
import { useSession } from "../relay/useSession";

const PHASE_TEXT: Record<ChatPhase, string> = {
  idle: "未连接",
  bootstrapping: "正在连接桌面…",
  "opening-workspace": "正在打开工作区…",
  subscribing: "正在同步会话…",
  ready: "已连接",
  resyncing: "连接中断，正在恢复…",
  error: "连接失败",
};

// A2 聊天屏：消息流 + 输入框 + 工具行（最小渲染集：userInput / assistantText / reasoning / toolCall）。
export default function ChatScreen() {
  const { session, snapshot } = useSession();
  const { chatSnapshot, conversation } = useChat(session);
  const [draft, setDraft] = useState("");

  const rows = conversation?.rows.window ?? [];
  const canSend = chatSnapshot.phase === "ready";

  const send = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setDraft("");
    void session.chat.sendText(text);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>{PHASE_TEXT[chatSnapshot.phase]}</Text>
          <Text style={styles.subtitle}>
            {snapshot.credential?.deviceName ?? "桌面"}
            {chatSnapshot.sessionId ? ` · ${chatSnapshot.sessionId.slice(0, 8)}` : ""}
          </Text>
        </View>
        <View style={styles.back} />
      </View>

      {chatSnapshot.error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{chatSnapshot.error}</Text>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.rowId)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <RowView row={item} />}
        ListEmptyComponent={
          canSend ? (
            <Text style={styles.empty}>暂无消息。在下方输入框给桌面 AGENT 发第一条消息。</Text>
          ) : (
            <Text style={styles.empty}>{PHASE_TEXT[chatSnapshot.phase]}</Text>
          )
        }
      />

      {canSend ? (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="发消息给桌面 AGENT…"
            multiline
          />
          <Pressable style={styles.sendButton} onPress={send}>
            <Text style={styles.sendText}>发送</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.hint}>
          {chatSnapshot.phase === "error" ? "连接失败，请返回重试" : PHASE_TEXT[chatSnapshot.phase]}
        </Text>
      )}
    </View>
  );
}

function RowView({ row }: { row: ConversationRow }) {
  switch (row.kind) {
    case "userInput":
      return (
        <View style={[styles.bubble, styles.userBubble]}>
          <Text style={styles.userText}>{row.text}</Text>
        </View>
      );
    case "assistantText":
      return (
        <View style={[styles.bubble, styles.assistantBubble]}>
          <Text style={styles.assistantText}>
            {row.text || (row.state === "streaming" ? "…" : "")}
          </Text>
        </View>
      );
    case "reasoning":
      return <Text style={styles.reasoning}>{row.text}</Text>;
    case "toolCall":
      return (
        <View style={styles.toolRow}>
          <Text style={styles.toolName}>
            {row.toolName} · {row.status}
          </Text>
          {row.output?.text ? (
            <Text style={styles.toolOutput} numberOfLines={4}>
              {row.output.text}
            </Text>
          ) : null}
        </View>
      );
    default:
      return null;
  }
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
  headerCenter: { flex: 1, alignItems: "center" },
  title: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 11, color: "#888", marginTop: 1 },
  errorCard: { margin: 12, padding: 10, borderRadius: 10, backgroundColor: "#fdecec" },
  errorText: { fontSize: 12, color: "#c0392b", textAlign: "center" },
  list: { padding: 12, gap: 8, flexGrow: 1 },
  empty: { fontSize: 13, color: "#999", textAlign: "center", marginTop: 32 },
  bubble: { maxWidth: "86%", padding: 10, borderRadius: 12 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#e8f0fe" },
  userText: { fontSize: 14 },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "#f5f7fa" },
  assistantText: { fontSize: 14 },
  reasoning: { fontSize: 12, color: "#999", fontStyle: "italic", paddingHorizontal: 4 },
  toolRow: {
    alignSelf: "stretch",
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#fbfbfb",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e5e5",
  },
  toolName: { fontSize: 12, fontWeight: "600", color: "#444" },
  toolOutput: { fontSize: 11, color: "#666", marginTop: 4 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5e5",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#f5f7fa",
    fontSize: 14,
  },
  sendButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#2563eb" },
  sendText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 12, color: "#999", textAlign: "center", padding: 16 },
});
