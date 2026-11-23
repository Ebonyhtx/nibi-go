// 注释编辑器：从任意消息里选一段原文（单段 / 连续多段 / 整条 / 自由裁剪），写可选评论或插件指令。
//
// 选区：
//   · 点段落胶囊选单段；再点另一段连选连续区间；点「整条」一键全选；点「裁剪」自由编辑摘录片段；
//   · 预览直接基于原文切片渲染，不注入人为换行，选中区间高亮同步；
//   · 内置 shared-extract 协议上限校验（最多 8 条 / 单条 8,000 字 / 总计 16,000 字 / 评论 4,000 字）；
//   · 整页包进可滚容器并按窗口高度自适应，小屏与横屏弹出键盘时不顶出屏幕。

import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";

import { Icon } from "./Icon";
import { PillButton } from "./ui/PillButton";
import { Sheet } from "./ui/Sheet";
import {
  ANNOTATION_MAX_COMMENT_LENGTH,
  ANNOTATION_MAX_COUNT,
  ANNOTATION_MAX_EXCERPT_LENGTH,
  buildPreviewRuns,
  findExcerptSelection,
  rangeExcerptFromSegments,
  splitAnnotationSegments,
  validateAnnotationDraft,
  type AnnotationItem,
  type AnnotationSegment,
} from "../composer/annotations";
import { useI18n } from "../i18n";
import { PressableScale } from "../motion/PressableScale";
import { haptic } from "../motion/haptics";
import { radius, size, space, text, useNibiTheme } from "../theme";

export interface AnnotationDraft {
  excerpt: string;
  comment: string;
  selectionStart?: number;
  selectionEnd?: number;
}

const COMMENT_PRESETS: ReadonlyArray<{ zh: string; en: string }> = [
  { zh: "解释一下", en: "Explain this" },
  { zh: "精简要点", en: "Summarize" },
  { zh: "核查纠错", en: "Verify & fix" },
  { zh: "展开细节", en: "Expand details" },
];

export function AnnotationComposer({
  visible,
  fullText,
  initialExcerpt,
  initialComment,
  initialSelectionStart,
  initialSelectionEnd,
  instruction,
  instructionLabel,
  editing,
  editingId,
  existingAnnotations = [],
  transformCount = 0,
  transformChars = 0,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  fullText: string;
  initialExcerpt?: string;
  initialComment?: string;
  initialSelectionStart?: number;
  initialSelectionEnd?: number;
  instruction?: string;
  instructionLabel?: string;
  editing?: boolean;
  editingId?: string;
  existingAnnotations?: readonly AnnotationItem[];
  transformCount?: number;
  transformChars?: number;
  onCancel: () => void;
  onSubmit: (draft: AnnotationDraft) => void;
}) {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const { height: windowHeight } = useWindowDimensions();
  const compactHeight = windowHeight < 520;

  const [comment, setComment] = useState(initialComment ?? "");
  const [excerpt, setExcerpt] = useState(initialExcerpt ?? fullText);
  const [selection, setSelection] = useState({ start: 0, end: fullText.length });
  const [rangeIndices, setRangeIndices] = useState<[number, number] | null>(null);
  const [customTrimMode, setCustomTrimMode] = useState(false);
  const [commentFocused, setCommentFocused] = useState(false);

  const segments = useMemo(() => splitAnnotationSegments(fullText), [fullText]);

  useEffect(() => {
    if (!visible) return;
    setComment(initialComment ?? "");
    const initial = initialExcerpt?.trim() ? initialExcerpt : fullText;
    setExcerpt(initial);
    const sel = findExcerptSelection(
      fullText,
      initialExcerpt,
      initialSelectionStart,
      initialSelectionEnd,
    );
    setSelection(sel);
    setRangeIndices(null);
    setCustomTrimMode(false);
  }, [
    fullText,
    initialComment,
    initialExcerpt,
    initialSelectionEnd,
    initialSelectionStart,
    visible,
  ]);

  const isWhole = selection.start === 0 && selection.end === fullText.length && !customTrimMode;
  const previewRuns = useMemo(() => buildPreviewRuns(fullText, selection), [fullText, selection]);

  const validation = useMemo(
    () =>
      validateAnnotationDraft({
        existing: existingAnnotations,
        editingId,
        excerpt,
        comment,
        transformCount,
        transformChars,
      }),
    [comment, editingId, excerpt, existingAnnotations, transformChars, transformCount],
  );

  const validationMessage = useMemo(() => {
    if (validation.ok) return null;
    switch (validation.code) {
      case "empty":
        return pick("请先选择或输入要引用的原文", "Select or enter an excerpt to quote");
      case "max_count":
        return pick(
          `单条消息最多携带 ${validation.limit} 条引用`,
          `Up to ${validation.limit} quotes per message`,
        );
      case "excerpt_too_long":
        return pick(
          `单条摘录超出上限（${validation.current}/${validation.limit} 字），请改选单段或裁剪`,
          `Excerpt too long (${validation.current}/${validation.limit} chars) — pick a segment or trim`,
        );
      case "total_too_long":
        return pick(
          `所有注释总字数超出上限（${validation.current}/${validation.limit} 字）`,
          `Total quote length exceeded (${validation.current}/${validation.limit} chars)`,
        );
      case "comment_too_long":
        return pick(
          `评论超出上限（${validation.current}/${validation.limit} 字）`,
          `Comment too long (${validation.current}/${validation.limit} chars)`,
        );
    }
  }, [pick, validation]);

  const selectWhole = () => {
    haptic("tick");
    setCustomTrimMode(false);
    setRangeIndices(null);
    setExcerpt(fullText);
    setSelection({ start: 0, end: fullText.length });
  };

  const selectSegment = (index: number, segment: AnnotationSegment) => {
    haptic("tick");
    setCustomTrimMode(false);
    if (rangeIndices && rangeIndices[0] === rangeIndices[1] && rangeIndices[0] !== index) {
      // 已选单段时再点另一段 → 连选连续范围 [lo..hi]。
      const lo = Math.min(rangeIndices[0], index);
      const hi = Math.max(rangeIndices[0], index);
      const ranged = rangeExcerptFromSegments(fullText, segments, lo, hi);
      if (ranged) {
        setRangeIndices([lo, hi]);
        setExcerpt(ranged.excerpt);
        setSelection({ start: ranged.start, end: ranged.end });
        return;
      }
    }
    setRangeIndices([index, index]);
    setExcerpt(segment.text);
    setSelection({ start: segment.start, end: segment.end });
  };

  const toggleCustomTrim = () => {
    haptic("tick");
    setCustomTrimMode((prev) => !prev);
  };

  const applyPreset = (phrase: string) => {
    haptic("tick");
    setComment((current) => {
      const trimmed = current.trim();
      if (!trimmed) return phrase;
      if (trimmed.includes(phrase)) return current;
      return `${trimmed}，${phrase}`;
    });
  };

  const selected = excerpt.trim();
  const usedCount = editingId
    ? existingAnnotations.length
    : existingAnnotations.length + 1 + transformCount;
  const quoteMaxHeight = compactHeight ? 84 : 148;
  const segmentMaxHeight = compactHeight ? 84 : 124;

  const subtitle = customTrimMode
    ? pick("直接删改摘录文本，保留要引用的精确片段", "Trim the excerpt text to the exact phrase")
    : segments.length > 1
      ? pick(
          "点选单段，再点另一段可连选区间；或点「整条」/「裁剪」",
          "Tap a segment, tap another to select a range, or choose Full / Trim",
        )
      : pick("确认要引用的原文，可点击「裁剪」只留关键片段", "Confirm the quote, or tap Trim to narrow it down");

  return (
    <Sheet visible={visible} onClose={onCancel} maxHeightRatio={compactHeight ? 0.96 : 0.9} avoidKeyboard>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={[styles.badge, { backgroundColor: t.brandSoft }]}>
            <Icon name="quote" size={13} color={t.brand} />
          </View>
          <View style={styles.headText}>
            <Text style={[styles.title, { color: t.ink }]} numberOfLines={1}>
              {editing
                ? pick("编辑注释", "Edit annotation")
                : instruction
                  ? pick(
                      `用注释执行「${instructionLabel ?? "注释指令"}」`,
                      `Annotate with "${instructionLabel ?? "Instruction"}"`,
                    )
                  : pick("添加注释", "Add annotation")}
            </Text>
            <Text style={[styles.hint, { color: t.inkFaint }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <View style={[styles.countPill, { backgroundColor: t.surfaceSoft, borderColor: t.hairline }]}>
            <Text
              style={[
                styles.countPillText,
                { color: usedCount > ANNOTATION_MAX_COUNT ? t.red : t.inkSub },
              ]}
            >
              {Math.min(usedCount, ANNOTATION_MAX_COUNT)}/{ANNOTATION_MAX_COUNT}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.bodyInner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {instruction ? (
            <View style={[styles.instruction, { backgroundColor: t.brandSoft }]}>
              <Icon name="sparkles" size={12} color={t.brand} />
              <Text style={[styles.instructionText, { color: t.brand }]} numberOfLines={2}>
                {instructionLabel ? `${instructionLabel} · ` : ""}
                {instruction}
              </Text>
            </View>
          ) : null}

          <View style={styles.toolbarRow}>
            <Text style={[styles.segmentTitle, { color: t.inkFaint }]}>
              {pick(
                `已选 ${selected.length} 字`,
                `${selected.length} chars selected`,
              )}
              {rangeIndices && rangeIndices[0] !== rangeIndices[1]
                ? pick(
                    ` · 第 ${rangeIndices[0] + 1}–${rangeIndices[1] + 1} 段`,
                    ` · #${rangeIndices[0] + 1}–#${rangeIndices[1] + 1}`,
                  )
                : ""}
            </Text>
            <View style={styles.toolbarActions}>
              <PressableScale
                scaleTo={0.94}
                onPress={selectWhole}
                accessibilityRole="button"
                accessibilityState={{ selected: isWhole }}
                style={[
                  styles.modePill,
                  {
                    backgroundColor: isWhole ? t.brandSoft : t.surfaceSoft,
                    borderColor: isWhole ? t.brand : t.hairline,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modePillText,
                    { color: isWhole ? t.brand : t.inkSub },
                  ]}
                >
                  {pick("整条", "Full")}
                </Text>
              </PressableScale>
              <PressableScale
                scaleTo={0.94}
                onPress={toggleCustomTrim}
                accessibilityRole="button"
                accessibilityState={{ selected: customTrimMode }}
                style={[
                  styles.modePill,
                  {
                    backgroundColor: customTrimMode ? t.brandSoft : t.surfaceSoft,
                    borderColor: customTrimMode ? t.brand : t.hairline,
                  },
                ]}
              >
                <Icon
                  name="pen"
                  size={11}
                  color={customTrimMode ? t.brand : t.inkSub}
                />
                <Text
                  style={[
                    styles.modePillText,
                    { color: customTrimMode ? t.brand : t.inkSub },
                  ]}
                >
                  {pick("自由裁剪", "Trim")}
                </Text>
              </PressableScale>
            </View>
          </View>

          {customTrimMode ? (
            <TextInput
              value={excerpt}
              onChangeText={(next) => {
                setExcerpt(next);
                setRangeIndices(null);
                const idx = next.trim() ? fullText.indexOf(next.trim()) : -1;
                if (idx >= 0) {
                  setSelection({ start: idx, end: idx + next.trim().length });
                }
              }}
              multiline
              textAlignVertical="top"
              placeholder={pick("保留你想引用的精确原文…", "Keep the exact excerpt to quote…")}
              placeholderTextColor={t.inkFaint}
              style={[
                styles.trimInput,
                {
                  color: t.ink,
                  borderColor: t.brand,
                  backgroundColor: t.card,
                  maxHeight: quoteMaxHeight,
                },
              ]}
            />
          ) : (
            <ScrollView
              style={[
                styles.quote,
                {
                  backgroundColor: t.surfaceSoft,
                  borderColor: t.hairline,
                  maxHeight: quoteMaxHeight,
                },
              ]}
              contentContainerStyle={styles.quoteInner}
              nestedScrollEnabled
            >
              <Text style={[styles.quoteText, { color: t.inkFaint }]}>
                {previewRuns.before ? <Text>{previewRuns.before}</Text> : null}
                {previewRuns.highlighted ? (
                  <Text
                    style={{
                      color: t.ink,
                      backgroundColor: t.brandSoft,
                      fontWeight: "600",
                    }}
                  >
                    {previewRuns.highlighted}
                  </Text>
                ) : null}
                {previewRuns.after ? <Text>{previewRuns.after}</Text> : null}
              </Text>
            </ScrollView>
          )}

          {segments.length > 1 && !customTrimMode ? (
            <View style={styles.segmentWrap}>
              <ScrollView
                style={[styles.segmentList, { maxHeight: segmentMaxHeight }]}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                {segments.map((segment, index) => {
                  const inRange =
                    rangeIndices !== null
                      ? index >= rangeIndices[0] && index <= rangeIndices[1]
                      : !isWhole &&
                        segment.start >= selection.start &&
                        segment.end <= selection.end;
                  return (
                    <PressableScale
                      key={`${segment.start}:${segment.end}`}
                      scaleTo={0.985}
                      onPress={() => selectSegment(index, segment)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: inRange }}
                      style={[
                        styles.segmentRow,
                        {
                          backgroundColor: inRange ? t.brandSoft : t.card,
                          borderColor: inRange ? t.brand : t.hairline,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentNumber,
                          { color: inRange ? t.brand : t.inkFaint },
                        ]}
                      >
                        {index + 1}
                      </Text>
                      <Text
                        style={[styles.segmentText, { color: inRange ? t.ink : t.inkSub }]}
                        numberOfLines={1}
                      >
                        {segment.text}
                      </Text>
                      {inRange ? <Icon name="check" size={12} color={t.brand} /> : null}
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {!instruction ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.presetRow}
            >
              {COMMENT_PRESETS.map((preset) => {
                const label = pick(preset.zh, preset.en);
                return (
                  <PressableScale
                    key={preset.zh}
                    scaleTo={0.95}
                    onPress={() => applyPreset(label)}
                    accessibilityRole="button"
                    style={[
                      styles.presetChip,
                      { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
                    ]}
                  >
                    <Text style={[styles.presetText, { color: t.inkSub }]}>+ {label}</Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          ) : null}

          <View>
            <TextInput
              value={comment}
              onChangeText={setComment}
              onFocus={() => setCommentFocused(true)}
              onBlur={() => setCommentFocused(false)}
              multiline
              placeholder={
                instruction
                  ? pick(
                      "补充要求（可选）。模型会同时看到选中的原文、指令与你的补充。",
                      "Extra note (optional). The model receives the excerpt, instruction, and your note.",
                    )
                  : pick(
                      "写下评论或要求（可选）。模型会看到选中的原文和这条评论。",
                      "Add a comment or instruction (optional). Sent alongside the quoted excerpt.",
                    )
              }
              placeholderTextColor={t.inkFaint}
              style={[
                styles.input,
                {
                  color: t.ink,
                  borderColor:
                    comment.length > ANNOTATION_MAX_COMMENT_LENGTH
                      ? t.red
                      : commentFocused
                        ? t.hairlineStrong
                        : t.hairline,
                  backgroundColor: t.surfaceSoft,
                  minHeight: compactHeight ? space(13) : space(17),
                },
              ]}
              textAlignVertical="top"
            />
            {comment.length > ANNOTATION_MAX_COMMENT_LENGTH * 0.8 ||
            selected.length > ANNOTATION_MAX_EXCERPT_LENGTH * 0.8 ? (
              <Text
                style={[
                  styles.limitHint,
                  { color: validation.ok ? t.inkFaint : t.red },
                ]}
              >
                {pick(
                  `摘录 ${selected.length}/${ANNOTATION_MAX_EXCERPT_LENGTH} · 评论 ${comment.length}/${ANNOTATION_MAX_COMMENT_LENGTH}`,
                  `Excerpt ${selected.length}/${ANNOTATION_MAX_EXCERPT_LENGTH} · Comment ${comment.length}/${ANNOTATION_MAX_COMMENT_LENGTH}`,
                )}
              </Text>
            ) : null}
          </View>

          {validationMessage ? (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: t.redSoft, borderColor: t.red },
              ]}
            >
              <Icon name="alert" size={13} color={t.red} />
              <Text style={[styles.errorText, { color: t.red }]}>{validationMessage}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.foot, { borderTopColor: t.hairline }]}>
          <Text style={[styles.footHint, { color: t.inkFaint }]} numberOfLines={1}>
            {selected
              ? pick(
                  `引用：${selected.slice(0, 24)}${selected.length > 24 ? "…" : ""}`,
                  `Quote: ${selected.slice(0, 28)}${selected.length > 28 ? "…" : ""}`,
                )
              : pick("请选择原文", "Select text")}
          </Text>
          <View style={styles.actions}>
            <PillButton variant="secondary" label={pick("取消", "Cancel")} onPress={onCancel} />
            <PillButton
              label={editing ? pick("保存", "Save") : pick("添加注释", "Add")}
              onPress={() => {
                if (!validation.ok) return;
                haptic("confirm");
                onSubmit({
                  excerpt: validation.excerpt,
                  comment: validation.comment,
                  ...(customTrimMode
                    ? {}
                    : { selectionStart: selection.start, selectionEnd: selection.end }),
                });
              }}
              disabled={!validation.ok}
              accessibilityLabel={editing ? pick("保存注释", "Save annotation") : pick("添加注释", "Add annotation")}
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
    flexShrink: 1,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  badge: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...text("body"), fontWeight: "700" },
  hint: { ...text("micro") },
  countPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 2,
  },
  countPillText: { ...text("micro"), fontWeight: "700" },
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  bodyInner: { gap: space(2), paddingBottom: space(0.5) },
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
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    height: size.chip,
    justifyContent: "center",
  },
  modePillText: { ...text("micro"), fontWeight: "600" },
  quote: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
  },
  quoteInner: { padding: space(2.5) },
  quoteText: { ...text("small"), lineHeight: 20 },
  trimInput: {
    borderWidth: 1,
    borderRadius: radius.control,
    padding: space(2.5),
    minHeight: 72,
    ...text("small"),
    lineHeight: 20,
  },
  segmentWrap: { gap: space(1) },
  segmentTitle: { ...text("micro"), flexShrink: 1 },
  segmentList: { flexGrow: 0 },
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
  presetRow: {
    flexDirection: "row",
    gap: space(1.5),
    paddingVertical: 1,
  },
  presetChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  presetText: { ...text("micro"), fontWeight: "600" },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
    ...text("body"),
  },
  limitHint: {
    ...text("micro"),
    textAlign: "right",
    marginTop: space(1),
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
  },
  errorText: { ...text("micro"), fontWeight: "600", flex: 1 },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
    paddingTop: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footHint: { flex: 1, ...text("micro") },
  actions: { flexDirection: "row", alignItems: "center", gap: space(2) },
});
