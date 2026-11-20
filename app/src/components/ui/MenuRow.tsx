// 弹出菜单统一行：28px 圆底图标 + 标题/副题 + 右槽（chevron 或勾选）。
// 替换 index.tsx 五处内联菜单行 JSX 与 CapsuleStack/PluginActionSheet 的各自版本；
// 与设置页 Row 的差别：菜单行更紧凑（minHeight 44）、图标底 28px、在 PluginPopup 内使用。
import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";

import { Icon, type IconName } from "../Icon";
import { PressableScale } from "../../motion/PressableScale";
import { rowToneBackground, rowToneColor, type RowTone } from "./Row";
import { radius, space, text, useNibiTheme } from "../../theme";

export function MenuRow({
  icon,
  tone = "plain",
  label,
  detail,
  onPress,
  right,
  disabled,
}: {
  icon: IconName;
  tone?: RowTone;
  label: string;
  detail?: string;
  onPress?: () => void;
  /** 右槽（勾选/计数/开关）；缺省且可按 = chevron */
  right?: ReactNode;
  disabled?: boolean;
}) {
  const th = useNibiTheme();
  return (
    <PressableScale
      scaleTo={0.97}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed && !disabled ? th.hover : "transparent" },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: rowToneBackground(th, tone) }]}>
        <Icon name={icon} size={15} color={disabled ? th.inkGhost : rowToneColor(th, tone)} />
      </View>
      <View style={styles.textCol}>
        <Text style={[styles.label, { color: disabled ? th.inkFaint : th.ink }]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: th.inkFaint }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={13} color={th.inkGhost} /> : null)}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
    gap: 1,
  },
  label: {
    ...text("body"),
    fontWeight: "600",
  },
  detail: {
    ...text("micro"),
  },
});
