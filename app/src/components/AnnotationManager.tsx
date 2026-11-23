// 注释管理：按顺序列出当前要随下一条消息发送的注释卡片。
//
// 支持：单条编辑、单条删除、上下调整顺序、定位回原消息、按单条消息筛选查看、一键清空全部。
// 发送时走内核的 conversationQuotes（编号对应正文），用户气泡仍保持原文。

import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Icon } from "./Icon";
import { Sheet } from "./ui/Sheet";
import { ANNOTATION_MAX_COUNT, type AnnotationItem } from "../composer/annotations";
import { useI18n } from "../i18n";
import { PressableScale } from "../motion/PressableScale";
import { haptic } from "../motion/haptics";
import { radius, space, text, useNibiTheme } from "../theme";

export type { AnnotationItem } from "../composer/annotations";

export function AnnotationManager({
  visible,
  annotations,
  filterMessageKey = null,
  onClearFilter,
  onAddForFilteredMessage,
  onClose,
  onEdit,
  onDelete,
  onClearAll,
  onReorder,
  onJumpToMessage,
}: {
  visible: boolean;
  annotations: readonly AnnotationItem[];
  filterMessageKey?: string | null;
  onClearFilter?: () => void;
  onAddForFilteredMessage?: () => void;
  onClose: () => void;
  onEdit: (annotation: AnnotationItem) => void;
  onDelete: (id: string) => void;
  onClearAll?: () => void;
  onReorder?: (index: number, delta: -1 | 1) => void;
  onJumpToMessage?: (messageKey: string) => void;
}) {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const { height: windowHeight } = useWindowDimensions();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!visible) setConfirmClear(false);
  }, [visible]);

  const entries = useMemo(() => {
    return annotations
      .map((item, globalIndex) => ({ item, globalIndex }))
      .filter((entry) => !filterMessageKey || entry.item.messageKey === filterMessageKey);
  }, [annotations, filterMessageKey]);

  const canClearAll = Boolean(onClearAll) && annotations.length > 0 && !filterMessageKey;

  const handleClearPress = () => {
    if (!onClearAll) return;
    if (annotations.length <= 1 || confirmClear) {
      haptic("confirm");
      setConfirmClear(false);
      onClearAll();
      return;
    }
    haptic("tick");
    setConfirmClear(true);
  };

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightRatio={windowHeight < 520 ? 0.92 : 0.76}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.titleRow}>
            <Icon name="quote" size={15} color={t.brand} />
            <Text style={[styles.title, { color: t.ink }]}>
              {pick("注释", "Annotations")} {annotations.length}/{ANNOTATION_MAX_COUNT}
            </Text>
          </View>
          <View style={styles.headActions}>
            {canClearAll ? (
              <PressableScale
                scaleTo={0.94}
                onPress={handleClearPress}
                accessibilityRole="button"
                accessibilityLabel={
                  confirmClear
                    ? pick("确认清空全部注释", "Confirm clear all annotations")
                    : pick("清空全部注释", "Clear all annotations")
                }
                style={[
                  styles.clearPill,
                  {
                    backgroundColor: confirmClear ? t.redSoft : t.surfaceSoft,
                    borderColor: confirmClear ? t.red : t.hairline,
                  },
                ]}
              >
                <Icon name="trash" size={12} color={confirmClear ? t.red : t.inkSub} />
                <Text
                  style={[
                    styles.clearPillText,
                    { color: confirmClear ? t.red : t.inkSub },
                  ]}
                >
                  {confirmClear ? pick("再次点击清空", "Tap to confirm") : pick("清空", "Clear all")}
                </Text>
              </PressableScale>
            ) : null}
            <PressableScale
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={pick("关闭", "Close")}
              style={styles.close}
            >
              <Icon name="x" size={17} color={t.inkFaint} />
            </PressableScale>
          </View>
        </View>

        {filterMessageKey ? (
          <View
            style={[
              styles.filterBar,
              { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
            ]}
          >
            <Text style={[styles.filterText, { color: t.inkSub }]} numberOfLines={1}>
              {pick(
                `当前消息待发注释（${entries.length} 条）`,
                `Draft annotations for this message (${entries.length})`,
              )}
            </Text>
            <View style={styles.filterActions}>
              {onAddForFilteredMessage && annotations.length < ANNOTATION_MAX_COUNT ? (
                <PressableScale
                  scaleTo={0.95}
                  onPress={() => {
                    haptic("tap");
                    onAddForFilteredMessage();
                  }}
                  style={[styles.filterBtn, { backgroundColor: t.brandSoft }]}
                >
                  <Text style={[styles.filterBtnText, { color: t.brand }]}>
                    {pick("+ 新增", "+ Add")}
                  </Text>
                </PressableScale>
              ) : null}
              {onClearFilter && annotations.length > entries.length ? (
                <PressableScale
                  scaleTo={0.95}
                  onPress={() => {
                    haptic("tick");
                    onClearFilter();
                  }}
                  style={[styles.filterBtn, { backgroundColor: t.card, borderColor: t.hairline, borderWidth: StyleSheet.hairlineWidth }]}
                >
                  <Text style={[styles.filterBtnText, { color: t.inkSub }]}>
                    {pick(`查看全部 (${annotations.length})`, `All (${annotations.length})`)}
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={[styles.subtitle, { color: t.inkFaint }]}>
            {pick(
              `下一条消息将携带 ${annotations.length} 条注释 · 点击卡片可编辑摘录或评论`,
              `Next message will include ${annotations.length} annotation(s) · Tap a card to edit`,
            )}
          </Text>
        )}

        {entries.length === 0 ? (
          <Text style={[styles.empty, { color: t.inkFaint }]}>
            {pick(
              "还没有待发送注释。长按任意用户或助手消息，选「注释」即可添加。",
              "No draft annotations yet. Long-press any message and tap Annotate.",
            )}
          </Text>
        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {entries.map(({ item: annotation, globalIndex }) => (
              <View
                key={annotation.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: t.surfaceSoft,
                    borderColor: t.hairline,
                  },
                ]}
              >
                <PressableScale
                  scaleTo={0.985}
                  containerStyle={styles.cardMainWrap}
                  onPress={() => {
                    setConfirmClear(false);
                    onEdit(annotation);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={pick(`编辑注释 ${globalIndex + 1}`, `Edit annotation ${globalIndex + 1}`)}
                  style={({ pressed }) => [
                    styles.cardMain,
                    pressed ? { backgroundColor: t.hover } : null,
                  ]}
                >
                  <View style={[styles.number, { backgroundColor: t.brandSoft }]}>
                    <Text style={[styles.numberText, { color: t.brand }]}>{globalIndex + 1}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.metaRow}>
                      <View style={[styles.rolePill, { backgroundColor: t.card, borderColor: t.hairline }]}>
                        <Text style={[styles.meta, { color: t.inkSub }]}>
                          {annotation.messageRole === "assistant"
                            ? pick("助手", "Assistant")
                            : pick("用户", "You")}
                        </Text>
                      </View>
                      {annotation.instruction ? (
                        <View style={[styles.instruction, { backgroundColor: t.brandSoft }]}>
                          <Text style={[styles.instructionText, { color: t.brand }]} numberOfLines={1}>
                            {annotation.instruction}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.excerpt, { color: t.inkSub }]} numberOfLines={2}>
                      {annotation.messageText.trim()}
                    </Text>
                    {annotation.comment ? (
                      <Text style={[styles.comment, { color: t.ink }]} numberOfLines={2}>
                        {annotation.comment}
                      </Text>
                    ) : !annotation.instruction ? (
                      <Text style={[styles.comment, { color: t.inkFaint }]} numberOfLines={1}>
                        {pick("（无附加评论）", "(No extra comment)")}
                      </Text>
                    ) : null}
                  </View>
                </PressableScale>

                <View style={styles.cardTools}>
                  {onJumpToMessage ? (
                    <PressableScale
                      scaleTo={0.9}
                      onPress={() => {
                        haptic("tap");
                        onJumpToMessage(annotation.messageKey);
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={pick("定位原消息", "Jump to message")}
                      style={styles.toolBtn}
                    >
                      <Icon name="arrow-up" size={14} color={t.inkSub} />
                    </PressableScale>
                  ) : null}
                  {onReorder && !filterMessageKey && annotations.length > 1 ? (
                    <>
                      <PressableScale
                        scaleTo={0.9}
                        disabled={globalIndex === 0}
                        onPress={() => {
                          haptic("tick");
                          onReorder(globalIndex, -1);
                        }}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={pick("上移注释", "Move annotation up")}
                        style={[styles.toolBtn, globalIndex === 0 ? { opacity: 0.25 } : null]}
                      >
                        <Icon name="chevron-up" size={14} color={t.inkSub} />
                      </PressableScale>
                      <PressableScale
                        scaleTo={0.9}
                        disabled={globalIndex === annotations.length - 1}
                        onPress={() => {
                          haptic("tick");
                          onReorder(globalIndex, 1);
                        }}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={pick("下移注释", "Move annotation down")}
                        style={[
                          styles.toolBtn,
                          globalIndex === annotations.length - 1 ? { opacity: 0.25 } : null,
                        ]}
                      >
                        <Icon name="chevron-down" size={14} color={t.inkSub} />
                      </PressableScale>
                    </>
                  ) : null}
                  <PressableScale
                    scaleTo={0.9}
                    onPress={() => {
                      haptic("tick");
                      setConfirmClear(false);
                      onDelete(annotation.id);
                    }}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={pick(`删除注释 ${globalIndex + 1}`, `Delete annotation ${globalIndex + 1}`)}
                    style={styles.toolBtn}
                  >
                    <Icon name="trash" size={14} color={t.red} />
                  </PressableScale>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          {pick(
            "注释随下一次发送交给模型；若发送失败会自动保留，不会丢失。",
            "Annotations are sent with your next message and preserved automatically if sending fails.",
          )}
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    padding: space(4),
    gap: space(2),
    flexShrink: 1,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  headActions: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  title: { ...text("heading"), fontWeight: "700" },
  subtitle: { ...text("micro") },
  clearPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  clearPillText: { ...text("micro"), fontWeight: "600" },
  close: {
    width: space(7),
    height: space(7),
    alignItems: "center",
    justifyContent: "center",
  },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
  },
  filterText: { ...text("micro"), flex: 1 },
  filterActions: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  filterBtn: {
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 3,
  },
  filterBtnText: { ...text("micro"), fontWeight: "700" },
  list: { flexGrow: 0, flexShrink: 1 },
  empty: { ...text("micro"), paddingVertical: space(5), textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    overflow: "hidden",
    marginBottom: space(1.5),
  },
  cardMainWrap: { flex: 1, minWidth: 0 },
  cardMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2.5),
    padding: space(2.5),
    borderRadius: radius.control,
  },
  number: {
    width: space(5.5),
    height: space(5.5),
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { ...text("micro"), fontWeight: "700" },
  cardBody: { flex: 1, minWidth: 0, gap: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(1.5) },
  rolePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
  },
  meta: { ...text("micro"), fontWeight: "600" },
  instruction: {
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
    maxWidth: 180,
  },
  instructionText: { ...text("micro"), fontWeight: "700" },
  excerpt: { ...text("small") },
  comment: { ...text("small"), fontWeight: "500" },
  cardTools: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(1.5),
    paddingVertical: space(1.5),
    gap: space(1),
  },
  toolBtn: {
    width: space(6.5),
    height: space(6.5),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.chip,
  },
  footnote: { ...text("micro") },
});
