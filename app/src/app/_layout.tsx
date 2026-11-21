import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { loadAppearancePreferences } from "../appearance/preferences";
import { loadDevicePreferences } from "../settings/devicePreferences";
import { useNibiScheme } from "../theme";
import { ensureNotificationSetup, subscribeNotificationTap } from "../relay/notifications";

// 根导航（A0 骨架）：首屏 = GO 主体（D2 修订）；WORK 是抽屉里的目的地。
// A4：应用启动即初始化通知渠道/权限与点击路由（不依赖某个屏先被访问）。
// 2.0：先读外观偏好再挂载页面——否则深色用户会先看到一帧浅色再被切过去。
// 读盘失败回落「跟随系统」，不阻塞界面（finally 里放行）。
export default function RootLayout() {
  const [appearanceReady, setAppearanceReady] = useState(false);
  const scheme = useNibiScheme();

  useEffect(() => {
    void ensureNotificationSetup();
    const unsubscribe = subscribeNotificationTap((route) => router.push(route as never));
    let alive = true;
    // 外观 + 设备偏好（通知/唤醒/动效）都先读再挂载：让持久化值直接进首帧。
    void Promise.all([loadAppearancePreferences(), loadDevicePreferences()]).finally(() => {
      if (alive) setAppearanceReady(true);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (!appearanceReady) return null;

  return (
    <SafeAreaProvider>
      {/* 状态栏图标颜色跟着应用主题走：墨夜用浅色图标，浅色主题用深色图标。 */}
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
