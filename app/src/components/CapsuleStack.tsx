// COMPOSE 上方的快捷动作：多层胶囊卡片折叠成一个按钮，点开向上展开胶囊列表。
//
// 内容由设置页的 COMPOSE 配置决定；每一项是 catalog 里的命令/技能/模式，
// 选中后只往 COMPOSE 里插入 token，不把提示词塞进输入框。
// 2.0：顶层用不透明 card（避免半透明叠层出现暗条纹）、底层对称居中、折角随开合旋转。

import type { ComponentRef } from "react";
import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "./Icon";
import { MenuRow } from "./ui/MenuRow";
import { PluginPopup, type PopupAnchor } from "./PluginPopup";
import type { ComposerCatalogItem } from "../composer/catalog";
import { haptic } from "../motion/haptics";
import { PressableScale } from "../motion/PressableScale";
import { useDevicePreferences } from "../settings/devicePreferences";
import { radius, space, text, useNibiTheme } from "../theme";

function itemIcon(item: ComposerCatalogItem): IconName {
  return (item.icon ?? "sparkles") as IconName;
}

export function CapsuleStack({
  items,
  onItem,
}: {
  items: readonly ComposerCatalogItem[];
  onItem: (item: ComposerCatalogItem) => void;
}) {
  const t = useNibiTheme();
  const { motionEnabled } = useDevicePreferences();
  const buttonRef = useRef<ComponentRef<typeof PressableScale> | null>(null);
  const [anchor, setAnchor] = useState<PopupAnchor | null>(null);
  const chevron = useRef(new Animated.Value(0)).current;
  const isOpen = anchor !== null;

  useEffect(() => {
    if (!motionEnabled) {
      chevron.setValue(isOpen ? 1 : 0);
      return;
    }
    Animated.timing(chevron, {
      toValue: isOpen ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [chevron, isOpen, motionEnabled]);

  if (items.length === 0) return null;

  const open = () => {
    haptic("tap");
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
  };

  const rotate = chevron.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "0deg"],
  });

  return (
    <>
      <PressableScale
        ref={buttonRef}
        scaleTo={0.95}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel="快捷动作"
        style={styles.stack}
      >
        <View
          style={[
            styles.layer,
            styles.layerBack,
            { backgroundColor: t.card, borderColor: t.hairline },
          ]}
        />
        <View
          style={[
            styles.layer,
            styles.layerMid,
            { backgroundColor: t.card, borderColor: t.hairlineStrong },
          ]}
        />
        <View
          style={[
            styles.face,
            {
              // 不透明 card：Android elevation + 半透明 glass 会透出底下叠层的边框与暗影。
              backgroundColor: t.card,
              borderColor: t.hairlineStrong,
              ...t.elevation.card,
            },
          ]}
        >
          <Icon name="sparkles" size={13} color={t.brand} />
          <Text style={[styles.count, { color: t.ink }]}>快捷</Text>
          <Animated.View style={[styles.chevronWrap, { transform: [{ rotate }] }]}>
            <Icon name="chevron-down" size={11} color={t.inkSub} />
          </Animated.View>
        </View>
      </PressableScale>

      <PluginPopup
        visible={isOpen}
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
              onPress={() => {
                haptic("tick");
                setAnchor(null);
                onItem(item);
              }}
            />
          ))}
        </ScrollView>
      </PluginPopup>
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    width: 100,
    height: 42,
    justifyContent: "flex-end",
  },
  layer: {
    position: "absolute",
    height: 28,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // 两张垫片左右对称收窄，消除早先偏右 4px 的歪斜感。
  layerBack: { bottom: 9, left: 10, right: 10, opacity: 0.55 },
  layerMid: { bottom: 5, left: 5, right: 5, opacity: 0.8 },
  face: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(1.5),
    paddingHorizontal: space(3),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chevronWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  count: { ...text("micro"), fontWeight: "700" },
  title: {
    ...text("small"),
    fontWeight: "700",
    paddingHorizontal: space(2),
    paddingBottom: space(1.5),
  },
  list: { maxHeight: 330 },
});
