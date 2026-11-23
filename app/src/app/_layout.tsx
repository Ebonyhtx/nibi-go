import { Stack, router } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { loadAppearancePreferences } from "../appearance/preferences";
import { loadLanguagePreferences } from "../i18n";
import { loadProjects } from "../kernel/projects";
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
    const unsubscribe = subscribeNotificationTap((route) => router.push(route as never));
    let alive = true;
    // 外观 + 语言 + 设备偏好（通知/唤醒/动效）+ 项目列表都先读再挂载：让持久化值直接进首帧。
    // 项目列表此前没有启动加载（只有写入口），重启后内存缓存是空的，新装后新建的项目
    // 会在下一次写入时被空列表覆盖——必须在任何页面读取 useProjects 之前 load 一次。
    void Promise.all([
      loadAppearancePreferences(),
      loadLanguagePreferences(),
      loadDevicePreferences(),
      loadProjects(),
    ]).finally(() => {
      void ensureNotificationSetup();
      if (alive) setAppearanceReady(true);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (!appearanceReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider
          statusBarTranslucent
          navigationBarTranslucent
          preserveEdgeToEdge
        >
          {/* 状态栏图标颜色跟着应用主题走：墨夜用浅色图标，浅色主题用深色图标。 */}
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          {/* 转场语言统一：所有二级页都用同一套右侧滑入，不再依赖 OEM 默认
              （有的机型是淡入、有的是上滑，混在一起就没有一致的「高级感」）。 */}
          <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", gestureEnabled: true }} />
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
