// 全应用的按压反馈原语：按下 scale 微缩、松开弹簧回弹（native driver，不触发重排）。
// 替换散落各处的 `({ pressed }) => opacity 0.4` —— 那种只变透明度，没有「按下去」的手感。
//
// 结构：外层 Pressable（只承载布局约束 containerStyle + 触摸）→ 内层 Animated.View
// （承载视觉样式 + scale）。试过 Animated.createAnimatedComponent(Pressable) 把两者合一，
// 结果 onPress 整体失效（真机回归：所有按钮点了没反应），所以保持两层。
// 需要 flex 约束的控件（顶栏 chip 要收缩、不能被长标题撑开压到隔壁）把约束放进 containerStyle。
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { forwardRef, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  getCachedDevicePreferences,
  subscribeDevicePreferences,
} from "../settings/devicePreferences";
import { motion } from "../theme";

/** 底层 Pressable 的 ref 类型（RN 0.88 是 ReactNativeElement，不是 View）。 */
type PressableRef = React.ComponentRef<typeof Pressable>;

export interface PressableScaleProps extends PressableProps {
  /** 按下时的缩放（默认 0.97；大块面用 0.98，小 chip 用 0.94） */
  scaleTo?: number;
  /** 视觉样式（背景/边框/内边距/圆角…）——落在会缩放的内层 */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** 布局约束（flexGrow / flexShrink / minWidth / alignSelf / 外边距）——落在不缩放的外层 */
  containerStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const PressableScale = forwardRef<PressableRef, PressableScaleProps>(
  function PressableScale({ scaleTo = 0.97, style, containerStyle, children, ...rest }, ref) {
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  // 应用内「界面动效」开关：关掉就跳过弹簧（只留按压态，终态不变）。
  const motionEnabled = useSyncExternalStore(
    subscribeDevicePreferences,
    () => getCachedDevicePreferences().motionEnabled,
  );

  useEffect(() => {
    // disabled 翻 true 时如果还停在按下的缩放，回弹一次。
    if (rest.disabled && pressed) {
      setPressed(false);
      if (motionEnabled) {
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          ...motion.spring.snappy,
        }).start();
      } else {
        scale.setValue(1);
      }
    }
  }, [rest.disabled, pressed, scale, motionEnabled]);

  const pressIn = () => {
    setPressed(true);
    if (motionEnabled) {
      Animated.spring(scale, {
        toValue: scaleTo,
        useNativeDriver: true,
        ...motion.spring.snappy,
      }).start();
    }
  };
  const pressOut = () => {
    setPressed(false);
    if (motionEnabled) {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        ...motion.spring.snappy,
      }).start();
    } else {
      scale.setValue(1);
    }
  };

    const resolved: StyleProp<ViewStyle> = typeof style === "function" ? style({ pressed }) : style;

    return (
      <Pressable
        {...rest}
        ref={ref}
        style={containerStyle}
        onPressIn={(event) => {
          pressIn();
          rest.onPressIn?.(event);
        }}
        onPressOut={(event) => {
          pressOut();
          rest.onPressOut?.(event);
        }}
      >
        <Animated.View style={[resolved, { transform: [{ scale }] }]}>{children}</Animated.View>
      </Pressable>
    );
  },
);
