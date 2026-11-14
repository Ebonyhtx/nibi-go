// 会话消息流（首页正文区）：用户右侧品牌软色、助手白卡带模型标签、系统居中。
// 只渲染 @nibi-go/kernel-session 的行模型，不碰协议。
import type { ConversationRow } from "@nibi-go/kernel-session";
import { type ComponentRef, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { radius, space, useNibiTheme } from "../theme";

export function ConversationList({ rows }: { rows: readonly ConversationRow[] }) {
  const th = useNibiTheme();
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);

  return (
    <ScrollView
      ref={ref}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() => ref.current?.scrollToEnd({ animated: true })}
    >
      {rows.map((row) => {
        if (row.kind === "system") {
          return (
            <Text key={`system:${row.id}`} style={[styles.system, { color: th.inkFaint }]}>
              {row.text}
            </Text>
          );
        }
        const isUser = row.kind === "user";
        return (
          <View
            key={`${row.kind}:${row.id}`}
            style={[styles.row, { alignItems: isUser ? "flex-end" : "flex-start" }]}
          >
            <View
              style={[
                styles.bubble,
                isUser
                  ? { backgroundColor: th.brandSoft, borderColor: "transparent" }
                  : { backgroundColor: th.card, borderColor: th.hairline },
              ]}
            >
              {row.kind === "assistant" && row.model ? (
                <Text style={[styles.model, { color: th.inkGhost }]}>
                  {row.model.providerId} · {row.model.modelId}
                </Text>
              ) : null}
              <Text style={[styles.text, { color: th.ink }]} selectable>
                {row.text || "…"}
              </Text>
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
  system: { fontSize: 12, textAlign: "center" },
});
