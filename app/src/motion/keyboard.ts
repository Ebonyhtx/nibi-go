// 键盘逐帧跟手：优先走 react-native-keyboard-controller（Android API 30+ 原生
// WindowInsetsAnimationCompat.Callback + Animated.event useNativeDriver），在 UI 线程
// 逐帧咬合系统 IME 弹出/收起曲线；未挂载 KeyboardProvider 或关闭动效偏好时平滑回退到
// RN Keyboard 事件。
import { Animated, Keyboard, type KeyboardEvent } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardEvents,
  useKeyboardContext,
} from "react-native-keyboard-controller";

import { getCachedDevicePreferences } from "../settings/devicePreferences";
import { easingStandard } from "./easing";
import { motion } from "../theme";

export interface KeyboardFollow {
  /**
   * 键盘有效抬升高度（0 = 收起，扣除底部安全区后 >= 0）；
   * 走 native driver，用于 transform/opacity（禁止直接挂 marginBottom）。
   */
  offset: Animated.AnimatedInterpolation<number>;
  /** 键盘是否可见（给「滚到底部」等逻辑用）。 */
  visible: boolean;
  /** 最近一次事件的像素高度（静态 bottomInset / 非动画消费者用，已扣除底部安全区）。 */
  height: number;
}

export function useKeyboardFollow(
  insetsBottom = 0,
  enabled = true,
): KeyboardFollow {
  const context = useKeyboardContext();
  const fallbackOffset = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(0);
  const inset = Math.max(0, Math.round(insetsBottom));

  // KeyboardController 的 context.animated.height 在原生线程上从 0 变化到 -imeHeight
  //（edge-to-edge 下含底部导航栏高度）。通过原生插值节点在 UI 线程直接扣除 insetsBottom
  // 并翻转为正值 offset（0 → max(0, imeHeight - inset)），全程零 JS 桥接。
  const controllerOffset = useMemo(
    () =>
      context.animated.height.interpolate({
        inputRange: inset > 0 ? [-4000 - inset, -inset, 0] : [-4000, 0],
        outputRange: inset > 0 ? [4000, 0, 0] : [4000, 0],
        extrapolate: "clamp",
      }),
    [context.animated.height, inset],
  );

  useEffect(() => {
    if (!enabled) {
      fallbackOffset.setValue(0);
      setVisible(false);
      setHeight(0);
      return;
    }

    const applyHeight = (rawEnd: number) => {
      const end = Math.max(0, Math.round(rawEnd));
      setHeight(end);
      setVisible(end > 0);
      if (context.enabled && getCachedDevicePreferences().motionEnabled) {
        fallbackOffset.setValue(end);
        return;
      }
      if (!getCachedDevicePreferences().motionEnabled) {
        fallbackOffset.setValue(end);
        return;
      }
      Animated.timing(fallbackOffset, {
        toValue: end,
        duration: motion.duration.base,
        easing: easingStandard,
        useNativeDriver: true,
      }).start();
    };

    // 原生 KeyboardController 事件（包含完整 ime.bottom，需扣除底部安全区 inset）
    const willShow = KeyboardEvents.addListener("keyboardWillShow", (e) => {
      if (e.height > 0) applyHeight(e.height - inset);
    });
    const didShow = KeyboardEvents.addListener("keyboardDidShow", (e) => {
      applyHeight(e.height - inset);
    });
    const willHide = KeyboardEvents.addListener("keyboardWillHide", () => {
      applyHeight(0);
    });
    const didHide = KeyboardEvents.addListener("keyboardDidHide", () => {
      applyHeight(0);
    });

    // RN Keyboard 兜底（当原生模块未触发或处于测试环境时；RN edge-to-edge 已扣除导航栏）
    const rnShow = Keyboard.addListener("keyboardDidShow", (event: KeyboardEvent) => {
      if (!context.enabled) {
        applyHeight(event.endCoordinates.height);
      }
    });
    const rnHide = Keyboard.addListener("keyboardDidHide", () => {
      if (!context.enabled) {
        applyHeight(0);
      }
    });

    return () => {
      willShow.remove();
      didShow.remove();
      willHide.remove();
      didHide.remove();
      rnShow.remove();
      rnHide.remove();
    };
  }, [context.enabled, enabled, fallbackOffset, inset]);

  const fallbackInterpolated = useMemo(
    () =>
      fallbackOffset.interpolate({
        inputRange: [0, 4000],
        outputRange: [0, 4000],
        extrapolate: "clamp",
      }),
    [fallbackOffset],
  );

  const useNativeController =
    enabled && context.enabled && getCachedDevicePreferences().motionEnabled;

  return {
    offset: useNativeController ? controllerOffset : fallbackInterpolated,
    visible,
    height,
  };
}
