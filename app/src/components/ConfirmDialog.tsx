// 统一确认弹窗：高风险动作（完全访问等）用应用内卡片，不用系统 Alert。
//
// 2.0：居中式交互保留（确认类不该从底部滑出），但补了入场动效——
// 遮罩淡入 + 卡片 scale/translate 弹簧；遮罩/投影/字阶全部走 token。
// 与权限菜单同一套圆角/描边/品牌色，避免 Android 系统弹窗风格割裂。
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
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
  const progress = useRef(new Animated.Value(0)).current;
  // 关闭时先播退出再卸载（visible=false 的那一刻不能直接 return null）。
  const [rendered, setRendered] = useState(visible);
  const [interactive, setInteractive] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setInteractive(true);
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        ...motion.spring.gentle,
      }).start();
      return;
    }
    if (!rendered) return;
    setInteractive(false);
    Animated.timing(progress, {
      toValue: 0,
      duration: motion.duration.fast,
      useNativeDriver: true,
    }).start(() => setRendered(false));
  }, [visible, rendered, progress]);

  if (!rendered) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Animated.View
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
              onPress={onCancel}
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: t.panel, borderColor: t.hairline }]}
            >
              <Text style={[styles.cancelText, { color: t.inkSub }]}>{cancelLabel}</Text>
            </PressableScale>
            <PressableScale
              onPress={onConfirm}
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
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropPress: {
    flex: 1,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(5),
    gap: space(2),
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...text("heading"), fontWeight: "700" },
  message: { ...text("small") },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space(2), marginTop: space(2) },
  button: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
  },
  cancelText: { ...text("small"), fontWeight: "600" },
  confirmText: { ...text("small"), fontWeight: "700" },
});
