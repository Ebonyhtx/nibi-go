// 插件状态：贴屏幕右侧的圆形悬浮状态点。
//
// 收起时只露一个会呼吸的圆点（贴边，不留缝）；点一下向左展开完整状态条，再点收起。
// 整条状态可以上下拖动，位置留在本次会话里；多插件状态轮流显示。

import { hostSlotData } from "../plugins/data";
import type { LoadedPlugin } from "../plugins/store";
import { resolveText, type ViewTone } from "@nibi-go/plugin-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const strips = plugins.flatMap((plugin) =>
    plugin.parsed.manifest.contributes.strips.map((strip) => ({ plugin, strip })),
  );
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  // 拖动后的底部距离；null = 用父级给的基础位置。
  const [draggedBottom, setDraggedBottom] = useState<number | null>(null);
  const bottomRef = useRef(bottom);
  bottomRef.current = bottom;
  const draggedRef = useRef<number | null>(null);
  draggedRef.current = draggedBottom;
  const dragStart = useRef(0);
  const breathe = useRef(new Animated.Value(0)).current;
  const expand = useRef(new Animated.Value(0)).current;

  const clampBottom = (value: number): number => {
    const min = insets.bottom + 72;
    const max = Math.max(min, screenHeight - insets.top - 96);
    return Math.max(min, Math.min(max, value));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 3,
        onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          dragStart.current = draggedRef.current ?? bottomRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          setDraggedBottom(clampBottom(dragStart.current - gesture.dy));
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // clampBottom 只依赖布局尺寸，随 screenHeight/insets 重建。
    [screenHeight, insets.top, insets.bottom],
  );

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

  const actualBottom = draggedBottom ?? bottom;

  return (
    <View
      style={[styles.dock, { bottom: actualBottom }]}
      pointerEvents="auto"
      {...pan.panHandlers}
    >
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
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? "收起插件状态，可上下拖动" : "展开插件状态，可上下拖动"
        }
        style={styles.dotButton}
      >
        <Animated.View
          style={[
            styles.dot,
            {
              backgroundColor: t.card,
              borderColor: t.hairline,
              opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
              transform: [
                { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] }) },
              ],
            },
          ]}
        >
          <Dot size={8} color={toneColor(t, tone)} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    right: 0,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
  },
  dotButton: { width: 28, height: 44, alignItems: "center", justifyContent: "center" },
  // 圆形、贴边：不再用半胶囊（半胶囊看起来像被截断的条）。
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  pill: {
    position: "absolute",
    right: 28,
    top: 7,
    maxWidth: 218,
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