// 统一按钮：primary（品牌底）/ secondary（面板底+发丝线）/ danger（红）/ ghost（透明）。
// 高度走 size 阶梯，按压回弹内建（PressableScale），文案字阶统一 body。
// 替换 market/metrics/plugins/settings 里 borderRadius 11/12/chip 混用、
// disabled opacity 0.4 各写各的按钮样式。
import { StyleSheet, Text } from "react-native";

import { Icon, type IconName } from "../Icon";
import { PressableScale } from "../../motion/PressableScale";
import { radius, size, space, text, useNibiTheme } from "../../theme";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "md" | "lg";

const HEIGHT: Record<ButtonSize, number> = { md: size.button, lg: size.buttonLg };

export function PillButton({
  label,
  variant = "primary",
  /** 命名成 buttonSize 避开 RN 的 size 语义 */
  buttonSize = "md",
  onPress,
  disabled,
  /** 可选：label 前的 14px 图标 */
  icon,
  style,
  containerStyle,
  accessibilityLabel,
}: {
  label: string;
  variant?: ButtonVariant;
  buttonSize?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  icon?: IconName;
  style?: object;
  containerStyle?: object;
  accessibilityLabel?: string;
}) {
  const th = useNibiTheme();
  const surface = (() => {
    switch (variant) {
      case "primary":
        return {
          backgroundColor: th.brand,
          borderColor: th.brand,
          textColor: th.brandFg,
          elevated: true,
        };
      case "secondary":
        return {
          backgroundColor: th.surfaceSoft,
          borderColor: th.hairlineStrong,
          textColor: th.ink,
          elevated: false,
        };
      case "danger":
        return {
          backgroundColor: th.redSoft,
          borderColor: th.red,
          textColor: th.red,
          elevated: false,
        };
      case "ghost":
        return {
          backgroundColor: "transparent",
          borderColor: "transparent",
          textColor: th.brand,
          elevated: false,
        };
    }
  })();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      containerStyle={containerStyle}
      style={[
        styles.base,
        {
          height: HEIGHT[buttonSize],
          backgroundColor: surface.backgroundColor,
          borderColor: surface.borderColor,
        },
        surface.elevated && !disabled ? th.elevation.card : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={surface.textColor} /> : null}
      <Text style={[styles.label, { color: surface.textColor }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(1.5),
    borderRadius: radius.control,
    paddingHorizontal: space(4),
    borderWidth: StyleSheet.hairlineWidth,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    ...text("body"),
    fontWeight: "700",
  },
});
