// 二级页面统一头部：返回钮（不透明 card + PressableScale）+ 真正居中的标题/副题 + 右槽。
// 标题使用独立绝对居中层：哪怕右侧放了宽胶囊按钮（如「插件市场」），标题依然视觉居中不偏左。
import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../Icon";
import { useI18n } from "../../i18n";
import { METRICS } from "../../layout/adaptive";
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
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const [rightWidth, setRightWidth] = useState<number>(size.button);
  // 右槽较宽时（如英文 Marketplace + 镜像按钮）给中心标题区让出右侧安全宽，避免文字重叠。
  const rightSafe = Math.max(64, Math.ceil(rightWidth) + space(4));
  const leftSafe = rightSafe > 88 ? 58 : rightSafe;
  return (
    <View
      style={[
        styles.head,
        {
          paddingTop: insets.top + space(1.5),
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <View style={styles.headInner}>
        <View style={styles.headRow}>
          <View style={styles.headLeft}>
            {onBack ? (
              <PressableScale
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel={pick("返回", "Back")}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.back,
                  {
                    backgroundColor: pressed ? th.hover : th.card,
                    borderColor: th.hairline,
                    ...th.elevation.card,
                  },
                ]}
              >
                <Icon name="chevron-left" size={18} color={th.ink} />
              </PressableScale>
            ) : null}
          </View>
          <View pointerEvents="none" style={[styles.headCenter, { left: leftSafe, right: rightSafe }]}>
            <Text style={[styles.title, { color: th.ink }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: th.inkFaint }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <View
            style={styles.headRight}
            onLayout={(event) => {
              const w = event.nativeEvent.layout.width;
              if (Math.abs(w - rightWidth) > 1) setRightWidth(w);
            }}
          >
            {right}
          </View>
        </View>
        {bottom}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    alignItems: "center",
  },
  headInner: {
    width: "100%",
    maxWidth: METRICS.secondaryMax,
    gap: space(1.5),
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space(3),
    minHeight: size.topbar,
  },
  headLeft: {
    minWidth: size.button,
    alignItems: "flex-start",
    zIndex: 1,
  },
  headRight: {
    minWidth: size.button,
    alignItems: "flex-end",
    zIndex: 1,
  },
  headCenter: {
    position: "absolute",
    left: 64,
    right: 64,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
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
