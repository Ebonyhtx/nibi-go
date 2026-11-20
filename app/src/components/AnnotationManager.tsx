// 注释管理：按顺序列出当前要随下一条消息发送的注释卡片。
//
// 注释不是“把整条消息复制进提示词”：每条只带选中的原文片段 + 可选评论/指令，
// 发送时走内核的 conversationQuotes（模型看到编号对应的引用块），用户气泡仍是原文。
// 2.0：底座换成 ui/Sheet；列表行改为 PressableScale 卡片，编号与删除按钮走 theme token。

import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import { Sheet } from "./ui/Sheet";
import { PressableScale } from "../motion/PressableScale";
import { radius, space, text, useNibiTheme } from "../theme";

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

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightRatio={0.72}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.titleRow}>
            <Icon name="quote" size={15} color={t.brand} />
            <Text style={[styles.title, { color: t.ink }]}>注释 {annotations.length}</Text>
          </View>
          <PressableScale
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="关闭"
            style={styles.close}
          >
            <Icon name="x" size={17} color={t.inkFaint} />
          </PressableScale>
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
              <PressableScale
                key={annotation.id}
                scaleTo={0.985}
                onPress={() => onEdit(annotation)}
                accessibilityRole="button"
                accessibilityLabel={`编辑注释 ${index + 1}`}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: pressed ? t.hover : t.surfaceSoft,
                    borderColor: t.hairline,
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
                <PressableScale
                  onPress={(event) => {
                    // 内层删除按钮吃掉本次点击，避免同时触发外层的“编辑”。
                    event.stopPropagation();
                    onDelete(annotation.id);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`删除注释 ${index + 1}`}
                  style={styles.delete}
                >
                  <Icon name="trash" size={15} color={t.red} />
                </PressableScale>
              </PressableScale>
            ))}
          </ScrollView>
        )}

        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          注释随下一次发送交给模型；发送后顶部数字消失，被注释的消息下方保留「已注释」标记。
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Sheet 自身只负责定位/遮罩/安全区，内容内边距由这里补齐。
  sheet: {
    padding: space(4),
    gap: space(2),
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  title: { ...text("heading"), fontWeight: "700" },
  subtitle: { ...text("micro") },
  close: {
    width: space(7),
    height: space(7),
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flexGrow: 0, flexShrink: 1 },
  empty: { ...text("micro"), paddingVertical: space(5), textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
    marginBottom: space(1.5),
  },
  number: {
    width: space(5.5),
    height: space(5.5),
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { ...text("micro"), fontWeight: "700" },
  cardBody: { flex: 1, gap: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  meta: { ...text("micro") },
  instruction: {
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
    maxWidth: 160,
  },
  instructionText: { ...text("micro"), fontWeight: "700" },
  excerpt: { ...text("small") },
  comment: { ...text("small") },
  delete: { paddingTop: space(0.5), paddingLeft: space(0.5) },
  footnote: { ...text("micro") },
});
