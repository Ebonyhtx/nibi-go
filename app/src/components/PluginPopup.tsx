// 插件动作的气泡式浮层：锚在触发点旁边，带缩放/位移动效，不是全屏底部弹窗。
//
// 用于消息长按与加号子菜单。位置按触发点计算；空间不够时自动翻到另一侧，并夹在屏幕内。

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

import { radius, space, useNibiTheme } from "../theme";

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
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      anim.setValue(0);
      return;
    }
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 260,
      mass: 0.7,
    }).start();
  }, [anim, visible]);

  if (!visible || !anchor) return null;

  const popupWidth = Math.min(width, screenWidth - space(8));
  const left = Math.max(
    space(4),
    Math.min(screenWidth - popupWidth - space(4), anchor.x + anchor.width / 2 - popupWidth / 2),
  );
  const aboveTop = anchor.y - height - 10;
  const belowTop = anchor.y + anchor.height + 10;
  const placeAbove = aboveTop >= insets.top + space(2);
  const maxTop = screenHeight - insets.bottom - space(4) - height;
  const top = Math.max(
    insets.top + space(2),
    Math.min(placeAbove ? aboveTop : belowTop, maxTop),
  );
  const arrowLeft = Math.max(
    16,
    Math.min(popupWidth - 30, anchor.x + anchor.width / 2 - left - 8),
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭插件菜单"
        />
        <Animated.View
          style={[
            styles.card,
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
    backgroundColor: "rgba(20,26,36,0.18)",
  },
  card: {
    position: "absolute",
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(2),
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  arrow: {
    position: "absolute",
    width: 10,
    height: 10,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: "45deg" }],
  },
});