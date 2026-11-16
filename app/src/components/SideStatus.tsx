// 插件状态：贴屏幕右侧的悬浮状态点。
//
// 收起时只露一个会呼吸的状态点；点一下向左展开完整状态条，再点收起。
// 多插件状态轮流显示，不占 COMPOSE/列表布局。

import { hostSlotData } from "../plugins/data";
import type { LoadedPlugin } from "../plugins/store";
import { resolveText, type ViewTone } from "@nibi-go/plugin-contract";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { Dot } from "./Icon";
import { radius, space, useNibiTheme, type NibiTheme } from "../theme";

function toneColor(t: NibiTheme, tone: ViewTone | undefined): string {
  switch (tone) {
    case "ok":
      return t.ok;
    case "warn":
      return t.amber;
    case "danger":
      return t.red;
    case "brand":
      return t.brand;
    case "sub":
      return t.inkSub;
    default:
      return t.inkFaint;
  }
}

export function SideStatus({
  plugins,
  bottom,
}: {
  plugins: readonly LoadedPlugin[];
  bottom: number;
}) {
  const t = useNibiTheme();
  const strips = plugins.flatMap((plugin) =>
    plugin.parsed.manifest.contributes.strips.map((strip) => ({ plugin, strip })),
  );
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  const breathe = useRef(new Animated.Value(0)).current;
  const expand = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (strips.length <= 1) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % strips.length);
    }, 5_000);
    return () => clearInterval(timer);
  }, [strips.length]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1_300,
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1_300,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  useEffect(() => {
    Animated.spring(expand, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 230,
      mass: 0.6,
    }).start();
  }, [expand, expanded]);

  if (strips.length === 0) return null;
  const current = strips[Math.min(index, strips.length - 1)];
  if (!current) return null;
  const tone = current.strip.tone ?? "brand";
  const text = resolveText(
    current.strip.text,
    hostSlotData({
      enabledPlugins: plugins.length,
      plugin: {
        id: current.plugin.parsed.manifest.id,
        name: current.plugin.parsed.manifest.name,
        version: current.plugin.parsed.manifest.version,
      },
    }),
  );
  if (text.trim().length === 0) return null;

  return (
    <View style={[styles.dock, { bottom }]} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: t.card,
            borderColor: t.hairline,
            opacity: expand,
            transform: [
              { translateX: expand.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
              { scale: expand.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
            ],
          },
        ]}
        pointerEvents={expanded ? "auto" : "none"}
      >
        <Pressable
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel="收起插件状态"
          style={styles.pillBody}
        >
          <Dot size={6} color={toneColor(t, tone)} />
          <Text style={[styles.pillText, { color: t.inkSub }]} numberOfLines={1}>
            {text}
          </Text>
        </Pressable>
      </Animated.View>

      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "收起插件状态" : "展开插件状态"}
        style={styles.dotButton}
      >
        <Animated.View
          style={[
            styles.dot,
            {
              backgroundColor: t.card,
              borderColor: t.hairline,
              opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
              transform: [
                { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) },
              ],
            },
          ]}
        >
          <Dot size={7} color={toneColor(t, tone)} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
  },
  dotButton: { paddingVertical: space(1.5), paddingLeft: space(1) },
  dot: {
    width: 26,
    height: 26,
    borderTopLeftRadius: radius.chip,
    borderBottomLeftRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderRightWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    maxWidth: 220,
    height: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  pillBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space(2.5),
  },
  pillText: { fontSize: 10.5, flexShrink: 1 },
});