// 设置页统一分组卡：小节标签（inkFaint 大写感）+ 卡片容器（card 底 + 发丝线 + card 圆角），
// 行之间画发丝分隔线。替换 settings/index 与各设置屏的 sectionLabel + card 组合。
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { radius, space, text, useNibiTheme } from "../../theme";

export function SectionCard({
  label,
  children,
  style,
}: {
  label?: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const th = useNibiTheme();
  return (
    <View style={[styles.group, style]}>
      {label ? (
        <Text style={[styles.label, { color: th.inkSub }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.card,
          { backgroundColor: th.card, borderColor: th.hairlineStrong },
          th.elevation.card,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** 行之间的发丝分隔线（在 SectionCard 的 children 里手动插在两行之间）。 */
export function Divider() {
  const th = useNibiTheme();
  return <View style={[styles.divider, { backgroundColor: th.hairline }]} />;
}

const styles = StyleSheet.create({
  group: {
    gap: space(1.5),
  },
  label: {
    ...text("micro"),
    fontWeight: "700",
    letterSpacing: 0.4,
    paddingHorizontal: space(2),
  },
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space(3.5),
  },
});
