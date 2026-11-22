// 可折叠摘要行（思考块 / 工具行 / 工具组共用）：
//   头部一行 = 图标 + 标题 + 副标题 + 旋转折角，点整行切换；
//   展开体可选左侧细线（rail），展开时微淡入，流式期间不对高度做动画以免每帧重排抖动。
import { memo, useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { haptic } from "../motion/haptics";
import { useDevicePreferences } from "../settings/devicePreferences";
import { space, useNibiTheme } from "../theme";
import { Icon } from "./Icon";

export interface DisclosureProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
  /** 展开体左侧竖线（思考正文 / 工具详情）。 */
  rail?: boolean;
  /** 紧凑胶囊头（折角紧跟标题，不撑满行宽）。 */
  compact?: boolean;
}

function DisclosureImpl({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  children,
  rail = false,
  compact = false,
}: DisclosureProps) {
  const th = useNibiTheme();
  const { motionEnabled } = useDevicePreferences();
  const chevron = useRef(new Animated.Value(open ? 1 : 0)).current;
  const bodyFade = useRef(new Animated.Value(open ? 1 : 0)).current;
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      chevron.setValue(open ? 1 : 0);
      bodyFade.setValue(open ? 1 : 0);
      return;
    }
    if (!motionEnabled) {
      chevron.setValue(open ? 1 : 0);
      bodyFade.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(chevron, {
      toValue: open ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
    if (open) {
      bodyFade.setValue(0);
      Animated.timing(bodyFade, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [bodyFade, chevron, motionEnabled, open]);

  const rotate = chevron.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });

  return (
    <View>
      <Pressable
        onPress={() => {
          haptic("tick");
          onToggle();
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={6}
        style={({ pressed }) => [styles.header, pressed ? { opacity: 0.62 } : null]}
      >
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <View style={compact ? styles.titleCompact : styles.title}>
          {typeof title === "string" || typeof title === "number" ? (
            <Text style={[styles.titleText, { color: th.inkSub }]} numberOfLines={1}>
              {title}
            </Text>
          ) : (
            title
          )}
        </View>
        {subtitle ? (
          <View style={styles.subtitle}>
            {typeof subtitle === "string" || typeof subtitle === "number" ? (
              <Text style={[styles.subtitleText, { color: th.inkGhost }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : (
              subtitle
            )}
          </View>
        ) : null}
        <Animated.View style={[compact ? styles.chevronCompact : styles.chevron, { transform: [{ rotate }] }]}>
          <Icon name="chevron-right" size={13} color={th.inkFaint} />
        </Animated.View>
      </Pressable>
      {open && children ? (
        <Animated.View
          style={[
            styles.body,
            { opacity: bodyFade },
            rail
              ? {
                  borderLeftWidth: 2,
                  borderLeftColor: th.hairline,
                  paddingLeft: space(3),
                }
              : null,
          ]}
        >
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

export const Disclosure = memo(DisclosureImpl);

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space(1.5), minHeight: 28 },
  icon: { alignItems: "center", justifyContent: "center" },
  // 标题不参与挤压；超长时由调用方的 Text 自行截断。
  title: { flexShrink: 0, maxWidth: "60%" },
  titleCompact: { flexShrink: 0 },
  titleText: { fontSize: 12.5, fontWeight: "600" },
  // 副标题吃掉剩余宽度：流式预览靠 head 省略显示最新尾巴。
  // 用内容做基准（不写 flex:1），思考块这种宽度自适应的容器里也不会被压成 0。
  subtitle: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  subtitleText: { fontSize: 11 },
  // 没有副标题时也把折角顶到行尾。
  chevron: { marginLeft: "auto" },
  chevronCompact: { marginLeft: 2 },
  body: { paddingVertical: space(1), paddingLeft: space(1), gap: space(1.5) },
});
