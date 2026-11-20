import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ConversationRow } from "@nibi-go/shared-extract";

import { PillButton } from "../components/ui/PillButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import type { ChatPhase } from "../relay/chat";
import { useChat } from "../relay/useChat";
import { useSession } from "../relay/useSession";
import { radius, space, text, useNibiTheme, type NibiTheme } from "../theme";

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
// 2.0：ScreenHeader + 主题 token 统一（原硬编码蓝白配色退役）；消息/审批/输入逻辑不变。
export default function ChatScreen() {
  const th = useNibiTheme();
  const styles = useMemo(() => makeStyles(th), [th]);
  const insets = useSafeAreaInsets();
  const { session, snapshot } = useSession();
  const { chatSnapshot, conversation } = useChat(session);
  const [draft, setDraft] = useState("");

  const rows = conversation?.rows.window ?? [];
  const canSend = chatSnapshot.phase === "ready";

  const send = () => {
    const draftText = draft.trim();
    if (!draftText || !canSend) return;
    setDraft("");
    void session.chat.sendText(draftText);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={PHASE_TEXT[chatSnapshot.phase]}
        subtitle={`${snapshot.credential?.deviceName ?? "桌面"}${
          chatSnapshot.sessionId ? ` · ${chatSnapshot.sessionId.slice(0, 8)}` : ""
        }`}
        onBack={() => router.back()}
      />

      {chatSnapshot.error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{chatSnapshot.error}</Text>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.rowId)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <RowView row={item} styles={styles} />}
        ListEmptyComponent={
          canSend ? (
            <Text style={styles.empty}>暂无消息。在下方输入框给桌面 AGENT 发第一条消息。</Text>
          ) : (
            <Text style={styles.empty}>{PHASE_TEXT[chatSnapshot.phase]}</Text>
          )
        }
      />

      {chatSnapshot.approvals.length > 0 && (
        <View style={styles.approvalArea}>
          {chatSnapshot.approvals.map((approval) => (
            <View key={approval.requestId} style={styles.approvalCard}>
              <Text style={styles.approvalTitle}>桌面请求审批：{approval.title ?? "工具调用"}</Text>
              <Text style={styles.approvalHint}>30 秒未操作将自动拒绝</Text>
              <View style={styles.approvalButtons}>
                <View style={styles.approvalButtonCell}>
                  <PillButton
                    label="允许"
                    onPress={() => session.chat.respondApproval(approval.requestId, "allow")}
                  />
                </View>
                <View style={styles.approvalButtonCell}>
                  <PillButton
                    label="拒绝"
                    variant="secondary"
                    onPress={() => session.chat.respondApproval(approval.requestId, "deny")}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {canSend ? (
        <View style={[styles.inputBar, { paddingBottom: space(2.5) + insets.bottom }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="发消息给桌面 AGENT…"
            placeholderTextColor={th.inkGhost}
            multiline
          />
          <PillButton label="发送" onPress={send} accessibilityLabel="发送" />
        </View>
      ) : (
        <Text style={[styles.hint, { paddingBottom: space(4) + insets.bottom }]}>
          {chatSnapshot.phase === "error" ? "连接失败，请返回重试" : PHASE_TEXT[chatSnapshot.phase]}
        </Text>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function RowView({ row, styles }: { row: ConversationRow; styles: Styles }) {
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

const makeStyles = (th: NibiTheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: th.bg },
    errorCard: {
      marginHorizontal: space(3),
      marginTop: space(3),
      padding: space(2.5),
      borderRadius: radius.control,
      backgroundColor: th.redSoft,
    },
    errorText: { ...text("small"), color: th.red, textAlign: "center" },
    list: { padding: space(3), gap: space(2), flexGrow: 1 },
    empty: {
      ...text("small"),
      color: th.inkFaint,
      textAlign: "center",
      marginTop: space(8),
    },
    bubble: {
      maxWidth: "86%",
      padding: space(2.5),
      borderRadius: radius.control,
    },
    userBubble: { alignSelf: "flex-end", backgroundColor: th.brandSoft },
    userText: { ...text("body"), color: th.ink },
    assistantBubble: { alignSelf: "flex-start", backgroundColor: th.panel },
    assistantText: { ...text("body"), color: th.ink },
    reasoning: {
      ...text("small"),
      color: th.inkFaint,
      fontStyle: "italic",
      paddingHorizontal: space(1),
    },
    toolRow: {
      alignSelf: "stretch",
      padding: space(2.5),
      borderRadius: radius.control,
      backgroundColor: th.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: th.hairline,
    },
    toolName: { ...text("small"), fontWeight: "600", color: th.inkSub },
    toolOutput: { ...text("micro"), color: th.inkSub, marginTop: space(1) },
    inputBar: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: space(2),
      paddingHorizontal: space(2.5),
      paddingTop: space(2.5),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: th.hairline,
      backgroundColor: th.card,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      paddingHorizontal: space(3),
      paddingVertical: space(2),
      borderRadius: radius.control,
      backgroundColor: th.surfaceSoft,
      ...text("body"),
      color: th.ink,
    },
    hint: { ...text("small"), color: th.inkFaint, textAlign: "center", padding: space(4) },
    approvalArea: { paddingHorizontal: space(3), gap: space(2), paddingBottom: space(2) },
    approvalCard: {
      padding: space(3),
      borderRadius: radius.control,
      backgroundColor: th.amberSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: th.amber,
    },
    approvalTitle: { ...text("small"), fontWeight: "600", color: th.ink },
    approvalHint: { ...text("micro"), color: th.inkSub, marginTop: space(0.5) },
    approvalButtons: { flexDirection: "row", gap: space(2), marginTop: space(2.5) },
    approvalButtonCell: { flex: 1 },
  });
