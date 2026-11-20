// 统一底部弹层底座：背景淡入 + 内容从底部滑入滑出（320ms 契约 + enter 贝塞尔）。
// 替换 6 个各写各的 `Modal animationType="fade"`（ModelPickerSheet/ModelConfigSheet/
// PluginActionSheet/AnnotationComposer/AnnotationManager/ConfirmDialog）——
// 那些只有淡入没有位移，且遮罩透明度 0.18/0.26/0.28/0.34 四种并存。
// 用法：<Sheet visible={open} onClose={() => setOpen(false)}>{children}</Sheet>
// 收起动画期间组件保持挂载（visible=false 后再卸载），父级不需要管退出动画。
import { Animated, Modal, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { easingEnter, easingExit } from "../../motion/easing";
import { motion, radius, useNibiTheme } from "../../theme";

export function Sheet({
  visible,
  onClose,
  children,
  maxHeightRatio = 0.84,
  /** 危险/沉浸弹层用加深遮罩 */
  strong = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeightRatio?: number;
  strong?: boolean;
}) {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  // visible 变 false 时先播退出动画再卸载 Modal。
  const [rendered, setRendered] = useState(visible);
  const [interactive, setInteractive] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setInteractive(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: motion.duration.slow,
        easing: easingEnter,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!rendered) return;
    setInteractive(false);
    Animated.timing(progress, {
      toValue: 0,
      duration: motion.duration.base,
      easing: easingExit,
      useNativeDriver: true,
    }).start(() => setRendered(false));
  }, [visible, rendered, progress]);

  if (!rendered) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <TouchableWithoutFeedback onPress={onClose} disabled={!interactive}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: strong ? th.backdropStrong : th.backdrop, opacity: progress },
            ]}
          />
        </TouchableWithoutFeedback>
        <Animated.View
          pointerEvents={interactive ? "auto" : "none"}
          style={[
            styles.content,
            {
              maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
              backgroundColor: th.card,
              marginBottom: insets.bottom,
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [240, 0],
                  }),
                },
                {
                  scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }),
                },
              ],
            },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    overflow: "hidden",
  },
});
