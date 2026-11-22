// 键盘跟随的动画化：纯 GPU/native driver（驱动 translateY / opacity），
// 避免每帧改 marginBottom 引发整屏 Yoga 重排与 ScrollView 抖动。
// 边缘到边缘（edgeToEdgeEnabled）下 Android 的 adjustResize 不可靠，仍以 keyboard 事件为准。
import { Animated, Keyboard, type KeyboardEvent } from "react-native";
import { useEffect, useRef, useState } from "react";

import { getCachedDevicePreferences } from "../settings/devicePreferences";
import { easingStandard } from "./easing";
import { motion } from "../theme";

export interface KeyboardFollow {
  /** 键盘占位高度（0 = 收起）；走 native driver，用于 transform/opacity（禁止直接挂 marginBottom）。 */
  offset: Animated.Value;
  /** 键盘是否可见（给「滚到底部」等逻辑用）。 */
  visible: boolean;
  /** 最近一次事件的像素高度（静态 bottomInset / 非动画消费者用）。 */
  height: number;
}

export function useKeyboardFollow(enabled = true): KeyboardFollow {
  const offset = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) {
      offset.setValue(0);
      setVisible(false);
      setHeight(0);
      return;
    }
    const apply = (event: KeyboardEvent) => {
      const end = Math.max(0, event.endCoordinates.height);
      setHeight(end);
      setVisible(end > 0);
      if (!getCachedDevicePreferences().motionEnabled) {
        offset.setValue(end);
        return;
      }
      Animated.timing(offset, {
        toValue: end,
        duration: motion.duration.base,
        easing: easingStandard,
        useNativeDriver: true,
      }).start();
    };
    const show = Keyboard.addListener("keyboardDidShow", apply);
    const hide = Keyboard.addListener("keyboardDidHide", (event) =>
      apply({ ...event, endCoordinates: { ...event.endCoordinates, height: 0 } }),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [offset, enabled]);

  return { offset, visible, height };
}
