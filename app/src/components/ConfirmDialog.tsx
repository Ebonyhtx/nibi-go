// 统一确认弹窗：高风险动作（完全访问等）用应用内卡片，不用系统 Alert。
//
// 与权限菜单同一套圆角/描边/品牌色，避免 Android 系统弹窗风格割裂。

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="取消" />
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <View
            style={[
              styles.icon,
              { backgroundColor: danger ? t.amberSoft : t.brandSoft },
            ]}
          >
            <Icon name={danger ? "question" : "shield"} size={18} color={danger ? t.amber : t.brand} />
          </View>
          <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
          <Text style={[styles.message, { color: t.inkSub }]}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: t.panel, borderColor: t.hairline }]}
            >
              <Text style={[styles.cancelText, { color: t.inkSub }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              style={[
                styles.button,
                { backgroundColor: danger ? t.amber : t.brand, borderColor: danger ? t.amber : t.brand },
              ]}
            >
              <Text style={[styles.confirmText, { color: danger ? "#fff" : t.brandFg }]}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(20,26,36,0.34)",
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(5),
    gap: space(2),
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: typeScale.heading, fontWeight: "700" },
  message: { fontSize: 12, lineHeight: 19 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space(2), marginTop: space(2) },
  button: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
  },
  cancelText: { fontSize: 12, fontWeight: "600" },
  confirmText: { fontSize: 12, fontWeight: "700" },
});