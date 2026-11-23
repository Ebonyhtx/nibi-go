// 插件动作的通用底部弹层：消息长按、会话操作、加号工具面板共用。
//
// 2.0：改用统一的 ui/Sheet 底座（底部滑入 + 背景淡入）；行换成 ui/MenuRow，
// 与其他弹层的按压/间距/字阶一致。只展示契约解析后的动作（标题 + 插件名），
// 点击后由调用方执行效果；这里不碰插件代码。

import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import { MenuRow } from "./ui/MenuRow";
import { Sheet } from "./ui/Sheet";
import { useI18n } from "../i18n";
import { PressableScale } from "../motion/PressableScale";
import { space, text, useNibiTheme } from "../theme";

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
  const { pick } = useI18n();

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightRatio={0.7}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
        <PressableScale
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={pick("关闭", "Close")}
          style={styles.close}
        >
          <Icon name="x" size={18} color={t.inkFaint} />
        </PressableScale>
      </View>
      {items.length === 0 ? (
        <Text style={[styles.empty, { color: t.inkFaint }]}>
          {pick("没有可用的插件动作。", "No plugin actions available.")}
        </Text>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <MenuRow
              key={item.key}
              icon="sparkles"
              tone="brand"
              label={item.label}
              detail={item.detail}
              onPress={item.onPress}
            />
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: space(3),
    paddingHorizontal: space(4),
    paddingBottom: space(2),
  },
  title: { ...text("heading"), fontWeight: "700" },
  close: {
    width: space(8),
    height: space(8),
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flexGrow: 0, paddingHorizontal: space(2), paddingBottom: space(3) },
  empty: { ...text("small"), paddingVertical: space(5), textAlign: "center" },
});
