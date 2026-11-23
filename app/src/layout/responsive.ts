// 二级页面响应式容器样式钩子（保持 adaptive.ts 纯函数无 RN 依赖，供市场/插件/设置/远控页复用）。
// 手机竖屏与原版完全一致；手机横屏自动避让左右刘海与导航条；平板宽屏居中限宽（820dp）。

import { useMemo } from "react";
import { type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { METRICS } from "./adaptive";
import { space } from "../theme";

export function useResponsiveBodyStyle(extra?: ViewStyle): ViewStyle {
  const insets = useSafeAreaInsets();
  return useMemo<ViewStyle>(
    () => ({
      width: "100%",
      maxWidth: METRICS.secondaryMax,
      alignSelf: "center",
      paddingLeft: insets.left + space(4),
      paddingRight: insets.right + space(4),
      ...extra,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insets.left, insets.right, extra?.paddingTop, extra?.paddingBottom, extra?.gap],
  );
}
