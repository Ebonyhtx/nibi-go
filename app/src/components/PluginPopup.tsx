// 插件动作的气泡式浮层：锚在触发点旁边，带缩放/位移动效，不是全屏底部弹窗。
//
// 用于消息长按与加号子菜单。位置按触发点计算；空间不够时自动翻到另一侧，并夹在屏幕内。
//
// 动效与 Sheet 同一套契约：进场弹簧、退场 150ms 收小淡出（期间保持挂载），
// 锚点/内容在关闭后仍用最后一次的值——否则父级把状态清成 null 的那一帧，
// 卡片会直接消失（运营者看到的「菜单一闪就没」）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { easingExit } from "../motion/easing";
import { motion, radius, space, useNibiTheme } from "../theme";

export interface PopupAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PluginPopup({
  visible,
  anchor,
  onClose,
  children,
  width = 300,
}: {
  visible: boolean;
  anchor: PopupAnchor | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const [rendered, setRendered] = useState(visible);
  const [interactive, setInteractive] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;
  // 关闭时父级通常会同时把 anchor 置空；退场期间沿用最后一次锚点。
  const anchorRef = useRef<PopupAnchor | null>(anchor);
  if (anchor) anchorRef.current = anchor;
  // 退场回调到点时要确认「现在还是关着的」：关→立刻重开会把刚打开的卡片卸掉。
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setInteractive(true);
      anim.setValue(0);
      // 等一帧让 onLayout 把真实高度量出来再起弹簧：height 初值 0 时 top 是按
      // 0 高算的，直接弹会先出现在错误位置再往上跳（加号菜单实测跳 430px）。
      const id = requestAnimationFrame(() => {
        Animated.spring(anim, {
          toValue: 1,
          useNativeDriver: true,
          damping: 18,
          stiffness: 260,
          mass: 0.7,
        }).start();
      });
      return () => cancelAnimationFrame(id);
    }
    if (!rendered) return;
    setInteractive(false);
    Animated.timing(anim, {
      toValue: 0,
      duration: motion.duration.fast,
      easing: easingExit,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visibleRef.current) setRendered(false);
    });
  }, [anim, visible, rendered]);

  const shownAnchor = anchor ?? anchorRef.current;
  if (!rendered || !shownAnchor) return null;

  const popupWidth = Math.min(width, screenWidth - space(8));
  const left = Math.max(
    space(4),
    Math.min(
      screenWidth - popupWidth - space(4),
      shownAnchor.x + shownAnchor.width / 2 - popupWidth / 2,
    ),
  );
  const aboveTop = shownAnchor.y - height - 10;
  const belowTop = shownAnchor.y + shownAnchor.height + 10;
  const placeAbove = aboveTop >= insets.top + space(2);
  const maxTop = screenHeight - insets.bottom - space(4) - height;
  const top = Math.max(
    insets.top + space(2),
    Math.min(placeAbove ? aboveTop : belowTop, maxTop),
  );
  const arrowLeft = Math.max(
    16,
    Math.min(popupWidth - 30, shownAnchor.x + shownAnchor.width / 2 - left - 8),
  );

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View
          style={[
            styles.backdrop,
            { backgroundColor: t.backdrop, opacity: anim },
          ]}
          pointerEvents={interactive ? "auto" : "none"}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="关闭插件菜单"
          />
        </Animated.View>
        <Animated.View
          pointerEvents={interactive ? "auto" : "none"}
          style={[
            styles.card,
            t.elevation.menu,
            {
              left,
              top,
              width: popupWidth,
              backgroundColor: t.card,
              borderColor: t.hairline,
              opacity: anim,
              transform: [
                {
                  scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
                },
                {
                  translateY: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [placeAbove ? 8 : -8, 0],
                  }),
                },
              ],
            },
          ]}
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        >
          <View
            style={[
              styles.arrow,
              {
                left: arrowLeft,
                backgroundColor: t.card,
                borderColor: t.hairline,
                [placeAbove ? "bottom" : "top"]: -5,
              },
            ]}
          />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    position: "absolute",
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(2),
  },
  arrow: {
    position: "absolute",
    width: 10,
    height: 10,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: "45deg" }],
  },
});
