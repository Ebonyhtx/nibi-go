// COMPOSE 里的不可编辑 token：插件引用 / 命令 / 技能。
//
// 对齐 NIBI 客户端的 mention chip：文字不是用户草稿，点 × 只移除 token；
// 真正的提示词/技能正文由内核按 token 展开，不在这里显示。

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "./Icon";
import type { ComposerToken } from "../plugins/tokens";
import { radius, space, useNibiTheme, type NibiTheme } from "../theme";

function tokenColor(t: NibiTheme, accent: string | undefined): { bg: string; fg: string } {
  switch (accent) {
    case "ok":
      return { bg: t.okSoft, fg: t.ok };
    case "warn":
      return { bg: t.amberSoft, fg: t.amber };
    case "danger":
      return { bg: t.redSoft, fg: t.red };
    case "default":
      return { bg: t.steelSoft, fg: t.steel };
    case "brand":
    default:
      return { bg: t.brandSoft, fg: t.brand };
  }
}

function tokenIcon(token: ComposerToken): IconName {
  if (token.kind === "message") return "quote";
  if (token.kind === "mode") return "doc";
  if (token.kind === "command") return token.icon === "clock" ? "clock" : "sparkles";
  if (token.kind === "skill") return "doc";
  return token.icon === "globe" || token.icon === "doc" || token.icon === "clock"
    ? token.icon
    : "puzzle";
}

export function ComposerTokens({
  tokens,
  onRemove,
}: {
  tokens: readonly ComposerToken[];
  onRemove: (id: string) => void;
}) {
  const t = useNibiTheme();
  if (tokens.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {tokens.map((token) => {
        const color = tokenColor(t, token.accent);
        return (
          <View
            key={token.id}
            style={[styles.chip, { backgroundColor: color.bg, borderColor: color.bg }]}
          >
            <Icon name={tokenIcon(token)} size={11} color={color.fg} />
            <Text style={[styles.label, { color: color.fg }]} numberOfLines={1}>
              {token.label}
            </Text>
            <Pressable
              onPress={() => onRemove(token.id)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`移除 ${token.label}`}
              style={styles.remove}
            >
              <Icon name="x" size={9} color={color.fg} />
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, height: 24, maxWidth: "48%" },
  row: { flexDirection: "row", alignItems: "center", gap: space(1) },
  chip: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: space(1.5),
    paddingRight: space(1),
  },
  label: { fontSize: 11, fontWeight: "700", maxWidth: 88 },
  remove: { width: 13, height: 16, alignItems: "center", justifyContent: "center" },
});