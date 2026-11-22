// 入场动效原语：新行淡入 + 轻微上移（消息流/会话列表/分组 stagger 共用）。
// 只在「挂载时」播一次：列表行按 key 复用，滚动复用不会重播；新 key 才触发。
// 尊重两类「关动效」：系统「减少动态效果」（AccessibilityInfo）与应用内「界面动效」
// 开关（设备偏好 motionEnabled）——任一开启就直出终态。
//
// 性能优化：系统 reduceMotion 改为模块级单例订阅（只查一次原生桥，不再每挂载一行发一次
// async IPC）。终态兜底仍保留（动效可以失败，终态不许失败）。
import { Animated, AccessibilityInfo } from "react-native";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { getCachedDevicePreferences, subscribeDevicePreferences } from "../settings/devicePreferences";
import { easingStandard } from "./easing";
import { motion } from "../theme";

let systemReduceMotion = false;
let reduceMotionInitialized = false;
const reduceMotionListeners = new Set<() => void>();

function ensureReduceMotionSubscription(): void {
  if (reduceMotionInitialized) return;
  reduceMotionInitialized = true;
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then((value) => {
      const next = Boolean(value);
      if (next !== systemReduceMotion) {
        systemReduceMotion = next;
        for (const listener of reduceMotionListeners) listener();
      }
    })
    .catch(() => undefined);
  AccessibilityInfo.addEventListener?.("reduceMotionChanged", (value) => {
    const next = Boolean(value);
    if (next !== systemReduceMotion) {
      systemReduceMotion = next;
      for (const listener of reduceMotionListeners) listener();
    }
  });
}

function subscribeReduceMotion(listener: () => void): () => void {
  ensureReduceMotionSubscription();
  reduceMotionListeners.add(listener);
  return () => {
    reduceMotionListeners.delete(listener);
  };
}

/** 当前是否应跳过/直出动效（系统减少动画 || 应用内关闭动效）。 */
export function useReducedMotion(): boolean {
  const sysReduced = useSyncExternalStore(
    subscribeReduceMotion,
    () => systemReduceMotion,
    () => false,
  );
  const motionEnabled = useSyncExternalStore(
    subscribeDevicePreferences,
    () => getCachedDevicePreferences().motionEnabled,
    () => true,
  );
  return sysReduced || !motionEnabled;
}

/** 挂载时 opacity 0→1 + translateY(distance→0)。关动效时直出。 */
export function AppearIn({
  distance = 8,
  delay = 0,
  // 入口动效是「内容到达」的提示，不是表演：150ms 内收住，才不会让页面在
  // native push 已经结束后还在继续淡入（运营者感知为「慢半拍」）。
  duration = motion.duration.fast,
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
  const reduced = useReducedMotion();
  // 入场参数只认挂载时的第一份：父级每次渲染都会重新算 delay（stagger 序号），
  // 若把 delay 放进依赖，任何一次父级重渲染都会把入场动画从头重播——列表看着
  // 就是一闪一闪。动画只跟「是否关动效」走。
  const initialDelay = useRef(delay);
  const initialDuration = useRef(duration);
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const startDelay = initialDelay.current;
    const runDuration = initialDuration.current;
    // 兜底：动画窗口结束（含 delay）后无论成败都钉在终态，清掉中途冻结的可能。
    const settle = setTimeout(() => progress.setValue(1), startDelay + runDuration + 400);
    Animated.timing(progress, {
      toValue: 1,
      delay: startDelay,
      duration: runDuration,
      easing: easingStandard,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) progress.setValue(1);
    });
    return () => clearTimeout(settle);
  }, [reduced, progress]);
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
 * 列表逐项交错延时（ms）：单步 24ms、全局封顶 96ms。
 * 之前 36ms × 8 = 288ms，叠上 220ms 动画超过半秒，native push 播完后屏幕还在淡入。
 */
export function staggerDelay(index: number, stepMs = 24, maxMs = 96): number {
  return Math.min(index * stepMs, maxMs);
}
