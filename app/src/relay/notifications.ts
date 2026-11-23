// A4 通知：任务完成 / 待审批 / 提问 / 出错（PulseTracker 与本机会话共用）。
//
// 行为口径（2026-11-23 运营者确认）：
// - **前台 + 后台都响**：前台不弹系统横幅（in-app UI 已呈现），改用 NIBI 自研三音色
//   直接播放；后台/锁屏走系统通知，声音由 Android 渠道绑定同一份 raw 音效。
// - 三声归位（与桌面客户端 D21 一致）：完成 = 短促鸟鸣；审批/提问 = 双音风铃；
//   出错 = 轻羽落。「任务通知/通知声音」开关读设备偏好：关通知直接不发；关声音
//   删掉渠道重建静音渠道（Android 渠道创建后不可改，切声音要重建）。
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { playPhoneNotificationSound } from "nibi-phone";

import {
  getCurrentLocale,
  pickText,
  subscribeLanguagePreferences,
  type Locale,
} from "../i18n";
import { getCachedDevicePreferences } from "../settings/devicePreferences";

export type AgentAlertKind = "complete" | "approval" | "error";

interface ChannelSpec {
  /** 有声渠道 id。 */
  id: string;
  /** 静音渠道 id（声音开关关闭时使用，避免 Android「删除后重建同 ID 会恢复旧设置」）。 */
  silentId: string;
  /** res/raw 内的文件名（SoundResolver 按去扩展名的资源名解析）。 */
  sound: string;
  zhName: string;
  enName: string;
  zhDescription: string;
  enDescription: string;
}

const CHANNELS: Record<AgentAlertKind, ChannelSpec> = {
  complete: {
    id: "nibi-agent-complete",
    silentId: "nibi-agent-complete-silent",
    sound: "nibi_task_complete.mp3",
    zhName: "任务完成",
    enName: "Task completed",
    zhDescription: "AGENT 完成一轮工作时提醒",
    enDescription: "Alerts when the agent finishes a turn",
  },
  approval: {
    id: "nibi-agent-approval",
    silentId: "nibi-agent-approval-silent",
    sound: "nibi_task_approval.mp3",
    zhName: "待审批与提问",
    enName: "Approvals & questions",
    zhDescription: "AGENT 等待你批准或回答时提醒",
    enDescription: "Alerts when the agent needs your approval or answer",
  },
  error: {
    id: "nibi-agent-error",
    silentId: "nibi-agent-error-silent",
    sound: "nibi_task_error.mp3",
    zhName: "任务出错",
    enName: "Task failed",
    zhDescription: "回合失败或中断时提醒",
    enDescription: "Alerts when a turn fails or is interrupted",
  },
};

/** 通知应投递到的渠道：声音开关决定有声/静音两条同源渠道。 */
function channelIdFor(kind: AgentAlertKind, sound: boolean): string {
  return sound ? CHANNELS[kind].id : CHANNELS[kind].silentId;
}

/** 0.1.7 的单渠道：升级后删除，避免同一提醒出现两份渠道入口。 */
const LEGACY_CHANNEL_ID = "nibi-agent";

// 前台抑制：handler 返回 false（显示交给 in-app UI，声音由 notifyAgent 直接播放）。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let setupPromise: Promise<boolean> | null = null;
/** 当前生效的提示音档位（有声/静音）；变化时切换到另一组渠道，避免原地改声。 */
let channelSound: boolean | null = null;
let channelLocale: Locale | null = null;
let languageSubscribed = false;

/** 初始化渠道 + 权限（幂等；登录/启动时调用一次）。 */
export function ensureNotificationSetup(): Promise<boolean> {
  if (!languageSubscribed && Platform.OS === "android") {
    languageSubscribed = true;
    subscribeLanguagePreferences(() => {
      void syncNotificationChannel().catch(() => {});
    });
  }
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

/** 按当前偏好（提示音开关）维护 Android 渠道；状态没变就跳过。 */
export async function syncNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  const sound = getCachedDevicePreferences().notificationSound;
  const locale = getCurrentLocale();
  if (channelSound === sound && channelLocale === locale) return;
  for (const spec of Object.values(CHANNELS)) {
    // Android 渠道创建后声音不可改，且删除同 ID 后重建会恢复旧设置（系统记住被删渠道）。
    // 因此声音开关切换用「有声 / 静音」两条同源渠道 id，而不是原地改声。
    const activeId = sound ? spec.id : spec.silentId;
    const retiredId = sound ? spec.silentId : spec.id;
    await Notifications.setNotificationChannelAsync(activeId, {
      name: pickText(spec.zhName, spec.enName, locale),
      description: pickText(spec.zhDescription, spec.enDescription, locale),
      importance: Notifications.AndroidImportance.DEFAULT,
      // 静音渠道绑定一段 60ms 静音 wav：显式 setSound 才算真静音；
      // 传空名会被 expo-notifications 记成 “Custom sound not found” 告警。
      sound: sound ? spec.sound : "nibi_silence.wav",
    });
    try {
      // 另一档渠道删掉，避免系统通知设置里出现两个同名入口。
      await Notifications.deleteNotificationChannelAsync(retiredId);
    } catch {
      // 渠道不存在是正常情况。
    }
  }
  try {
    await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID);
  } catch {
    // 老渠道不存在是正常情况。
  }
  channelSound = sound;
  channelLocale = locale;
}

export interface AgentNotification {
  /** 决定音色与渠道；缺省为完成音。 */
  kind?: AgentAlertKind;
  title: string;
  body: string;
  /** 点击后打开的 expo-router 路径（如 /chat）。 */
  route?: string;
}

/** 前台直接播放 NIBI 提示音（不经过系统通知，不受 handler 静音影响）。 */
export function playAgentSound(kind: AgentAlertKind = "complete"): boolean {
  return playPhoneNotificationSound(kind);
}

/** 设置页的三种试听（完成/审批/出错）；返回是否真的播了（原生模块缺失时 false）。 */
export function previewAgentSound(kind: AgentAlertKind): boolean {
  return playAgentSound(kind);
}

export async function notifyAgent(params: AgentNotification): Promise<void> {
  // 「任务通知」关掉就不发（设置页可改；前台本来就不弹，见 handler）。
  if (!getCachedDevicePreferences().taskNotifications) return;
  const kind = params.kind ?? "complete";
  // 前台：系统通知会被 handler 抑制，改用 in-app 音效（用户要求前台也能听到）。
  // 只把真正的 background 当后台：Android 上 currentState 偶尔是 unknown/inactive，
  // 用 === "active" 判断会让完成提示既不出声也不弹通知。
  if (AppState.currentState !== "background") {
    if (getCachedDevicePreferences().notificationSound) playAgentSound(kind);
    return;
  }
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        ...(params.route ? { data: { route: params.route } } : {}),
      },
      // 渠道声音由系统播放；声音开关决定投递到有声/静音哪一条渠道。
      trigger: {
        channelId: channelIdFor(kind, getCachedDevicePreferences().notificationSound),
      },
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
