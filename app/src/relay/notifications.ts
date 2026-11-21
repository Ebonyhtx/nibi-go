// A4 通知：任务完成 / 待审批 / 提问（PulseTracker 下游）。
// 原则：前台不弹系统通知（in-app UI 已呈现）；后台/锁屏才弹，点击直达 chat 屏。
// 「任务通知/通知声音」开关读设备偏好：关通知直接不发；关声音删掉渠道重建
//（Android 渠道创建后不可改，切声音要重建）。
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { getCachedDevicePreferences } from "../settings/devicePreferences";

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
/** 渠道当前生效的提示音状态（Android 渠道创建后不可变，改声音必须删掉重建）。 */
let channelSound: boolean | null = null;

/** 初始化渠道 + 权限（幂等；登录/启动时调用一次）。 */
export function ensureNotificationSetup(): Promise<boolean> {
  setupPromise ??= (async () => {
    try {
      if (Platform.OS === "android") {
        await syncNotificationChannel();
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

/** 按当前偏好（提示音开关）建/重建 Android 渠道；状态没变就跳过。 */
export async function syncNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  const sound = getCachedDevicePreferences().notificationSound;
  if (channelSound === sound) return;
  if (channelSound !== null) {
    try {
      await Notifications.deleteNotificationChannelAsync(CHANNEL_ID);
    } catch {
      // 删不掉（渠道不存在等）按重建处理
    }
  }
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "AGENT 提醒",
    description: "任务完成、待审批与提问提醒",
    importance: Notifications.AndroidImportance.DEFAULT,
    ...(sound ? { sound: "default" } : {}),
  });
  channelSound = sound;
}

export interface AgentNotification {
  title: string;
  body: string;
  /** 点击后打开的 expo-router 路径（如 /chat）。 */
  route?: string;
}

export async function notifyAgent(params: AgentNotification): Promise<void> {
  // 「任务通知」关掉就不发（设置页可改；前台本来就不弹，见 handler）。
  if (!getCachedDevicePreferences().taskNotifications) return;
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
