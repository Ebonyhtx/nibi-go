// COMPOSE 里的附件胶囊：只显示文件引用，不把文件内容塞进输入框。

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { ComposerAttachment } from "../composer/attachments";
import { useI18n } from "../i18n";
import { radius, space, useNibiTheme } from "../theme";

export function ComposerAttachments({
  attachments,
  onRemove,
}: {
  attachments: readonly ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  const t = useNibiTheme();
  const { pick } = useI18n();
  if (attachments.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {attachments.map((attachment) => (
        <View
          key={attachment.id}
          style={[styles.chip, { backgroundColor: t.steelSoft, borderColor: t.steelSoft }]}
        >
          <Icon name={attachment.kind === "image" ? "image" : "doc"} size={11} color={t.steel} />
          <Text style={[styles.label, { color: t.steel }]} numberOfLines={1}>
            {attachment.name}
          </Text>
          <Pressable
            onPress={() => onRemove(attachment.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={pick(`移除 ${attachment.name}`, `Remove ${attachment.name}`)}
            style={({ pressed }) => [styles.remove, pressed ? { opacity: 0.5 } : null]}
          >
            <Icon name="x" size={9} color={t.steel} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, height: 24, maxWidth: "44%" },
  row: { flexDirection: "row", alignItems: "center", gap: space(1) },
  chip: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: space(1.5),
    paddingRight: space(1),
  },
  label: { fontSize: 10.5, fontWeight: "600", maxWidth: 96 },
  remove: { width: 13, height: 16, alignItems: "center", justifyContent: "center" },
});