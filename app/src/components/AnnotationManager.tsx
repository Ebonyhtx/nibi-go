// 注释管理：按顺序列出当前要随下一条消息发送的注释卡片。
//
// 注释不是“把整条消息复制进提示词”：每条只带选中的原文片段 + 可选评论/指令，
// 发送时走内核的 conversationQuotes（模型看到编号对应的引用块），用户气泡仍是原文。

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export interface AnnotationItem {
  id: string;
  /** 被注释行在本机行模型里的 key（`r12` / `m...`）。 */
  messageKey: string;
  /** 内核消息 id（能拿到时带上，历史回显用）。 */
  messageId?: string;
  messageRole: "user" | "assistant";
  /** 选中的原文片段（不是整条消息）。 */
  messageText: string;
  /** 添加时消息的完整正文，二次编辑选区用；历史恢复时可等于片段。 */
  fullText: string;
  comment: string;
  /** 插件 message.actions 的指令（例如“润色”）；内置注释为空。 */
  instruction?: string;
  createdAt: number;
}

export function AnnotationManager({
  visible,
  annotations,
  onClose,
  onEdit,
  onDelete,
}: {
  visible: boolean;
  annotations: readonly AnnotationItem[];
  onClose: () => void;
  onEdit: (annotation: AnnotationItem) => void;
  onDelete: (id: string) => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="关闭注释管理" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.card,
              borderColor: t.hairline,
              paddingBottom: insets.bottom + space(3),
            },
          ]}
        >
          <View style={styles.head}>
            <View style={styles.titleRow}>
              <Icon name="quote" size={15} color={t.brand} />
              <Text style={[styles.title, { color: t.ink }]}>注释 {annotations.length}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
              <Icon name="x" size={17} color={t.inkFaint} />
            </Pressable>
          </View>
          <Text style={[styles.subtitle, { color: t.inkFaint }]}>
            下一条消息将携带 {annotations.length} 条注释 · 编号对应正文
          </Text>

          {annotations.length === 0 ? (
            <Text style={[styles.empty, { color: t.inkFaint }]}>
              还没有注释。长按任意用户/助手消息，选「注释」即可添加。
            </Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {annotations.map((annotation, index) => (
                <Pressable
                  key={annotation.id}
                  onPress={() => onEdit(annotation)}
                  accessibilityRole="button"
                  accessibilityLabel={`编辑注释 ${index + 1}`}
                  style={({ pressed }) => [
                    styles.card,
                    {
                      backgroundColor: t.panel,
                      borderColor: t.hairline,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={[styles.number, { backgroundColor: t.brandSoft }]}>
                    <Text style={[styles.numberText, { color: t.brand }]}>{index + 1}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.metaRow}>
                      <Text style={[styles.meta, { color: t.inkGhost }]}>
                        {annotation.messageRole === "assistant" ? "助手消息" : "用户消息"}
                      </Text>
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
                    <Text
                      style={[
                        styles.comment,
                        { color: annotation.comment ? t.ink : t.inkFaint },
                      ]}
                      numberOfLines={2}
                    >
                      {annotation.comment || "（无评论）"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => onDelete(annotation.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`删除注释 ${index + 1}`}
                    style={styles.delete}
                  >
                    <Icon name="trash" size={15} color={t.red} />
                  </Pressable>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Text style={[styles.footnote, { color: t.inkGhost }]}>
            注释随下一次发送交给模型；发送后顶部数字消失，被注释的消息下方保留「已注释」标记。
          </Text>
        </View>
      </View>
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
  sheet: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(4),
    gap: space(2),
    maxHeight: "72%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  title: { fontSize: typeScale.heading, fontWeight: "700" },
  subtitle: { fontSize: 10.5 },
  list: { flexGrow: 0 },
  empty: { fontSize: 12.5, paddingVertical: space(5), textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2),
    marginBottom: space(1.5),
  },
  number: {
    width: 22,
    height: 22,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { fontSize: 11, fontWeight: "700" },
  cardBody: { flex: 1, gap: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  meta: { fontSize: 9.5 },
  instruction: {
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
    maxWidth: 160,
  },
  instructionText: { fontSize: 9.5, fontWeight: "700" },
  excerpt: { fontSize: 11.5, lineHeight: 15 },
  comment: { fontSize: 12, lineHeight: 16 },
  delete: { paddingTop: 1, paddingLeft: 2 },
  footnote: { fontSize: 10.5, lineHeight: 15 },
});