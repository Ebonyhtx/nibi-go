// COMPOSE 上方的引用/注释条：消息动作选中后，把原消息摘要钉在输入框上方。
//
// 不改变 COMPOSE 尺寸；与动作胶囊共用同一块浮层位置，发送或关闭后消失。

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import { radius, space, useNibiTheme } from "../theme";

export interface QuoteContext {
  text: string;
  label: string;
}

export function ComposerQuoteBar({
  quote,
  onClose,
}: {
  quote: QuoteContext;
  onClose: () => void;
}) {
  const t = useNibiTheme();
  return (
    <View
      style={[
        styles.root,
        { backgroundColor: t.card, borderColor: t.hairline },
      ]}
    >
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="取消引用"
        style={styles.close}
      >
        <Icon name="x" size={13} color={t.inkFaint} />
      </Pressable>
      <View style={[styles.accent, { backgroundColor: t.brand }]} />
      <View style={styles.body}>
        <View style={styles.head}>
          <Icon name="quote" size={12} color={t.brand} />
          <Text style={[styles.label, { color: t.brand }]} numberOfLines={1}>
            引用 · {quote.label}
          </Text>
        </View>
        <Text style={[styles.excerpt, { color: t.inkSub }]} numberOfLines={2}>
          {quote.text.trim()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingRight: space(2),
    overflow: "hidden",
    minHeight: 44,
  },
  accent: { width: 3 },
  body: { flex: 1, paddingVertical: space(1.5), gap: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: { fontSize: 10.5, fontWeight: "700" },
  excerpt: { fontSize: 11, lineHeight: 15 },
  close: {
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: space(2),
    paddingRight: 2,
  },
});