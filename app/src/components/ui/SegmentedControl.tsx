// 分段选择器（外观三选 / 用量周期切换共用）：
// Reanimated 弹簧滑块在选定段之间顺滑滑移 + 切换轻触感 + 减少动效直出。
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { Icon, type IconName } from "../Icon";
import { useReducedMotion } from "../../motion/appear";
import { haptic } from "../../motion/haptics";
import { radius, space, text, useNibiTheme } from "../../theme";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

const THUMB_SPRING = {
  damping: 26,
  stiffness: 340,
  mass: 0.75,
  overshootClamping: true,
} as const;

const TRACK_PAD = 3;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const th = useNibiTheme();
  const reduced = useReducedMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const count = Math.max(1, options.length);
  const thumbWidth = trackWidth > TRACK_PAD * 2 ? (trackWidth - TRACK_PAD * 2) / count : 0;
  const thumbX = useSharedValue(selectedIndex * thumbWidth);
  const initialized = useSharedValue(0);

  useEffect(() => {
    if (thumbWidth <= 0) return;
    const target = selectedIndex * thumbWidth;
    if (reduced || initialized.value === 0) {
      thumbX.value = target;
      initialized.value = 1;
    } else {
      thumbX.value = withSpring(target, THUMB_SPRING);
    }
  }, [initialized, reduced, selectedIndex, thumbWidth, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View
      onLayout={(event) => {
        const w = event.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - trackWidth) > 0.5) setTrackWidth(w);
      }}
      style={[
        styles.track,
        { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
      ]}
    >
      {thumbWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            th.elevation.card,
            {
              width: thumbWidth,
              backgroundColor: th.card,
              borderColor: th.hairline,
            },
            thumbStyle,
          ]}
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (active) return;
              haptic("tick");
              onChange(option.value);
            }}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.item, pressed && !active ? { opacity: 0.65 } : null]}
          >
            {option.icon ? (
              <Icon name={option.icon} size={14} color={active ? th.brand : th.inkSub} />
            ) : null}
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: active ? th.ink : th.inkFaint, fontWeight: active ? "700" : "500" },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "center",
    padding: TRACK_PAD,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    position: "absolute",
    left: TRACK_PAD,
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    borderRadius: radius.control - 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flex: 1,
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(1.5),
    paddingHorizontal: space(1.5),
  },
  label: {
    ...text("small"),
  },
});
