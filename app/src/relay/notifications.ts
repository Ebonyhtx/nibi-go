// A4 通知：任务完成 / 待审批 / 提问（PulseTracker 下游）。
// 原则：前台不弹系统通知（in-app UI 已呈现）；后台/锁屏才弹，点击直达 chat 屏。
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const CHANNEL_ID = "nibi-agent";

// 前台抑制：handler 返回 false（显示交给 in-app UI）。后台由系统按渠道展示。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let setupPromise: Promise<boolean> | null = null;

/** 初始化渠道 + 权限（幂等；登录/启动时调用一次）。 */
export function ensureNotificationSetup(): Promise<boolean> {
  setupPromise ??= (async () => {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: "AGENT 提醒",
          description: "任务完成、待审批与提问提醒",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const settings = await Notifications.getPermissionsAsync();
      if (settings.granted) return true;
      const result = await Notifications.requestPermissionsAsync();
      return result.granted;
    } catch {
      // 权限被拒/平台不支持：静默（通知是增强能力，不影响连接）
      return false;
    }
  })();
  return setupPromise;
}

export interface AgentNotification {
  title: string;
  body: string;
  /** 点击后打开的 expo-router 路径（如 /chat）。 */
  route?: string;
}

export async function notifyAgent(params: AgentNotification): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        ...(params.route ? { data: { route: params.route } } : {}),
      },
      trigger: null,
    });
  } catch {
    // 通知失败不影响业务
  }
}

/** 通知点击 → 路由（返回取消订阅函数）。 */
export function subscribeNotificationTap(handler: (route: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = response.notification.request.content.data?.route;
    if (typeof route === "string") handler(route);
  });
  return () => subscription.remove();
}
