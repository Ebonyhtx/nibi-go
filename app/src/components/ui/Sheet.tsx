// 统一底部弹层底座（Reanimated + RNGH 旗舰手感）：
//   - 全屏 edge-to-edge 遮罩（statusBarTranslucent / navigationBarTranslucent）
//   - 顶部抓手条 + 跟手下拉关闭（保留甩动初速的临界阻尼弹簧 + 过阈轻触感 + 向上轻橡皮筋）
//   - 按实测高度滑入滑出（高弹层不再从半屏凭空淡入）
//   - 卡片延伸至屏底并内部留 safe-area（消除底部透明缝与键盘双倍留白）
//   - 可选 avoidKeyboard（独立 UI 线程 translateY，绝不与 RN Animated 驱动冲突）
//   - 退场完成带 visibleRef 守卫（关→立刻重开不会误卸）
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Modal, StyleSheet, View, type KeyboardEvent } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "../../motion/appear";
import { haptic } from "../../motion/haptics";
import { radius, space, useNibiTheme } from "../../theme";

const SHEET_SPRING = {
  damping: 30,
  stiffness: 320,
  mass: 0.9,
  overshootClamping: true,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 0.5,
} as const;

export function Sheet({
  visible,
  onClose,
  children,
  maxHeightRatio = 0.84,
  /** 危险/沉浸弹层用加深遮罩 */
  strong = false,
  /** 表单类 sheet：键盘抬起时整块上移（否则底部字段会被 IME 盖住）。 */
  avoidKeyboard = false,
  /** 是否显示顶部抓手并允许下拉关闭（全屏预览默认隐藏抓手）。 */
  showHandle,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeightRatio?: number;
  strong?: boolean;
  avoidKeyboard?: boolean;
  showHandle?: boolean;
}) {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const handleEnabled = showHandle ?? maxHeightRatio < 0.98;

  const [rendered, setRendered] = useState(visible);
  const [interactive, setInteractive] = useState(visible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 实测内容高度（未量到前按 420dp 兜底，避免高弹层从半屏淡入）。
  const sheetH = useSharedValue(420);
  // 垂直偏移：0 = 完全打开，sheetH = 完全收起，负值 = 向上橡皮筋微拉。
  const translateY = useSharedValue(420);
  // 背景遮罩透明度（0..1）。
  const backdrop = useSharedValue(0);
  // 键盘上推偏移（纯 UI 线程，独立于下拉拖拽，不引发每帧重排）。
  const kbLift = useSharedValue(0);

  // 键盘避让监听（仅在 avoidKeyboard 且弹层挂载期间激活）。
  useEffect(() => {
    if (!avoidKeyboard || !rendered) {
      kbLift.value = 0;
      return;
    }
    const apply = (event: KeyboardEvent) => {
      const h = Math.max(0, event.endCoordinates.height);
      if (reduced) {
        kbLift.value = h;
      } else {
        kbLift.value = withTiming(h, {
          duration: 210,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
        });
      }
    };
    const show = Keyboard.addListener("keyboardDidShow", apply);
    const hide = Keyboard.addListener("keyboardDidHide", (event) =>
      apply({ ...event, endCoordinates: { ...event.endCoordinates, height: 0 } }),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [avoidKeyboard, kbLift, reduced, rendered]);

  const finishCloseIfStillHidden = () => {
    if (!visibleRef.current) setRendered(false);
  };

  useEffect(() => {
    if (visible) {
      setRendered(true);
      setInteractive(true);
      if (reduced) {
        translateY.value = 0;
        backdrop.value = 1;
      } else {
        backdrop.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });
        translateY.value = withSpring(0, SHEET_SPRING);
      }
      return;
    }
    if (!rendered) return;
    setInteractive(false);
    if (reduced) {
      translateY.value = sheetH.value;
      backdrop.value = 0;
      setRendered(false);
      return;
    }
    backdrop.value = withTiming(0, { duration: 190, easing: Easing.in(Easing.cubic) });
    translateY.value = withTiming(
      Math.max(sheetH.value, 280),
      { duration: 200, easing: Easing.bezier(0.4, 0, 1, 1) },
      (finished) => {
        "worklet";
        if (finished) runOnJS(finishCloseIfStillHidden)();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rendered, reduced]);

  const triggerClose = () => {
    onCloseRef.current();
  };

  // 顶部抓手区下拉关闭手势：1:1 跟手、向上轻橡皮筋、过 28% 或甩动 >600px/s 关闭。
  const crossed = useSharedValue(0);
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(handleEnabled)
        .activeOffsetY([-6, 6])
        .failOffsetX([-24, 24])
        .onBegin(() => {
          "worklet";
          crossed.value = 0;
        })
        .onUpdate((event) => {
          "worklet";
          const dy = event.translationY;
          const h = Math.max(sheetH.value, 220);
          if (dy < 0) {
            // 向上微拉：轻橡皮筋，最多 14dp，不会把底部拉离屏底。
            const e2 = Math.exp((-2 * Math.abs(dy)) / 90);
            const tanh = (1 - e2) / (1 + e2);
            translateY.value = -14 * tanh;
            backdrop.value = 1;
          } else {
            translateY.value = dy;
            backdrop.value = Math.max(0, 1 - dy / h);
            const threshold = Math.max(72, h * 0.28);
            if (dy > threshold && crossed.value === 0) {
              crossed.value = 1;
              runOnJS(haptic)("threshold");
            } else if (dy < threshold * 0.8 && crossed.value === 1) {
              crossed.value = 0;
            }
          }
        })
        .onEnd((event) => {
          "worklet";
          const h = Math.max(sheetH.value, 220);
          const threshold = Math.max(72, h * 0.28);
          if (translateY.value > threshold || event.velocityY > 600) {
            backdrop.value = withTiming(0, { duration: 170 });
            translateY.value = withSpring(h + 32, {
              ...SHEET_SPRING,
              velocity: Math.max(0, event.velocityY),
            });
            runOnJS(triggerClose)();
          } else {
            backdrop.value = withTiming(1, { duration: 180 });
            translateY.value = withSpring(0, {
              ...SHEET_SPRING,
              velocity: event.velocityY,
            });
          }
        })
        .onFinalize((_event, success) => {
          "worklet";
          if (!success && translateY.value > 0) {
            backdrop.value = withTiming(1, { duration: 180 });
            translateY.value = withSpring(0, SHEET_SPRING);
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleEnabled],
  );

  const backdropTap = useMemo(
    () =>
      Gesture.Tap().onEnd((_event, success) => {
        "worklet";
        if (success) runOnJS(triggerClose)();
      }),
    [],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value,
  }));

  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -kbLift.value }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!rendered) return null;

  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <GestureDetector gesture={backdropTap}>
          <Animated.View
            pointerEvents={interactive ? "auto" : "none"}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: strong ? th.backdropStrong : th.backdrop },
              backdropStyle,
            ]}
          />
        </GestureDetector>

        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, liftStyle]}>
          <Animated.View
            pointerEvents={interactive ? "auto" : "none"}
            onLayout={(event) => {
              const h = event.nativeEvent.layout.height;
              if (h > 0) sheetH.value = h;
            }}
            style={[
              styles.content,
              {
                maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
                backgroundColor: th.card,
                borderTopColor: th.hairlineStrong,
                paddingBottom: insets.bottom,
                ...th.elevation.menu,
              },
              contentStyle,
            ]}
          >
            {handleEnabled ? (
              <GestureDetector gesture={dragGesture}>
                <View style={styles.handleZone} accessible accessibilityLabel="向下拖动关闭">
                  <View style={[styles.handlePill, { backgroundColor: th.inkGhost }]} />
                </View>
              </GestureDetector>
            ) : null}
            {children}
          </Animated.View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  handleZone: {
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: space(1.5),
    paddingBottom: space(0.5),
  },
  handlePill: {
    width: 40,
    height: 4,
    borderRadius: radius.chip,
    opacity: 0.65,
  },
});
