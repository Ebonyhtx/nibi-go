// 注释编辑器：从任意消息里选一段原文，写可选评论或插件指令。
//
// 选区：点下面的段落胶囊选中一段（长消息上比拖选择柄稳）；选中段在预览里同步
// 变色，用户能直接看到引用的是原文哪一部分。
//
// 发送时只把选中的片段 + 评论/指令放进 conversationQuotes，不复制整条消息。
// 2.0：视觉全部换成 theme token；底座统一到 ui/Sheet（avoidKeyboard UI 线程上抬 + 下拉关闭）。

import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Icon } from "./Icon";
import { PillButton } from "./ui/PillButton";
import { Sheet } from "./ui/Sheet";
import { PressableScale } from "../motion/PressableScale";
import { haptic } from "../motion/haptics";
import { radius, size, space, text, useNibiTheme } from "../theme";

export interface AnnotationDraft {
  excerpt: string;
  comment: string;
}

interface Segment {
  text: string;
  start: number;
  end: number;
}

/**
 * 可点选的原文片段：按行切；单行过长再按句切。保留原文偏移，点选后能让
 * TextInput 的 selection 真正高亮对应范围。
 */
function segmentsOf(text: string): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const trimmedStart = lineStart + line.indexOf(trimmed);
    if ([...trimmed].length <= 80) {
      segments.push({ text: trimmed, start: trimmedStart, end: trimmedStart + trimmed.length });
      continue;
    }
    let cursor = 0;
    for (const part of trimmed.split(/(?<=[。！？!?])\s*/u)) {
      const value = part.trim();
      if (value) {
        const at = trimmed.indexOf(value, cursor);
        const start = trimmedStart + (at >= 0 ? at : cursor);
        segments.push({ text: value, start, end: start + value.length });
        cursor = (at >= 0 ? at : cursor) + part.length;
      } else {
        cursor += part.length;
      }
    }
  }
  return segments;
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
  const [comment, setComment] = useState(initialComment ?? "");
  const [excerpt, setExcerpt] = useState(initialExcerpt ?? fullText);
  const [selection, setSelection] = useState({ start: 0, end: fullText.length });
  const [commentFocused, setCommentFocused] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setComment(initialComment ?? "");
    const initial = initialExcerpt?.trim() ? initialExcerpt : fullText;
    setExcerpt(initial);
    const at = initial && initial !== fullText ? fullText.indexOf(initial) : -1;
    setSelection(
      at >= 0
        ? { start: at, end: at + initial.length }
        : { start: 0, end: fullText.length },
    );
  }, [fullText, initialComment, initialExcerpt, visible]);

  const segments = useMemo(() => segmentsOf(fullText), [fullText]);
  const selected = excerpt.trim();
  const length = selected.length;
  const selectSegment = (segment: Segment) => {
    haptic("tick");
    setExcerpt(segment.text);
    setSelection({ start: segment.start, end: segment.end });
  };

  return (
    <Sheet visible={visible} onClose={onCancel} maxHeightRatio={0.9} avoidKeyboard>
      <View style={styles.sheet}>
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
                点选下面段落，或点「整条」· 已选 {length} 字
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

          <ScrollView
            style={[styles.quote, { backgroundColor: t.surfaceSoft, borderColor: t.hairline }]}
            contentContainerStyle={styles.quoteInner}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <Text style={[styles.quoteText, { color: t.inkSub }]}>
              {segments.map((segment, index) => {
                const active =
                  selection.end > selection.start &&
                  selection.start < segment.end &&
                  selection.end > segment.start;
                return (
                  <Text
                    key={`preview:${index}:${segment.start}`}
                    onPress={() => selectSegment(segment)}
                    style={
                      active
                        ? { backgroundColor: t.brandSoft, color: t.ink, fontWeight: "600" }
                        : undefined
                    }
                  >
                    {segment.text}
                    {index < segments.length - 1 ? "\n" : ""}
                  </Text>
                );
              })}
            </Text>
          </ScrollView>

          {segments.length > 1 ? (
            <View style={styles.segmentWrap}>
              <View style={styles.segmentHead}>
                <Text style={[styles.segmentTitle, { color: t.inkFaint }]}>
                  选择段落（长消息可上下滚动）
                </Text>
                <PressableScale
                  scaleTo={0.94}
                  onPress={() => {
                    setExcerpt(fullText);
                    setSelection({ start: 0, end: fullText.length });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="选择整条"
                  style={({ pressed }) => [
                    styles.segmentAll,
                    {
                      backgroundColor: pressed ? t.hover : t.surfaceSoft,
                      borderColor: t.hairline,
                    },
                  ]}
                >
                  <Text style={[styles.segmentAllText, { color: t.inkSub }]}>整条</Text>
                </PressableScale>
              </View>
              <ScrollView
                style={styles.segmentList}
                nestedScrollEnabled
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator
              >
                {segments.map((segment, index) => {
                  const active =
                    selection.start === segment.start && selection.end === segment.end;
                  return (
                    <PressableScale
                      key={`${index}:${segment.start}`}
                      scaleTo={0.985}
                      onPress={() => selectSegment(segment)}
                      accessibilityRole="button"
                      accessibilityLabel={`选择第 ${index + 1} 段`}
                      style={({ pressed }) => [
                        styles.segmentRow,
                        {
                          backgroundColor: active
                            ? t.brandSoft
                            : pressed
                              ? t.hover
                              : t.surfaceSoft,
                          borderColor: active ? t.brand : t.hairline,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.segmentNumber, { color: active ? t.brand : t.inkGhost }]}
                      >
                        {index + 1}
                      </Text>
                      <Text
                        style={[styles.segmentText, { color: active ? t.ink : t.inkSub }]}
                        numberOfLines={1}
                      >
                        {segment.text}
                      </Text>
                      {active ? <Icon name="check" size={12} color={t.brand} /> : null}
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <TextInput
            value={comment}
            onChangeText={setComment}
            onFocus={() => setCommentFocused(true)}
            onBlur={() => setCommentFocused(false)}
            multiline
            placeholder={
              instruction
                ? "补充要求（可选）。模型会同时看到选中的原文和这条指令。"
                : "评论（可选）。模型会看到选中的原文和这条评论。"
            }
            placeholderTextColor={t.inkFaint}
            style={[
              styles.input,
              {
                color: t.ink,
                borderColor: commentFocused ? t.hairlineStrong : t.hairline,
                backgroundColor: t.surfaceSoft,
              },
            ]}
            textAlignVertical="top"
          />

          <View style={styles.foot}>
            <Text style={[styles.footHint, { color: t.inkFaint }]} numberOfLines={1}>
              {selected ? `将引用：${selected.slice(0, 28)}${selected.length > 28 ? "…" : ""}` : "请选择原文"}
            </Text>
            <View style={styles.actions}>
              <PillButton variant="secondary" label="取消" onPress={onCancel} />
              <PillButton
                label={editing ? "保存" : "添加注释"}
                onPress={() => {
                  haptic("confirm");
                  onSubmit({ excerpt: selected || fullText.trim(), comment: comment.trim() });
                }}
                disabled={!selected && !fullText.trim()}
                accessibilityLabel={editing ? "保存注释" : "添加注释"}
              />
            </View>
          </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: space(4),
    paddingBottom: space(3),
    paddingTop: space(1),
    gap: space(2),
  },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  badge: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { flex: 1, gap: 2 },
  title: { ...text("body"), fontWeight: "700" },
  hint: { ...text("micro") },
  instruction: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: space(1),
    maxWidth: "100%",
  },
  instructionText: { ...text("micro"), fontWeight: "700", flexShrink: 1 },
  quote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    maxHeight: 180,
  },
  quoteInner: { padding: space(2) },
  quoteText: { ...text("small") },
  segmentWrap: { gap: space(1) },
  segmentHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  segmentTitle: { ...text("micro") },
  segmentAll: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    height: size.chip,
    justifyContent: "center",
  },
  segmentAllText: { ...text("micro"), fontWeight: "600" },
  segmentList: { maxHeight: 122 },
  segmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    minHeight: size.chipLg,
    marginBottom: space(1),
  },
  segmentNumber: { width: space(3.5), ...text("micro"), fontWeight: "700", textAlign: "right" },
  segmentText: { flex: 1, ...text("small") },
  input: {
    minHeight: space(18),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
    ...text("body"),
  },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  footHint: { flex: 1, ...text("micro") },
  actions: { flexDirection: "row", alignItems: "center", gap: space(2) },
});
