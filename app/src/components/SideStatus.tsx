// 会话上下文状态：贴屏幕右侧的圆形占用环。
//
// 收起时是带呼吸动效的上下文占用环；点一下向左展开当前窗口用量与缓存命中率。
// 整条状态可以上下拖动；插件状态作为次要行保留。

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
import { Canvas, Circle, Path } from "@shopify/react-native-skia";

import { Dot } from "./Icon";
import { radius, space, useNibiTheme, type NibiTheme } from "../theme";

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  cacheHitRate: number | null;
}

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

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }
  return String(value);
}

function ContextRing({
  ratio,
  color,
  track,
}: {
  ratio: number;
  color: string;
  track: string;
}) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const path = useMemo(() => {
    if (clamped <= 0) return "";
    if (clamped >= 0.995) return "M 10 1.8 A 8.2 8.2 0 1 1 9.99 1.8";
    const angle = clamped * Math.PI * 2 - Math.PI / 2;
    const x = 10 + 8.2 * Math.cos(angle);
    const y = 10 + 8.2 * Math.sin(angle);
    return `M 10 1.8 A 8.2 8.2 0 ${clamped > 0.5 ? 1 : 0} 1 ${x} ${y}`;
  }, [clamped]);
  return (
    <Canvas style={styles.ring}>
      <Circle cx={10} cy={10} r={8.2} color={track} style="stroke" strokeWidth={2.4} />
      {path ? (
        <Path
          path={path}
          color={color}
          style="stroke"
          strokeWidth={2.4}
          strokeCap="round"
        />
      ) : null}
    </Canvas>
  );
}

export function SideStatus({
  plugins,
  usage,
  bottom,
}: {
  plugins: readonly LoadedPlugin[];
  usage: ContextUsage | null;
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

  const ratio =
    usage && usage.maxTokens > 0 ? Math.min(1, usage.usedTokens / usage.maxTokens) : 0;
  const meterColor = ratio >= 0.95 ? t.red : ratio >= 0.8 ? t.amber : t.brand;
  const cache =
    usage?.cacheHitRate === null || usage?.cacheHitRate === undefined
      ? "—"
      : `${Math.round(usage.cacheHitRate * 100)}%`;
  const current = strips[Math.min(index, Math.max(0, strips.length - 1))];
  const pluginText = current
    ? resolveText(
        current.strip.text,
        hostSlotData({
          enabledPlugins: plugins.length,
          plugin: {
            id: current.plugin.parsed.manifest.id,
            name: current.plugin.parsed.manifest.name,
            version: current.plugin.parsed.manifest.version,
          },
        }),
      ).trim()
    : "";
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
              { scale: expand.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          },
        ]}
        pointerEvents={expanded ? "auto" : "none"}
      >
        <Pressable
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel="收起上下文用量"
          style={styles.pillBody}
        >
          <View style={styles.pillHead}>
            <View style={styles.pillTitleRow}>
              <View style={[styles.statusDot, { backgroundColor: meterColor }]} />
              <Text style={[styles.pillTitle, { color: t.ink }]}>上下文</Text>
            </View>
            <Text style={[styles.pillValue, { color: t.inkSub }]}>
              {usage ? `${formatTokens(usage.usedTokens)} / ${formatTokens(usage.maxTokens)}` : "—"}
            </Text>
          </View>
          <View style={[styles.bar, { backgroundColor: t.hairline }]}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round(ratio * 100)}%`, backgroundColor: meterColor },
              ]}
            />
          </View>
          <View style={styles.pillFoot}>
            <Text style={[styles.pillMeta, { color: t.inkFaint }]}>缓存命中率</Text>
            <Text style={[styles.cacheValue, { color: t.steel }]}>{cache}</Text>
          </View>
          {pluginText ? (
            <View style={styles.pluginRow}>
              <Dot size={5} color={toneColor(t, current?.strip.tone)} />
              <Text style={[styles.pluginText, { color: t.inkFaint }]} numberOfLines={1}>
                {pluginText}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>

      <Pressable
        onPress={() => setExpanded((value) => !value)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={
          expanded
            ? "收起上下文用量，可上下拖动"
            : `上下文已用 ${Math.round(ratio * 100)}%，点击查看缓存命中率，可上下拖动`
        }
        style={styles.dotButton}
      >
        <Animated.View
          style={[
            styles.dot,
            {
              backgroundColor: t.card,
              borderColor: t.hairline,
              opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.74, 1] }),
              transform: [
                { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }) },
              ],
            },
          ]}
        >
          <ContextRing ratio={ratio} color={meterColor} track={t.hairline} />
          <Text style={[styles.percent, { color: t.inkSub }]}>
            {usage ? `${Math.round(ratio * 100)}` : "—"}
          </Text>
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
  dotButton: { width: 30, height: 46, alignItems: "center", justifyContent: "center" },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  ring: { width: 20, height: 20 },
  percent: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 11,
    textAlign: "center",
    fontSize: 6.5,
    fontWeight: "700",
    lineHeight: 8,
  },
  pill: {
    position: "absolute",
    right: 30,
    top: -28,
    width: 232,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  pillBody: { padding: space(2.5), gap: space(1.5) },
  pillHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pillTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  pillTitle: { fontSize: 11.5, fontWeight: "700" },
  pillValue: { fontSize: 10.5, fontWeight: "600" },
  bar: { height: 5, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  pillFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pillMeta: { fontSize: 10 },
  cacheValue: { fontSize: 11, fontWeight: "700" },
  pluginRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.05)",
    paddingTop: space(1),
  },
  pluginText: { fontSize: 9.5, flexShrink: 1 },
});