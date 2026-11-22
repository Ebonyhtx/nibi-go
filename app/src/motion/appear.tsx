// 入场动效原语：新行淡入 + 轻微上移（消息流/会话列表/分组 stagger 共用）。
// 只在「挂载时」播一次：列表行按 key 复用，滚动复用不会重播；新 key 才触发。
// 尊重两类「关动效」：系统「减少动态效果」（AccessibilityInfo）与应用内「界面动效」
// 开关（桌面同名设置的移植语义，设备偏好 motionEnabled）——任一开启就直出终态。
//
// 事故教训（2026-11-21 真机）：native 驱动的 timing 会被静默取消（JS finish 回调都不来），
// 空态标题永久冻在半透明（浅色实测 opacity≈0.31 / 深色≈0.57，重启也不恢复）。
// 所以除了 finished=false 时回填终值，再加一个「动画窗口过后强制 setValue(1)」的兜底——
// 动效可以失败，终态不许失败。
import { Animated, AccessibilityInfo } from "react-native";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { getCachedDevicePreferences, subscribeDevicePreferences } from "../settings/devicePreferences";
import { easingStandard } from "./easing";
import { motion } from "../theme";

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
  const [systemReduced, setSystemReduced] = useState(false);
  // 应用内动效开关：用外部 store 订阅（设置里切开关即时生效，本组件不重挂）。
  const motionEnabled = useSyncExternalStore(
    subscribeDevicePreferences,
    () => getCachedDevicePreferences().motionEnabled,
  );
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (alive) setSystemReduced(Boolean(value));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const reduced = systemReduced || !motionEnabled;
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
 * 列表 stagger：第 index 个元素的入场延迟 = index * stepMs（封顶，避免长列表最后项等太久）。
 * 与 AppearIn 配合：delay={staggerDelay(index)}。
 */
export function staggerDelay(index: number, stepMs = 32, capMs = 320): number {
  // 全局硬上限：无论调用方给多大的 cap，整串 stagger 都必须在 96ms 内排完，
  // 保证最后一个元素在页面转场（~300ms）结束前落定。列表/路由页共用。
  return Math.min(index * stepMs, capMs, 96);
}
