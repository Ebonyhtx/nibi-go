import { Stack } from 'expo-router';

// 根导航（A0 骨架）：首屏 = 双形态切换入口（D2）。
// WORK/GO 各自的屏在 A1（配对/连接）/ C1（GO 形态 UI）展开。
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
