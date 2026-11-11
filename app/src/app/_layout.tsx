import { Stack, router } from "expo-router";
import { useEffect } from "react";

import { ensureNotificationSetup, subscribeNotificationTap } from "../relay/notifications";

// 根导航（A0 骨架）：首屏 = 双形态切换入口（D2）。
// A4：应用启动即初始化通知渠道/权限与点击路由（不依赖某个屏先被访问）。
export default function RootLayout() {
  useEffect(() => {
    void ensureNotificationSetup();
    return subscribeNotificationTap((route) => router.push(route as never));
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
