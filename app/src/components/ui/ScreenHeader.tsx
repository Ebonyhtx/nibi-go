// 二级页面统一头部：返回钮（40 玻璃圆 + PressableScale）+ 居中标题/副题 + 右槽。
// 替换 market/plugins/island/panel/7 个 settings 各自复制的 root/head/back/title 三元组——
// 那些实现的圆角（11/12/radius.chip）与底色（panel/glass）各写各的，是 2.0 之前最大的不一致源。
// 自带安全区顶部内边距，页面根布局不再自己算 insets.top。
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { Icon } from "../Icon";
import { PressableScale } from "../../motion/PressableScale";
import { radius, size, space, text, useNibiTheme } from "../../theme";

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  bottom,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** 头部右槽（刷新/动作按钮），垂直居中 */
  right?: ReactNode;
  /** 头部下沿的附加内容（搜索框等） */
  bottom?: ReactNode;
}) {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.head, { paddingTop: insets.top + space(1.5) }]}>
      <View style={styles.headRow}>
        <View style={styles.headSide}>
          {onBack ? (
            <PressableScale
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="返回"
              hitSlop={8}
              style={[
                styles.back,
                { backgroundColor: th.glass, borderColor: th.glassBorder },
              ]}
            >
              <Icon name="chevron-left" size={18} color={th.ink} />
            </PressableScale>
          ) : null}
        </View>
        <View style={styles.headCenter}>
          <Text style={[styles.title, { color: th.ink }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: th.inkFaint }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.headSide}>{right}</View>
      </View>
      {bottom}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space(1.5),
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(3),
    minHeight: size.topbar,
  },
  headSide: {
    minWidth: size.button,
    alignItems: "flex-start",
  },
  headCenter: {
    flex: 1,
    alignItems: "center",
    gap: 1,
  },
  back: {
    width: size.button,
    height: size.button,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...text("heading"),
    fontWeight: "700",
  },
  subtitle: {
    ...text("micro"),
  },
});
