// 左右侧栏共用的一层「玻璃遮罩」：全屏模糊 + 压暗 + 点击/横滑关闭热区。
//
// 三个关键决定：
//  1. 只留一张模糊层。左右侧栏共用它，避免双全屏 BlurView 叠加合成。
//  2. **滑动过程中不跑真模糊**：拖动（dragging === 1）或未停稳（|progress| < 0.992）
//     只画 scrim；停稳后 180ms 淡入磨砂，并在 240ms 后冻结模糊快照（0fps 空转）。
//  3. **遮罩本身支持横滑关闭**：展开侧栏后，在露出的 12–20% 模糊边条上反向拖动
//     同样跟手收起，保留甩动初速，不再只能点按关闭。
import { useEffect, useMemo, useState } from "react";
import type { ComponentRef, RefObject } from "react";
import { StyleSheet, useColorScheme, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";

import { haptic } from "../motion/haptics";
import { rubberBandProgress, SIDE_SPRING_CONFIG } from "../motion/sidePhysics";
import { useNibiTheme } from "../theme";

export function SideBackdrop({
  progress,
  dragging,
  sideMode,
  drawerW,
  panelW,
  open,
  onClose,
  onSwipeClose,
  blurTarget,
}: {
  /** 侧栏进度：+1 左抽屉 / -1 右面板 / 0 收起；遮罩按 |progress| 淡入。 */
  progress: SharedValue<number>;
  /** 任一侧栏手势拖动中（1=拖动，0=松手）：拖动期绝不挂载真模糊。 */
  dragging: SharedValue<number>;
  /** 当前展开侧（1 抽屉 / -1 面板 / 0 收起）。 */
  sideMode: SharedValue<number>;
  drawerW: SharedValue<number>;
  panelW: SharedValue<number>;
  /** 有侧栏展开时接管触摸（点击/滑关热区）。 */
  open: boolean;
  /** 点击遮罩关闭（含弹簧收起）。 */
  onClose: () => void;
  /** 遮罩横滑松手时调用：UI 线程已起速弹簧，这里只同步 JS 开关状态，避免双重动画卡顿。 */
  onSwipeClose: () => void;
  /** 主内容（BlurTargetView）引用；expo-blur 在 Android 上必须绑定才有模糊。 */
  blurTarget?: RefObject<ComponentRef<typeof View> | null>;
}) {
  const t = useNibiTheme();
  const scheme = useColorScheme();
  const dimStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(progress.value)),
  }));

  // 磨砂层状态（0 关 / 1 开）；带滞回与 dragging 守卫：手指按下或拖动期立即摘掉，
  // 停稳后才淡入，保证滑动全程 60/120fps 不掉帧。
  const frost = useSharedValue(0);
  const [frosted, setFrosted] = useState(false);
  useAnimatedReaction(
    () => ({ p: Math.abs(progress.value), drag: dragging.value }),
    ({ p, drag }) => {
      "worklet";
      if (drag === 0 && p >= 0.992 && frost.value === 0) {
        frost.value = withTiming(1, { duration: 180 });
        runOnJS(setFrosted)(true);
      } else if ((drag === 1 || p <= 0.985) && frost.value > 0) {
        frost.value = 0;
        runOnJS(setFrosted)(false);
      }
    },
  );
  const frostStyle = useAnimatedStyle(() => ({ opacity: frost.value }));
  // 磨砂层挂上后只让自动更新活 240ms（足够完成首次模糊 + 淡入），随后冻结：
  // eightbitlab 的自动更新会每帧重算整屏模糊，冻结后只合成一张缓存纹理（0fps 空转）。
  const [blurLive, setBlurLive] = useState(true);
  useEffect(() => {
    if (!frosted) return;
    setBlurLive(true);
    const timer = setTimeout(() => setBlurLive(false), 240);
    return () => clearTimeout(timer);
  }, [frosted]);

  // 遮罩手势：点按即收，横滑跟手收起（并触发一次过阈轻触感）。
  const crossed = useSharedValue(0);
  const backdropGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-12, 12])
      .failOffsetY([-18, 18])
      .onBegin(() => {
        "worklet";
        dragging.value = 1;
        crossed.value = 0;
      })
      .onUpdate((event) => {
        "worklet";
        const mode = sideMode.value;
        if (mode === 1) {
          const raw = 1 + event.translationX / drawerW.value;
          progress.value = raw > 1 ? 1 + rubberBandProgress(raw - 1) : Math.max(0, raw);
          if (progress.value < 0.65 && crossed.value === 0) {
            crossed.value = 1;
            runOnJS(haptic)("threshold");
          } else if (progress.value > 0.75 && crossed.value === 1) {
            crossed.value = 0;
          }
        } else if (mode === -1) {
          const raw = -1 + event.translationX / panelW.value;
          progress.value = raw < -1 ? -1 - rubberBandProgress(-1 - raw) : Math.min(0, raw);
          if (progress.value > -0.65 && crossed.value === 0) {
            crossed.value = 1;
            runOnJS(haptic)("threshold");
          } else if (progress.value < -0.75 && crossed.value === 1) {
            crossed.value = 0;
          }
        }
      })
      .onEnd((event) => {
        "worklet";
        const mode = sideMode.value;
        const p = progress.value;
        if (mode === 1) {
          const v = event.velocityX / drawerW.value;
          if (p < 0.65 || event.velocityX < -550) {
            progress.value = withSpring(0, { ...SIDE_SPRING_CONFIG, velocity: v });
            runOnJS(onSwipeClose)();
          } else {
            progress.value = withSpring(1, { ...SIDE_SPRING_CONFIG, velocity: v });
          }
        } else if (mode === -1) {
          const v = event.velocityX / panelW.value;
          if (p > -0.65 || event.velocityX > 550) {
            progress.value = withSpring(0, { ...SIDE_SPRING_CONFIG, velocity: v });
            runOnJS(onSwipeClose)();
          } else {
            progress.value = withSpring(-1, { ...SIDE_SPRING_CONFIG, velocity: v });
          }
        }
      })
      .onFinalize((_event, success) => {
        "worklet";
        dragging.value = 0;
        if (!success) {
          const mode = sideMode.value;
          progress.value = withSpring(mode, SIDE_SPRING_CONFIG);
        }
      });

    const tap = Gesture.Tap()
      .maxDistance(12)
      .onEnd((_event, success) => {
        "worklet";
        if (success) runOnJS(onClose)();
      });

    return Gesture.Race(pan, tap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[styles.dim, dimStyle]} pointerEvents={open ? "auto" : "none"}>
      {frosted ? (
        <Animated.View style={[StyleSheet.absoluteFill, frostStyle]} pointerEvents="none">
          <BlurView
            blurTarget={blurTarget}
            intensity={26}
            tint={scheme === "dark" ? "dark" : "light"}
            blurAutoUpdate={blurLive}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </Animated.View>
      ) : null}
      {/* 滑动期没有真模糊，scrim 撑起层次；停稳后磨砂叠上来。 */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: t.backdrop, opacity: 0.52 }]}
        pointerEvents="none"
      />
      <GestureDetector gesture={backdropGesture}>
        <View
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityRole="button"
          accessibilityLabel="关闭侧栏"
        />
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    // 侧栏自身是 20；遮罩压在正文上、垫在侧栏下。
    zIndex: 19,
  },
});
