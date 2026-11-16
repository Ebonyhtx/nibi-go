// 注释管理：按顺序列出当前会话的注释卡片，点卡片二次编辑，右侧可删除。

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export interface AnnotationItem {
  id: string;
  messageKey: string;
  messageText: string;
  comment: string;
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
              <Text style={[styles.title, { color: t.ink }]}>
                注释 {annotations.length > 0 ? `(${annotations.length})` : ""}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
              <Icon name="x" size={17} color={t.inkFaint} />
            </Pressable>
          </View>

          {annotations.length === 0 ? (
            <Text style={[styles.empty, { color: t.inkFaint }]}>
              还没有注释。长按助手消息，选「注释」即可添加。
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
            注释会随下一次发送一起交给模型；发送后顶部数字消失，消息下方保留「已注释」标记。
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
    gap: space(2.5),
    maxHeight: "72%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  title: { fontSize: typeScale.heading, fontWeight: "700" },
  list: { flexGrow: 0 },
  empty: { fontSize: 12.5, paddingVertical: space(5), textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(2.5),
    marginBottom: space(2),
  },
  number: {
    width: 24,
    height: 24,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { fontSize: 11.5, fontWeight: "700" },
  cardBody: { flex: 1, gap: 3 },
  excerpt: { fontSize: 11.5, lineHeight: 15 },
  comment: { fontSize: 12, lineHeight: 16 },
  delete: { paddingTop: 2, paddingLeft: 4 },
  footnote: { fontSize: 10.5, lineHeight: 15 },
});