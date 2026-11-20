// 设置页统一行：左侧圆底图标 + 标题/副题 + 右槽（chevron / 开关 / 值文本）。
// 合并 settings/conversation、phone、composer 三套各写各的 ToggleRow，
// 以及 index.tsx 里第 N 次复制的 row/rowIcon/rowText 结构。分隔线由父级 Section 处理。
import { StyleSheet, Switch, Text, View } from "react-native";
import type { ReactNode } from "react";

import { Icon, type IconName } from "../Icon";
import { PressableScale } from "../../motion/PressableScale";
import { radius, size, space, text, useNibiTheme, type NibiTheme } from "../../theme";

/** 行首图标的圆底色（按语义选 tone） */
export type RowTone = "brand" | "steel" | "ok" | "amber" | "red" | "plain";

export function rowToneColor(th: NibiTheme, tone: RowTone): string {
  switch (tone) {
    case "brand":
      return th.brand;
    case "steel":
      return th.steel;
    case "ok":
      return th.ok;
    case "amber":
      return th.amber;
    case "red":
      return th.red;
    case "plain":
      return th.inkSub;
  }
}

export function rowToneBackground(th: NibiTheme, tone: RowTone): string {
  switch (tone) {
    case "brand":
      return th.brandSoft;
    case "steel":
      return th.steelSoft;
    case "ok":
      return th.okSoft;
    case "amber":
      return th.amberSoft;
    case "red":
      return th.redSoft;
    case "plain":
      return th.surfaceSoft;
  }
}

export function Row({
  icon,
  tone = "brand",
  title,
  detail,
  onPress,
  right,
  danger,
}: {
  icon?: IconName;
  tone?: RowTone;
  title: string;
  detail?: string;
  onPress?: () => void;
  /** 右槽（值/开关/徽标）；不传且可按时显示 chevron */
  right?: ReactNode;
  /** 危险行（删除/退出）：标题与图标用 red */
  danger?: boolean;
}) {
  const th = useNibiTheme();
  const titleColor = danger ? th.red : th.ink;
  const iconColor = danger ? th.red : rowToneColor(th, tone);
  const iconBg = danger ? th.redSoft : rowToneBackground(th, tone);
  const body = (
    <>
      {icon ? (
        <View style={[styles.icon, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={15} color={iconColor} />
        </View>
      ) : null}
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: th.inkFaint }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right ??
        (onPress ? <Icon name="chevron-right" size={13} color={th.inkGhost} /> : null)}
    </>
  );
  if (onPress) {
    return (
      <PressableScale
        scaleTo={0.985}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? th.hover : "transparent" }]}
      >
        {body}
      </PressableScale>
    );
  }
  return <View style={styles.row}>{body}</View>;
}

/** 带开关的行（三套重复 ToggleRow 的唯一实现）。 */
export function ToggleRow({
  icon,
  tone = "brand",
  title,
  detail,
  value,
  onChange,
  disabled,
}: {
  icon?: IconName;
  tone?: RowTone;
  title: string;
  detail?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const th = useNibiTheme();
  return (
    <Row
      icon={icon}
      tone={tone}
      title={title}
      detail={detail}
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: th.surfaceSoft, true: th.brandSoft }}
          thumbColor={value ? th.brand : th.inkGhost}
          ios_backgroundColor={th.surfaceSoft}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  icon: {
    width: size.chipLg,
    height: size.chipLg,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...text("body"),
    fontWeight: "600",
  },
  detail: {
    ...text("small"),
  },
});
