// COMPOSE 上方的快捷动作：多层胶囊卡片折叠成一个按钮，点开向上展开胶囊列表。
//
// 内容由设置页的 COMPOSE 配置决定；每一项是 catalog 里的命令/技能/模式，
// 选中后只往 COMPOSE 里插入 token，不把提示词塞进输入框。
// 2.0：胶囊层走 glass + elevation.card，按压交给 PressableScale；弹层列表换 ui/MenuRow。

import type { ComponentRef } from "react";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "./Icon";
import { MenuRow } from "./ui/MenuRow";
import { PluginPopup, type PopupAnchor } from "./PluginPopup";
import type { ComposerCatalogItem } from "../composer/catalog";
import { PressableScale } from "../motion/PressableScale";
import { radius, space, text, useNibiTheme } from "../theme";

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
  const buttonRef = useRef<ComponentRef<typeof PressableScale> | null>(null);
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null);
  if (items.length === 0) return null;

  const open = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };

  return (
    <>
      <PressableScale
        ref={buttonRef}
        scaleTo={0.96}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`COMPOSE 快捷动作，共 ${items.length} 个`}
        style={styles.stack}
      >
        <View
          style={[
            styles.layer,
            styles.layerBack,
            { backgroundColor: t.glass, borderColor: t.glassBorder },
          ]}
        />
        <View
          style={[
            styles.layer,
            styles.layerMid,
            { backgroundColor: t.glass, borderColor: t.glassBorder },
          ]}
        />
        <View
          style={[
            styles.face,
            {
              backgroundColor: t.glass,
              borderColor: t.glassBorder,
              // 投影只落在最上层，三层叠加时避免阴影重复发黑。
              ...t.elevation.card,
            },
          ]}
        >
          <Icon name="sparkles" size={13} color={t.brand} />
          <Text style={[styles.count, { color: t.inkSub }]}>快捷 {items.length}</Text>
          <Icon name="chevron-down" size={11} color={t.inkFaint} />
        </View>
      </PressableScale>

      <PluginPopup
        visible={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        width={280}
      >
        <Text style={[styles.title, { color: t.ink }]}>快捷动作</Text>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <MenuRow
              key={item.id}
              icon={itemIcon(item)}
              tone={item.source === "plugin" ? "steel" : "brand"}
              label={item.title}
              detail={item.detail ?? kindLabel(item)}
              onPress={() => {
                setAnchor(null);
                onItem(item);
              }}
              right={<Text style={[styles.kind, { color: t.inkGhost }]}>{kindLabel(item)}</Text>}
            />
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
    gap: space(1),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: { ...text("micro"), fontWeight: "700" },
  title: {
    ...text("small"),
    fontWeight: "700",
    paddingHorizontal: space(2),
    paddingBottom: space(1.5),
  },
  list: { maxHeight: 330 },
  kind: { ...text("micro") },
  footnote: {
    ...text("micro"),
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
});
