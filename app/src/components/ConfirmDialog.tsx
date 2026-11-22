// 统一确认弹窗：高风险动作（完全访问等）用应用内卡片，不用系统 Alert。
//
// 2.0：居中式交互，遮罩淡入 + 卡片 scale/translate 弹簧，支持全屏沉浸遮罩、
// 关→重开退场守卫（不会误卸刚重开的 Modal）、减少动效直出与确认触觉。
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { useReducedMotion } from "../motion/appear";
import { easingExit } from "../motion/easing";
import { haptic } from "../motion/haptics";
import { PressableScale } from "../motion/PressableScale";
import { motion, radius, space, text, useNibiTheme } from "../theme";

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = "取消",
  danger = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useNibiTheme();
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(visible);
  const [interactive, setInteractive] = useState(visible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setInteractive(true);
      if (reduced) {
        progress.setValue(1);
        return;
      }
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        ...motion.spring.gentle,
      }).start();
      return;
    }
    if (!rendered) return;
    setInteractive(false);
    if (reduced) {
      progress.setValue(0);
      setRendered(false);
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: motion.duration.fast,
      easing: easingExit,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visibleRef.current) setRendered(false);
    });
  }, [visible, rendered, progress, reduced]);

  if (!rendered) return null;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onCancel}
    >
      <View style={styles.root}>
        <Animated.View
          pointerEvents={interactive ? "auto" : "none"}
          style={[styles.backdrop, { backgroundColor: t.backdropStrong, opacity: progress }]}
        >
          <Pressable style={styles.backdropPress} onPress={onCancel} accessibilityLabel="取消" />
        </Animated.View>
        <Animated.View
          pointerEvents={interactive ? "auto" : "none"}
          style={[
            styles.card,
            { backgroundColor: t.card, borderColor: t.hairline },
            t.elevation.float,
            {
              opacity: progress,
              transform: [
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                {
                  translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: danger ? t.amberSoft : t.brandSoft }]}>
            <Icon
              name={danger ? "question" : "shield"}
              size={18}
              color={danger ? t.amber : t.brand}
            />
          </View>
          <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
          <Text style={[styles.message, { color: t.inkSub }]}>{message}</Text>
          <View style={styles.actions}>
            <PressableScale
              containerStyle={styles.buttonWrap}
              onPress={onCancel}
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: t.panel, borderColor: t.hairline }]}
            >
              <Text style={[styles.cancelText, { color: t.inkSub }]}>{cancelLabel}</Text>
            </PressableScale>
            <PressableScale
              containerStyle={styles.buttonWrap}
              onPress={() => {
                haptic(danger ? "reject" : "confirm");
                onConfirm();
              }}
              accessibilityRole="button"
              style={[
                styles.button,
                {
                  backgroundColor: danger ? t.amber : t.brand,
                  borderColor: danger ? t.amber : t.brand,
                },
              ]}
            >
              <Text style={[styles.confirmText, { color: t.brandFg }]}>{confirmLabel}</Text>
            </PressableScale>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space(5),
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropPress: { flex: 1 },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(5),
    gap: space(2.5),
    alignItems: "center",
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...text("heading"), fontWeight: "700", textAlign: "center" },
  message: { ...text("small"), textAlign: "center" },
  actions: {
    flexDirection: "row",
    gap: space(2.5),
    marginTop: space(1.5),
    width: "100%",
  },
  buttonWrap: { flex: 1 },
  button: {
    height: 42,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { ...text("body"), fontWeight: "600" },
  confirmText: { ...text("body"), fontWeight: "700" },
});
