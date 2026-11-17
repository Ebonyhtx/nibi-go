// COMPOSE 上方的快捷动作：多层胶囊卡片折叠成一个按钮，点开向上展开胶囊列表。
//
// 内容由设置页的 COMPOSE 配置决定；每一项是 catalog 里的命令/技能/模式，
// 选中后只往 COMPOSE 里插入 token，不把提示词塞进输入框。

import type { ComponentRef } from "react";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "./Icon";
import { PluginPopup, type PopupAnchor } from "./PluginPopup";
import type { ComposerCatalogItem } from "../composer/catalog";
import { radius, space, useNibiTheme } from "../theme";

function itemIcon(item: ComposerCatalogItem): IconName {
  return (item.icon ?? "sparkles") as IconName;
}

function kindLabel(item: ComposerCatalogItem): string {
  if (item.group === "skill") return "技能";
  if (item.token.kind === "mode") return "模式";
  return "命令";
}

export function CapsuleStack({
  items,
  onItem,
}: {
  items: readonly ComposerCatalogItem[];
  onItem: (item: ComposerCatalogItem) => void;
}) {
  const t = useNibiTheme();
  const buttonRef = useRef<ComponentRef<typeof Pressable> | null>(null);
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null);
  if (items.length === 0) return null;

  const open = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };

  return (
    <>
      <Pressable
        ref={buttonRef}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`COMPOSE 快捷动作，共 ${items.length} 个`}
        style={({ pressed }) => [styles.stack, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.layer, styles.layerBack, { backgroundColor: t.panel, borderColor: t.hairline }]} />
        <View style={[styles.layer, styles.layerMid, { backgroundColor: t.glass, borderColor: t.glassBorder }]} />
        <View
          style={[
            styles.face,
            { backgroundColor: t.glass, borderColor: t.glassBorder },
          ]}
        >
          <Icon name="sparkles" size={13} color={t.brand} />
          <Text style={[styles.count, { color: t.inkSub }]}>快捷 {items.length}</Text>
          <Icon name="chevron-down" size={11} color={t.inkFaint} />
        </View>
      </Pressable>

      <PluginPopup
        visible={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        width={280}
      >
        <Text style={[styles.title, { color: t.ink }]}>快捷动作</Text>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                setAnchor(null);
                onItem(item);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}（${kindLabel(item)}）`}
              style={({ pressed }) => [
                styles.row,
                { borderColor: t.hairline, opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <View
                style={[
                  styles.icon,
                  {
                    backgroundColor:
                      item.source === "plugin" ? t.steelSoft : t.brandSoft,
                  },
                ]}
              >
                <Icon
                  name={itemIcon(item)}
                  size={15}
                  color={item.source === "plugin" ? t.steel : t.brand}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: t.ink }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.rowSub, { color: t.inkFaint }]} numberOfLines={1}>
                  {item.detail ?? kindLabel(item)}
                </Text>
              </View>
              <Text style={[styles.kind, { color: t.inkGhost }]}>{kindLabel(item)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          选中后只在 COMPOSE 里加入动作名；提示词/技能由内核按 token 展开。
        </Text>
      </PluginPopup>
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    width: 104,
    height: 42,
    justifyContent: "flex-end",
  },
  layer: {
    position: "absolute",
    left: 4,
    right: 0,
    height: 30,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  layerBack: { bottom: 10, left: 12, right: 8, opacity: 0.55 },
  layerMid: { bottom: 5, left: 8, right: 4, opacity: 0.8 },
  face: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  count: { fontSize: 10.5, fontWeight: "700" },
  title: {
    fontSize: 12.5,
    fontWeight: "700",
    paddingHorizontal: space(2),
    paddingBottom: space(1.5),
  },
  list: { maxHeight: 330 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    minHeight: 46,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 12.5, fontWeight: "600" },
  rowSub: { fontSize: 10 },
  kind: { fontSize: 9.5 },
  footnote: {
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
});