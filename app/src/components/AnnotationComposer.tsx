// 注释编辑器：引用一条助手消息，写一段可选评论，随下一次发送一起交给模型。

import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export function AnnotationComposer({
  visible,
  messageText,
  initialComment,
  editing,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  messageText: string;
  initialComment?: string;
  editing?: boolean;
  onCancel: () => void;
  onSubmit: (comment: string) => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [comment, setComment] = useState(initialComment ?? "");
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (visible) setComment(initialComment ?? "");
  }, [initialComment, visible]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="取消注释" />
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.card,
              borderColor: t.hairline,
              paddingBottom: keyboardHeight > 0 ? space(3) : insets.bottom + space(3),
              marginBottom: Platform.OS === "android" ? keyboardHeight : 0,
            },
          ]}
        >
          <View style={styles.head}>
            <View style={[styles.badge, { backgroundColor: t.brandSoft }]}>
              <Icon name="quote" size={13} color={t.brand} />
            </View>
            <Text style={[styles.title, { color: t.ink }]}>
              {editing ? "编辑注释 · 评论可选" : "添加注释 · 评论可选"}
            </Text>
          </View>

          <View style={[styles.quote, { backgroundColor: t.panel, borderLeftColor: t.brand }]}>
            <Text style={[styles.quoteText, { color: t.inkSub }]} numberOfLines={4}>
              {messageText.trim()}
            </Text>
          </View>

          <TextInput
            value={comment}
            onChangeText={setComment}
            multiline
            autoFocus
            placeholder="写下评论（可选），和这段原文一起发给模型"
            placeholderTextColor={t.inkFaint}
            style={[
              styles.input,
              { color: t.ink, borderColor: t.hairline, backgroundColor: t.card },
            ]}
            textAlignVertical="top"
          />

          <View style={styles.foot}>
            <Text style={[styles.hint, { color: t.inkFaint }]}>留空也可添加</Text>
            <View style={styles.actions}>
              <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="取消">
                <Text style={[styles.cancel, { color: t.inkSub }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => onSubmit(comment.trim())}
                accessibilityRole="button"
                accessibilityLabel={editing ? "保存注释" : "添加注释"}
                style={({ pressed }) => [
                  styles.submit,
                  { backgroundColor: t.brand, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Text style={[styles.submitText, { color: t.brandFg }]}>
                  {editing ? "保存" : "添加注释"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(20,26,36,0.26)",
  },
  card: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(4),
    gap: space(2.5),
  },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  badge: {
    width: 26,
    height: 26,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: typeScale.body, fontWeight: "700" },
  quote: { borderLeftWidth: 3, borderRadius: radius.control, padding: space(2.5) },
  quoteText: { fontSize: 11.5, lineHeight: 16 },
  input: {
    minHeight: 92,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(3),
    fontSize: 13,
    lineHeight: 18,
  },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hint: { fontSize: 10.5 },
  actions: { flexDirection: "row", alignItems: "center", gap: space(3) },
  cancel: { fontSize: 13, fontWeight: "600" },
  submit: {
    borderRadius: radius.chip,
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
  submitText: { fontSize: 13, fontWeight: "700" },
});