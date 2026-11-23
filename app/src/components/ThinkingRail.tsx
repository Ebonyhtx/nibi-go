// 思考强度滑轨：对齐 NIBI 客户端的组合模型菜单里的效果。
//
// 轨道按 NIBI 客户端的思考条：蓝紫→橙渐变、透明拖拽区（不画可见圆钮）、
// 4px 白色停靠点、流光和浮叶；到最高档时填充铺满整条轨道。
// 全部用 Animated 实现，不引 Reanimated；层数控制在小屏可接受的范围。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import { pickText, useI18n } from "../i18n";
import { useReducedMotion } from "../motion/appear";
import { haptic } from "../motion/haptics";
import { radius, size, space, text, useNibiTheme } from "../theme";

export interface ThinkingLevel {
  value: string;
  label: string;
}

export function thinkingLevelLabel(value: string): string {
  switch (value) {
    case "disabled":
    case "off":
    case "none":
    case "nothink":
      return pickText("关闭", "Off");
    case "minimal":
      return pickText("极低", "Minimal");
    case "low":
      return pickText("低", "Low");
    case "medium":
      return pickText("中", "Medium");
    case "high":
      return pickText("高", "High");
    case "extra-high":
    case "extra_high":
    case "xhigh":
      return pickText("极高", "Extra high");
    case "max":
      return pickText("最高", "Max");
    case "ultra":
      return pickText("极致", "Ultra");
    case "enable":
    case "enabled":
    case "on":
    case "true":
      return pickText("开启", "On");
    default:
      return value;
  }
}

const LEAF_COLORS = ["#e88238", "#756df3", "#68a071", "#587ba8", "#c57a45", "#948cff"];

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
  const { pick: pickLabel } = useI18n();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const sheen = useRef(new Animated.Value(0)).current;
  const currentIndex = Math.max(
    0,
    levels.findIndex((level) => level.value === value),
  );
  const ratio = levels.length > 1 ? currentIndex / (levels.length - 1) : 0;
  const current = levels[currentIndex];

  useEffect(() => {
    if (reduced) {
      sheen.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sheen, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, sheen]);

  const pick = useCallback(
    (x: number) => {
      if (levels.length < 2 || width <= 0) return;
      const inner = Math.max(1, width - 24);
      const index = Math.max(
        0,
        Math.min(levels.length - 1, Math.round(((x - 12) / inner) * (levels.length - 1))),
      );
      const next = levels[index];
      if (next && next.value !== value) {
        haptic("tick");
        onChange(next.value);
      }
    },
    [levels, onChange, value, width],
  );

  // 用 ref 给稳定的 RNGH 手势读取最新 pick，避免每次切换档位都重建手势识别器。
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const pickFromGesture = useCallback((x: number) => {
    pickRef.current(x);
  }, []);

  // 横向滑动优先占手势，纵向 > 12px 立刻让给外层 Sheet 下拉关闭或 ScrollView，不抢手势。
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart((e) => {
        runOnJS(pickFromGesture)(e.x);
      })
      .onUpdate((e) => {
        runOnJS(pickFromGesture)(e.x);
      });
    const tap = Gesture.Tap().onEnd((e) => {
      runOnJS(pickFromGesture)(e.x);
    });
    return Gesture.Race(pan, tap);
  }, [pickFromGesture]);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const peak = ratio >= 0.995;
  return (
    <View style={styles.root}>
      <View style={styles.caption}>
        <Text style={[styles.captionLabel, { color: t.inkSub }]}>
          {pickLabel("思考强度", "Thinking effort")}
        </Text>
        <View
          style={[
            styles.captionBadge,
            { backgroundColor: t.surfaceSoft, borderColor: t.hairline },
          ]}
        >
          <Text style={[styles.captionValue, { color: t.ink }]}>
            {current ? thinkingLevelLabel(current.value) : "—"}
          </Text>
        </View>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          style={[
            styles.track,
            { backgroundColor: t.surfaceSoft, borderColor: t.hairlineStrong },
          ]}
          onLayout={onLayout}
        >
          <LinearGradient
            colors={["rgba(117,109,243,0.05)", "rgba(236,130,56,0.04)", "rgba(104,160,113,0.04)"]}
            locations={[0, 0.46, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.trackTint}
          />
          <View style={styles.fillClip}>
            <LinearGradient
              colors={["rgba(88,123,168,0.68)", "rgba(117,109,243,0.54)", "rgba(236,130,56,0.56)"]}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[
                styles.fill,
                peak ? styles.fillPeak : null,
                { width: peak ? "100%" : `${Math.max(2, ratio * 100)}%` },
              ]}
            />
          </View>
          {!reduced ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.sheen,
                {
                  opacity: 0.42,
                  transform: [
                    {
                      translateX: sheen.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-32, Math.max(24, width * ratio)],
                      }),
                    },
                  ],
                },
              ]}
            />
          ) : null}
          <View style={styles.stops} pointerEvents="none">
            {levels.map((level, index) => {
              const active = index <= currentIndex;
              return (
                <View
                  key={level.value}
                  style={[
                    styles.stop,
                    {
                      opacity: index === currentIndex ? 1 : active ? 0.75 : 0.45,
                      transform: [{ scale: index === currentIndex ? 1.55 : 1 }],
                    },
                  ]}
                />
              );
            })}
          </View>
          {!reduced
            ? Array.from({ length: 12 }, (_, index) => <Leaf key={index} index={index} />)
            : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(2), paddingVertical: space(0.5) },
  track: {
    height: size.button,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    justifyContent: "center",
  },
  trackTint: { ...StyleSheet.absoluteFill, opacity: 0.08 },
  fillClip: { ...StyleSheet.absoluteFill, justifyContent: "center" },
  fill: { height: 6, borderRadius: 3, opacity: 0.56 },
  fillPeak: { height: size.button, borderRadius: 0, opacity: 0.56 },
  sheen: {
    position: "absolute",
    top: (size.button - 4) / 2,
    height: 4,
    width: 44,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  stops: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space(3.5),
  },
  stop: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#ffffff" },
  leaf: {
    position: "absolute",
    bottom: space(2.5),
    borderTopLeftRadius: 7,
    borderBottomRightRadius: 7,
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 2,
    transform: [{ rotate: "-14deg" }],
  },
  caption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space(0.5),
  },
  captionLabel: { ...text("micro"), fontWeight: "600" },
  captionBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: 2,
  },
  captionValue: { ...text("small"), fontWeight: "700" },
});
