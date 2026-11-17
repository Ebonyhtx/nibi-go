// 注释编辑器：从任意消息里选一段原文，写可选评论或插件指令。
//
// 选区有两种方式：
// - 在只读文本里长按/拖动系统选择柄，拿 onSelectionChange 的 start/end；
// - 点下面的段落胶囊，直接选中一段（长消息上比拖选择柄稳）。
//
// 发送时只把选中的片段 + 评论/指令放进 conversationQuotes，不复制整条消息。

import { useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export interface AnnotationDraft {
  excerpt: string;
  comment: string;
}

function paragraphsOf(text: string): string[] {
  const chunks: string[] = [];
  for (const line of text.split(/\n+/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 长行再按句切开：手机上拖选择柄不稳时，仍能选到“一小段”。
    if (trimmed.length <= 80) {
      chunks.push(trimmed);
    } else {
      chunks.push(
        ...trimmed
          .split(/(?<=[。！？!?])\s*/u)
          .map((part) => part.trim())
          .filter(Boolean),
      );
    }
  }
  return chunks;
}

export function AnnotationComposer({
  visible,
  fullText,
  initialExcerpt,
  initialComment,
  instruction,
  instructionLabel,
  editing,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  fullText: string;
  initialExcerpt?: string;
  initialComment?: string;
  instruction?: string;
  instructionLabel?: string;
  editing?: boolean;
  onCancel: () => void;
  onSubmit: (draft: AnnotationDraft) => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [comment, setComment] = useState(initialComment ?? "");
  const [excerpt, setExcerpt] = useState(initialExcerpt ?? fullText);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setComment(initialComment ?? "");
    setExcerpt(initialExcerpt?.trim() ? initialExcerpt : fullText);
  }, [fullText, initialComment, initialExcerpt, visible]);

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

  const paragraphs = useMemo(() => paragraphsOf(fullText), [fullText]);
  const selected = excerpt.trim();
  const length = selected.length;

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
            <View style={styles.headText}>
              <Text style={[styles.title, { color: t.ink }]}>
                {editing
                  ? "编辑注释"
                  : instruction
                    ? `用注释执行「${instructionLabel ?? "注释指令"}」`
                    : "添加注释"}
              </Text>
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                长按/拖动选择原文；不选则整条 · 已选 {length} 字
              </Text>
            </View>
          </View>

          {instruction ? (
            <View style={[styles.instruction, { backgroundColor: t.brandSoft }]}>
              <Icon name="sparkles" size={11} color={t.brand} />
              <Text style={[styles.instructionText, { color: t.brand }]} numberOfLines={1}>
                指令：{instruction}
              </Text>
            </View>
          ) : null}

          <View style={[styles.quote, { backgroundColor: t.panel, borderColor: t.hairline }]}>
            <TextInput
              value={fullText}
              multiline
              editable={false}
              showSoftInputOnFocus={false}
              onSelectionChange={(event) => {
                const { start, end } = event.nativeEvent.selection;
                if (end > start) {
                  const next = fullText.slice(start, end).trim();
                  if (next) setExcerpt(next);
                }
              }}
              scrollEnabled
              style={[styles.quoteText, { color: t.inkSub }]}
            />
          </View>

          {paragraphs.length > 1 ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.paragraphRow}
            >
              <Pressable
                onPress={() => setExcerpt(fullText)}
                style={[styles.paragraph, { backgroundColor: t.panel, borderColor: t.hairline }]}
              >
                <Text style={[styles.paragraphText, { color: t.inkSub }]}>整条</Text>
              </Pressable>
              {paragraphs.map((paragraph, index) => {
                const active = selected === paragraph;
                return (
                  <Pressable
                    key={`${index}:${paragraph.slice(0, 12)}`}
                    onPress={() => setExcerpt(paragraph)}
                    style={[
                      styles.paragraph,
                      {
                        backgroundColor: active ? t.brandSoft : t.panel,
                        borderColor: active ? t.brandSoft : t.hairline,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.paragraphText, { color: active ? t.brand : t.inkSub }]}
                    >
                      第 {index + 1} 段
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <TextInput
            value={comment}
            onChangeText={setComment}
            multiline
            placeholder={
              instruction
                ? "补充要求（可选）。模型会同时看到选中的原文和这条指令。"
                : "评论（可选）。模型会看到选中的原文和这条评论。"
            }
            placeholderTextColor={t.inkFaint}
            style={[styles.input, { color: t.ink, borderColor: t.hairline, backgroundColor: t.card }]}
            textAlignVertical="top"
          />

          <View style={styles.foot}>
            <Text style={[styles.footHint, { color: t.inkFaint }]} numberOfLines={1}>
              {selected ? `将引用：${selected.slice(0, 28)}${selected.length > 28 ? "…" : ""}` : "请选择原文"}
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="取消">
                <Text style={[styles.cancel, { color: t.inkSub }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  onSubmit({ excerpt: selected || fullText.trim(), comment: comment.trim() })
                }
                disabled={!selected && !fullText.trim()}
                accessibilityRole="button"
                accessibilityLabel={editing ? "保存注释" : "添加注释"}
                style={({ pressed }) => [
                  styles.submit,
                  {
                    backgroundColor: t.brand,
                    opacity: !selected && !fullText.trim() ? 0.4 : pressed ? 0.75 : 1,
                  },
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
    gap: space(2),
    maxHeight: "86%",
  },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  badge: {
    width: 26,
    height: 26,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: typeScale.body, fontWeight: "700" },
  hint: { fontSize: 10.5 },
  instruction: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 3,
    maxWidth: "100%",
  },
  instructionText: { fontSize: 10.5, fontWeight: "700", flexShrink: 1 },
  quote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2),
    maxHeight: 150,
  },
  quoteText: { fontSize: 12, lineHeight: 17 },
  paragraphRow: { flexDirection: "row", gap: space(1.5), alignItems: "center" },
  paragraph: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 3,
  },
  paragraphText: { fontSize: 10, fontWeight: "600" },
  input: {
    minHeight: 74,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
    fontSize: 13,
    lineHeight: 18,
  },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  footHint: { flex: 1, fontSize: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: space(3) },
  cancel: { fontSize: 13, fontWeight: "600" },
  submit: {
    borderRadius: radius.chip,
    paddingHorizontal: space(4),
    paddingVertical: space(2),
  },
  submitText: { fontSize: 13, fontWeight: "700" },
});