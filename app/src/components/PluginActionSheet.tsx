// 插件动作的通用底部弹层：消息长按、会话操作、加号工具面板共用。
//
// 只展示契约解析后的动作（标题 + 插件名），点击后由调用方执行效果；这里不碰插件代码。

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export interface PluginSheetItem {
  key: string;
  label: string;
  /** 来源插件名/说明，显示在标题下方。 */
  detail?: string;
  onPress: () => void;
}

export function PluginActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: readonly PluginSheetItem[];
  onClose: () => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭插件动作"
        />
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
            <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="关闭"
            >
              <Icon name="x" size={18} color={t.inkFaint} />
            </Pressable>
          </View>
          {items.length === 0 ? (
            <Text style={[styles.empty, { color: t.inkFaint }]}>没有可用的插件动作。</Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {items.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={item.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  style={({ pressed }) => [
                    styles.row,
                    { borderColor: t.hairline, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.label, { color: t.ink }]}>{item.label}</Text>
                    {item.detail ? (
                      <Text style={[styles.detail, { color: t.inkFaint }]} numberOfLines={1}>
                        {item.detail}
                      </Text>
                    ) : null}
                  </View>
                  <Icon name="chevron-right" size={15} color={t.inkGhost} />
                </Pressable>
              ))}
            </ScrollView>
          )}
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
    backgroundColor: "rgba(20,26,36,0.28)",
  },
  sheet: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: space(3),
    paddingHorizontal: space(4),
    maxHeight: "70%",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: space(2),
  },
  title: { fontSize: typeScale.heading, fontWeight: "700" },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: space(3),
    minHeight: 52,
  },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: "600" },
  detail: { fontSize: 10.5 },
  empty: { fontSize: 12.5, paddingVertical: space(4), textAlign: "center" },
});