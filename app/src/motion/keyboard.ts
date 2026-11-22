// 键盘跟随的动画化：原来 index.tsx 用 state 存 keyboardHeight 再换 marginBottom（硬跳），
// 这里把高度做成 Animated.Value，键盘事件到来时按动效契约平滑过渡。
// 边缘到边缘（edgeToEdgeEnabled）下 Android 的 adjustResize 不可靠，仍以 keyboard 事件为准。
import { Animated, Keyboard, type KeyboardEvent } from "react-native";
import { useEffect, useRef, useState } from "react";

import { easingStandard } from "./easing";
import { motion } from "../theme";

export interface KeyboardFollow {
  /** 键盘占位高度（0 = 收起）；挂在输入栏的 marginBottom 上。 */
  offset: Animated.Value;
  /** 键盘是否可见（给「滚到底部」等逻辑用）。 */
  visible: boolean;
  /** 最近一次事件的像素高度（非动画消费者用）。 */
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
      const end = event.endCoordinates.height;
      setHeight(end);
      setVisible(end > 0);
      Animated.timing(offset, {
        toValue: end,
        duration: motion.duration.base,
        easing: easingStandard,
        useNativeDriver: false, // marginBottom 是布局属性，不能走 native driver
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
