// 左右侧栏共用的一层「玻璃遮罩」：全屏模糊 + 压暗 + 关闭热区。
//
// 两个关键决定：
//  1. 只留一张模糊层。GoDrawer / WorkspacePanel 原来各自常驻一个全屏 BlurView，
//     开合时两张全屏模糊各算一遍，白白多一张屏的合成。
//  2. **滑动过程中不跑真模糊**。真机实测（1240×2772）：全屏 BlurView 每帧要
//     6–10ms，侧栏滑动的 50th 帧从 13ms 掉到 19–20ms，肉眼就是「不够丝滑」。
//     所以拖动/回弹期间只用 scrim；停稳（|progress| ≥ 0.995）后把磨砂层用
//     180ms 淡进来，一旦开始往回拖立即摘掉。视觉上是「窗玻璃落定后起雾」，
//     滑动全程 60fps。
import { useEffect, useState } from "react";
import type { ComponentRef, RefObject } from "react";
import { Pressable, StyleSheet, useColorScheme, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";

import { useNibiTheme } from "../theme";

export function SideBackdrop({
  progress,
  open,
  onClose,
  blurTarget,
}: {
  /** 侧栏进度：+1 左抽屉 / -1 右面板 / 0 收起；遮罩按 |progress| 淡入。 */
  progress: SharedValue<number>;
  /** 有侧栏展开时接管触摸（关闭热区）。拖动过程中不抢手势。 */
  open: boolean;
  onClose: () => void;
  /** 主内容（BlurTargetView）引用；expo-blur 在 Android 上必须绑定才有模糊。 */
  blurTarget?: RefObject<ComponentRef<typeof View> | null>;
}) {
  const t = useNibiTheme();
  const scheme = useColorScheme();
  const dimStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(progress.value)),
  }));

  // 磨砂层状态（0 关 / 1 开）；带滞回：进 0.995、退 0.985，避免临界抖动。
  const frost = useSharedValue(0);
  const [frosted, setFrosted] = useState(false);
  useAnimatedReaction(
    () => Math.abs(progress.value),
    (p) => {
      "worklet";
      if (p >= 0.995 && frost.value === 0) {
        frost.value = withTiming(1, { duration: 180 });
        runOnJS(setFrosted)(true);
      } else if (p <= 0.985 && frost.value > 0) {
        frost.value = 0;
        runOnJS(setFrosted)(false);
      }
    },
  );
  const frostStyle = useAnimatedStyle(() => ({ opacity: frost.value }));
  // 磨砂层挂上后只让自动更新活 320ms（足够完成首次模糊 + 淡入），随后冻结：
  // eightbitlab 的自动更新会**每帧**重算整屏模糊（实测常开时 20ms/帧、60fps
  // 空转），冻结后只合成一张缓存纹理，滚动/点按都不再为背景付钱。
  const [blurLive, setBlurLive] = useState(true);
  useEffect(() => {
    if (!frosted) return;
    setBlurLive(true);
    const timer = setTimeout(() => setBlurLive(false), 240);
    return () => clearTimeout(timer);
  }, [frosted]);

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
      {/* 滑动期没有真模糊，scrim 要能独立撑起层次：0.55 大约压掉 12% 的底，
          停稳后磨砂再叠上来。 */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: t.backdrop, opacity: 0.55 }]}
        pointerEvents="none"
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="关闭侧栏"
      />
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
