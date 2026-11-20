// 全应用的按压反馈原语：按下 scale 微缩、松开弹簧回弹（native driver，不触发重排）。
// 替换散落各处的 `({ pressed }) => opacity 0.4` —— 那种只变透明度，没有「按下去」的手感。
// style 兼容函数形式（收到 pressed）；ref 透传到底层 Pressable（measureInWindow 锚点要用）。
// 用法：<PressableScale onPress={...} style={...}>...</PressableScale>，其余 props 透传 Pressable。
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { forwardRef, useEffect, useRef } from "react";

import { motion } from "../theme";

/** 底层 Pressable 的 ref 类型（RN 0.88 是 ReactNativeElement，不是 View）。 */
type PressableRef = React.ComponentRef<typeof Pressable>;

export interface PressableScaleProps extends PressableProps {
  /** 按下时的缩放（默认 0.97；大块面用 0.98，小 chip 用 0.94） */
  scaleTo?: number;
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  children?: React.ReactNode;
}

type StyleInput = NonNullable<PressableScaleProps["style"]>;

export const PressableScale = forwardRef<PressableRef, PressableScaleProps>(function PressableScale(
  { scaleTo = 0.97, style, children, ...rest },
  ref,
) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressed = useRef(false);

  useEffect(() => {
    // disabled 翻 true 时如果还停在按下的缩放，回弹一次。
    if (rest.disabled && pressed.current) {
      pressed.current = false;
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        ...motion.spring.snappy,
      }).start();
    }
  }, [rest.disabled, scale]);

  return (
    <Pressable
      {...rest}
      ref={ref}
      onPressIn={(event) => {
        pressed.current = true;
        Animated.spring(scale, {
          toValue: scaleTo,
          useNativeDriver: true,
          ...motion.spring.snappy,
        }).start();
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.current = false;
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          ...motion.spring.snappy,
        }).start();
        rest.onPressOut?.(event);
      }}
    >
      {({ pressed: isPressed }) => {
        const resolved: StyleProp<ViewStyle> =
          typeof style === "function" ? style({ pressed: isPressed }) : style;
        return (
          <Animated.View style={[resolved, { transform: [{ scale }] }]}>{children}</Animated.View>
        );
      }}
    </Pressable>
  );
});
