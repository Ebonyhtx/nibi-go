import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ConversationRow } from "@nibi-go/shared-extract";

import { PillButton } from "../components/ui/PillButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { useI18n } from "../i18n";
import { METRICS } from "../layout/adaptive";
import { useResponsiveBodyStyle } from "../layout/responsive";
import type { ChatPhase } from "../relay/chat";
import { useChat } from "../relay/useChat";
import { useSession } from "../relay/useSession";
import { radius, space, text, useNibiTheme, type NibiTheme } from "../theme";

// A2 聊天屏：消息流 + 输入框 + 工具行（最小渲染集：userInput / assistantText / reasoning / toolCall）。
// 2.0：ScreenHeader + 主题 token 统一（原硬编码蓝白配色退役）；消息/审批/输入逻辑不变。
export default function ChatScreen() {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const styles = useMemo(() => makeStyles(th), [th]);
  const insets = useSafeAreaInsets();
  const listStyle = useResponsiveBodyStyle({
    paddingTop: space(3),
    paddingBottom: space(3),
    gap: space(2),
    flexGrow: 1,
  });
  const { session, snapshot } = useSession();
  const { chatSnapshot, conversation } = useChat(session);
  const [draft, setDraft] = useState("");

  const phaseText = useMemo<Record<ChatPhase, string>>(
    () => ({
      idle: pick("未连接", "Disconnected"),
      bootstrapping: pick("正在连接桌面…", "Connecting to desktop…"),
      "opening-workspace": pick("正在打开工作区…", "Opening workspace…"),
      subscribing: pick("正在同步会话…", "Syncing session…"),
      ready: pick("已连接", "Connected"),
      resyncing: pick("连接中断，正在恢复…", "Connection lost, reconnecting…"),
      error: pick("连接失败", "Connection failed"),
    }),
    [pick],
  );

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
        title={phaseText[chatSnapshot.phase]}
        subtitle={`${snapshot.credential?.deviceName ?? pick("桌面", "Desktop")}${
          chatSnapshot.sessionId ? ` · ${chatSnapshot.sessionId.slice(0, 8)}` : ""
        }`}
        onBack={() => router.back()}
      />

      {chatSnapshot.error && (
        <View
          style={[
            styles.centeredSection,
            {
              paddingLeft: insets.left + space(3),
              paddingRight: insets.right + space(3),
              marginTop: space(3),
            },
          ]}
        >
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{chatSnapshot.error}</Text>
          </View>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.rowId)}
        contentContainerStyle={listStyle}
        renderItem={({ item }) => <RowView row={item} styles={styles} />}
        ListEmptyComponent={
          canSend ? (
            <Text style={styles.empty}>
              {pick(
                "暂无消息。在下方输入框给桌面 AGENT 发第一条消息。",
                "No messages yet. Send your first message to the desktop agent below.",
              )}
            </Text>
          ) : (
            <Text style={styles.empty}>{phaseText[chatSnapshot.phase]}</Text>
          )
        }
      />

      {chatSnapshot.approvals.length > 0 && (
        <View
          style={[
            styles.approvalArea,
            {
              paddingLeft: insets.left + space(3),
              paddingRight: insets.right + space(3),
            },
          ]}
        >
          {chatSnapshot.approvals.map((approval) => {
            const target = approval.title ?? pick("工具调用", "Tool call");
            return (
              <View key={approval.requestId} style={styles.approvalCard}>
                <Text style={styles.approvalTitle}>
                  {pick(`桌面请求审批：${target}`, `Desktop approval requested: ${target}`)}
                </Text>
                <Text style={styles.approvalHint}>
                  {pick("30 秒未操作将自动拒绝", "Auto-denies after 30s without response")}
                </Text>
                <View style={styles.approvalButtons}>
                  <View style={styles.approvalButtonCell}>
                    <PillButton
                      label={pick("允许", "Allow")}
                      onPress={() => session.chat.respondApproval(approval.requestId, "allow")}
                    />
                  </View>
                  <View style={styles.approvalButtonCell}>
                    <PillButton
                      label={pick("拒绝", "Deny")}
                      variant="secondary"
                      onPress={() => session.chat.respondApproval(approval.requestId, "deny")}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {canSend ? (
        <View
          style={[
            styles.inputBar,
            {
              paddingLeft: insets.left + space(2.5),
              paddingRight: insets.right + space(2.5),
              paddingBottom: space(2.5) + insets.bottom,
            },
          ]}
        >
          <View style={styles.inputBarInner}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={pick("发消息给桌面 AGENT…", "Message desktop agent…")}
              placeholderTextColor={th.inkGhost}
              multiline
            />
            <PillButton
              label={pick("发送", "Send")}
              onPress={send}
              accessibilityLabel={pick("发送", "Send")}
            />
          </View>
        </View>
      ) : (
        <Text
          style={[
            styles.hint,
            {
              paddingLeft: insets.left + space(4),
              paddingRight: insets.right + space(4),
              paddingBottom: space(4) + insets.bottom,
            },
          ]}
        >
          {chatSnapshot.phase === "error"
            ? pick("连接失败，请返回重试", "Connection failed. Go back and retry.")
            : phaseText[chatSnapshot.phase]}
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
    centeredSection: {
      width: "100%",
      maxWidth: METRICS.secondaryMax,
      alignSelf: "center",
    },
    errorCard: {
      padding: space(2.5),
      borderRadius: radius.control,
      backgroundColor: th.redSoft,
    },
    errorText: { ...text("small"), color: th.red, textAlign: "center" },
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
      paddingTop: space(2.5),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: th.hairline,
      backgroundColor: th.card,
    },
    inputBarInner: {
      width: "100%",
      maxWidth: METRICS.secondaryMax,
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "flex-end",
      gap: space(2),
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
    hint: { ...text("small"), color: th.inkFaint, textAlign: "center", paddingTop: space(4) },
    approvalArea: {
      width: "100%",
      maxWidth: METRICS.secondaryMax,
      alignSelf: "center",
      gap: space(2),
      paddingBottom: space(2),
    },
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
