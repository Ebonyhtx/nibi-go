// 会话消息流（首页正文区）。行模型对齐 dsh-Go 的 ChatRow：
//   用户 = 右侧品牌软色气泡；
//   助手 = 白卡（推理折叠 + 正文 + 流式光标 + 模型标签）；
//   工具 = 一行式卡片（名称 + 状态 + 参数摘要）。
// 只渲染 @nibi-go/kernel-session 的行模型，不碰协议。
import type { ChatRow } from "@nibi-go/kernel-session";
import { type ComponentRef, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { radius, space, useNibiTheme } from "../theme";

export function ConversationList({ rows }: { rows: readonly ChatRow[] }) {
  const th = useNibiTheme();
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);
  // 只有用户本来就在底部时才自动跟随；往上翻历史时不抢滚动。
  const stickToBottom = useRef(true);

  return (
    <ScrollView
      ref={ref}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        stickToBottom.current =
          contentOffset.y + layoutMeasurement.height >= contentSize.height - 32;
      }}
      scrollEventThrottle={16}
      onContentSizeChange={() => {
        if (stickToBottom.current) ref.current?.scrollToEnd({ animated: false });
      }}
    >
      {rows.map((row) => {
        if (row.kind === "user") {
          return (
            <View key={row.key} style={[styles.row, { alignItems: "flex-end" }]}>
              <View style={[styles.bubble, { backgroundColor: th.brandSoft, borderColor: "transparent" }]}>
                <Text style={[styles.text, { color: th.ink }]} selectable>
                  {row.text}
                </Text>
              </View>
            </View>
          );
        }

        if (row.kind === "tool") {
          const tone =
            row.status === "error"
              ? th.red
              : row.status === "success"
                ? th.ok
                : row.status === "cancelled"
                  ? th.inkFaint
                  : th.amber;
          return (
            <View
              key={row.key}
              style={[styles.tool, { backgroundColor: th.card, borderColor: th.hairline }]}
            >
              <View style={styles.toolHead}>
                <Text style={[styles.toolName, { color: th.ink }]} numberOfLines={1}>
                  {row.name || "tool"}
                </Text>
                <Text style={[styles.toolStatus, { color: tone }]}>{row.status}</Text>
              </View>
              {row.detail ? (
                <Text style={[styles.toolDetail, { color: th.inkFaint }]} numberOfLines={2}>
                  {row.detail}
                </Text>
              ) : null}
              {row.error ? (
                <Text style={[styles.toolDetail, { color: th.red }]} numberOfLines={3}>
                  {row.error}
                </Text>
              ) : null}
            </View>
          );
        }

        // assistant
        return (
          <View key={row.key} style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={[styles.bubble, { backgroundColor: th.card, borderColor: th.hairline }]}>
              {row.model ? (
                <Text style={[styles.model, { color: th.inkGhost }]}>{row.model}</Text>
              ) : null}
              {row.reasoning.length > 0 ? (
                <View style={[styles.reasoning, { borderLeftColor: th.hairline }]}>
                  <Text style={[styles.reasoningText, { color: th.inkFaint }]} numberOfLines={4}>
                    {row.reasoning}
                  </Text>
                </View>
              ) : null}
              {row.text.length > 0 || !row.streaming ? (
                <Text style={[styles.text, { color: th.ink }]} selectable>
                  {row.text || "…"}
                </Text>
              ) : null}
              {row.streaming ? (
                <Text style={[styles.streaming, { color: th.brand }]}>
                  {row.text.length > 0 ? "▍" : "生成中…"}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingVertical: space(2), gap: space(3) },
  row: { width: "100%" },
  bubble: {
    maxWidth: "86%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: 4,
  },
  model: { fontSize: 10 },
  text: { fontSize: 14, lineHeight: 20 },
  reasoning: {
    borderLeftWidth: 2,
    paddingLeft: space(2),
    marginBottom: 2,
  },
  reasoningText: { fontSize: 12, lineHeight: 17 },
  streaming: { fontSize: 14, fontWeight: "700" },
  tool: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: 3,
  },
  toolHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  toolName: { flex: 1, fontSize: 12.5, fontWeight: "700" },
  toolStatus: { fontSize: 10.5, fontWeight: "600" },
  toolDetail: { fontSize: 11.5, lineHeight: 16 },
});
