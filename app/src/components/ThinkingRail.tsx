// 思考强度滑轨：对齐 NIBI 客户端的组合模型菜单里的效果。
//
// 轨道是绿→蓝渐变，白色圆钮可拖；填充上方有 slow sheen，底部有少量浮叶。
// 全部用 Animated 实现，不引 Reanimated；层数控制在小屏可接受的范围。

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { radius, space, useNibiTheme } from "../theme";

export interface ThinkingLevel {
  value: string;
  label: string;
}

const LEVEL_LABELS: Record<string, string> = {
  disabled: "关闭",
  off: "关闭",
  none: "关闭",
  nothink: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  "extra-high": "极高",
  extra_high: "极高",
  xhigh: "极高",
  max: "最高",
  ultra: "极致",
  enable: "开启",
  enabled: "开启",
  on: "开启",
  true: "开启",
};

export function thinkingLevelLabel(value: string): string {
  return LEVEL_LABELS[value] ?? value;
}

const LEAF_COLORS = ["#3f8f6a", "#5a86b8", "#756df3", "#d99554", "#6aa27a", "#527bb0"];

function Leaf({ index }: { index: number }) {
  const drift = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const seed = useMemo(() => {
    let value = index * 9301 + 49297;
    return () => {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }, [index]);

  useEffect(() => {
    const start = seed();
    const duration = 2400 + seed() * 2200;
    const loop = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(rise, {
            toValue: 1,
            duration,
            delay: start * 1800,
            useNativeDriver: true,
          }),
          Animated.timing(rise, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(drift, {
            toValue: 1,
            duration: duration * 0.8,
            delay: start * 1400,
            useNativeDriver: true,
          }),
          Animated.timing(drift, { toValue: 0, duration: duration * 0.6, useNativeDriver: true }),
        ]),
      ),
    ]);
    loop.start();
    return () => loop.stop();
  }, [drift, rise, seed]);

  const color = LEAF_COLORS[index % LEAF_COLORS.length]!;
  const left = `${8 + ((index * 37) % 82)}%`;
  const size = 6 + (index % 3) * 2;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.leaf,
        {
          left,
          width: size + 4,
          height: size,
          backgroundColor: color,
          opacity: rise.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.55, 0.45, 0] }),
          transform: [
            { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [4, -20] }) },
            { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-4, 5] }) },
            { rotate: drift.interpolate({ inputRange: [0, 1], outputRange: ["-18deg", "22deg"] }) },
          ],
        },
      ]}
    />
  );
}

export function ThinkingRail({
  levels,
  value,
  onChange,
}: {
  levels: readonly ThinkingLevel[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useNibiTheme();
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(0)).current;
  const currentIndex = Math.max(
    0,
    levels.findIndex((level) => level.value === value),
  );
  const ratio = levels.length > 1 ? currentIndex / (levels.length - 1) : 0;
  const current = levels[currentIndex];

  useEffect(() => {
    Animated.spring(progress, {
      toValue: ratio,
      useNativeDriver: true,
      damping: 16,
      stiffness: 180,
      mass: 0.7,
    }).start();
  }, [progress, ratio]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sheen, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sheen]);

  const pick = (x: number) => {
    if (levels.length < 2 || width <= 0) return;
    const inner = Math.max(1, width - 24);
    const index = Math.max(
      0,
      Math.min(levels.length - 1, Math.round(((x - 12) / inner) * (levels.length - 1))),
    );
    const next = levels[index];
    if (next && next.value !== value) onChange(next.value);
  };

  // pick closes over width/levels/value; keep the latest in a ref for the stable responder.
  const pickRef = useRef<(x: number) => void>(() => undefined);
  pickRef.current = pick;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => pickRef.current(event.nativeEvent.locationX),
      onPanResponderMove: (event) => pickRef.current(event.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.root}>
      <View
        style={[styles.track, { borderColor: t.hairline, backgroundColor: t.panel }]}
        onLayout={onLayout}
        {...responder.panHandlers}
      >
        <LinearGradient
          colors={["#2f9e6f", "#2f7fb8", "#5b6ee1", "#7a6cf0"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.trackTint}
        />
        <View style={styles.fillClip}>
          <LinearGradient
            colors={["#2f9e6f", "#2f7fb8", "#5b6ee1", "#7a6cf0"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.fill, { width: `${Math.max(3, ratio * 100)}%` }]}
          />
        </View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sheen,
            {
              opacity: 0.55,
              transform: [
                { translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-24, Math.max(24, width * ratio)] }) },
              ],
            },
          ]}
        />
        <View style={styles.stops} pointerEvents="none">
          {levels.map((level, index) => {
            const active = index <= currentIndex;
            return (
              <View
                key={level.value}
                style={[
                  styles.stop,
                  {
                    backgroundColor: active ? "#ffffff" : "rgba(255,255,255,0.55)",
                    opacity: active ? 1 : 0.65,
                    transform: [{ scale: index === currentIndex ? 1.45 : 1 }],
                  },
                ]}
              />
            );
          })}
        </View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.knob,
            {
              backgroundColor: t.card,
              borderColor: "rgba(255,255,255,0.8)",
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.max(0, width - 22)],
                  }),
                },
              ],
            },
          ]}
        />
        {Array.from({ length: 8 }, (_, index) => (
          <Leaf key={index} index={index} />
        ))}
      </View>
      <View style={styles.caption}>
        <Text style={[styles.captionLabel, { color: t.inkFaint }]}>思考强度</Text>
        <Text style={[styles.captionValue, { color: t.ink }]}>
          {current ? thinkingLevelLabel(current.value) : "—"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(1.5) },
  track: {
    height: 34,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    justifyContent: "center",
  },
  trackTint: { ...StyleSheet.absoluteFill, opacity: 0.08 },
  fillClip: { ...StyleSheet.absoluteFill, justifyContent: "center", paddingHorizontal: 4 },
  fill: { height: 22, borderRadius: radius.chip },
  sheen: {
    position: "absolute",
    top: 11,
    height: 4,
    width: 22,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  stops: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  stop: { width: 4, height: 4, borderRadius: 2 },
  knob: {
    position: "absolute",
    left: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  leaf: { position: "absolute", bottom: 9, borderRadius: 4, transform: [{ rotate: "-12deg" }] },
  caption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  captionLabel: { fontSize: 10.5 },
  captionValue: { fontSize: 12, fontWeight: "700" },
});
