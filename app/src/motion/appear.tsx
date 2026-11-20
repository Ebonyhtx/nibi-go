// 入场动效原语：新行淡入 + 轻微上移（消息流/会话列表/分组 stagger 共用）。
// 只在「挂载时」播一次：列表行按 key 复用，滚动复用不会重播；新 key 才触发。
// 尊重系统「减少动态效果」：开了就直出终态，不做动画。
import { Animated } from "react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AccessibilityInfo } from "react-native";

import { easingStandard } from "./easing";
import { motion } from "../theme";

/** 挂载时 opacity 0→1 + translateY(distance→0)。reduced-motion 时直出。 */
export function AppearIn({
  distance = 8,
  delay = 0,
  duration = motion.duration.base,
  children,
  style,
}: {
  distance?: number;
  delay?: number;
  duration?: number;
  children: ReactNode;
  style?: object;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((value) => {
      if (alive) setReduced(Boolean(value));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      delay,
      duration,
      easing: easingStandard,
      useNativeDriver: true,
    }).start();
  }, [reduced, progress, delay, duration]);
  if (reduced) return <Animated.View style={style}>{children}</Animated.View>;
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * 列表 stagger：第 index 个元素的入场延迟 = index * stepMs（封顶，避免长列表最后项等太久）。
 * 与 AppearIn 配合：delay={staggerDelay(index)}。
 */
export function staggerDelay(index: number, stepMs = 32, capMs = 320): number {
  return Math.min(index * stepMs, capMs);
}
