// 设置首页：先分页，不再把所有配置堆在一页。
//
// 模型、快捷动作、插件、关于分开；后续新设置按入口加，不继续往下堆。
// 2.0：SectionCard 分组 + ui/Row 统一行；「外观」分组（主题三选写 appearance/preferences，
// useNibiTheme 消费同一份偏好，切换即时生效）。2.0.1：外观三行压成单卡分段控件；
// 行副标题只留有增量的（审查口径：标题已说明的事不再复述）。

import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  saveAppearancePreferences,
  useAppearanceMode,
  type AppearanceMode,
} from "../../appearance/preferences";
import { Icon, type IconName } from "../../components/Icon";
import { Row, ToggleRow, type RowTone } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { dismissKeyboardOnFocus } from "../../composer/leave";
import { PressableScale } from "../../motion/PressableScale";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { useSession } from "../../relay/useSession";
import { syncNotificationChannel } from "../../relay/notifications";
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
} from "../../relay/updater";
import {
  updateDevicePreferences,
  useDevicePreferences,
} from "../../settings/devicePreferences";
import { radius, space, text, useNibiTheme } from "../../theme";

/** 主题三选。分段控件里的短标签；详情不需要——图标+名称已自明。 */
const APPEARANCE_MODES: readonly {
  mode: AppearanceMode;
  icon: IconName;
  label: string;
}[] = [
  { mode: "system", icon: "monitor", label: "跟随系统" },
  { mode: "light", icon: "sun", label: "浅色" },
  { mode: "dark", icon: "moon", label: "墨夜" },
];

export default function SettingsHomeScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const { session, snapshot } = useSession();
  const appearanceMode = useAppearanceMode();
  const device = useDevicePreferences();
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  // 应用内更新（GitHub Releases + 摘要校验的全链路已在 relay/updater，这里只差接线）。
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  // 从首页带着输入框焦点进来时，键盘会弹一下又收回去；进入设置先明确收起。
  useFocusEffect(
    useCallback(() => {
      dismissKeyboardOnFocus(Keyboard.dismiss);
    }, []),
  );

  async function login(force = false) {
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountMessage(null);
    try {
      await session.login(force);
      const current = session.getSnapshot();
      if (!current.loggedIn) {
        setAccountMessage(current.error?.message ?? "登录没有完成，请重试");
      } else {
        setAccountMessage("已登录；进入插件市场会自动同步本机授权。");
      }
    } finally {
      setAccountBusy(false);
    }
  }

  function logout() {
    Alert.alert("退出 NIBI 账号？", "配对凭据会保留；本机已同步的付费授权也会保留到过期。", [
      { text: "取消", style: "cancel" },
      {
        text: "退出登录",
        style: "destructive",
        onPress: () => {
          setAccountBusy(true);
          void session
            .logout()
            .then(() => setAccountMessage("已退出登录"))
            .finally(() => setAccountBusy(false));
        },
      },
    ]);
  }

  async function checkUpdate() {
    if (updateBusy) return;
    setUpdateBusy(true);
    setUpdateMessage("正在检查…");
    try {
      const info = await checkForUpdate();
      if (!info) {
        setUpdateMessage(`已是最新版本（${version}）`);
        return;
      }
      const sizeLabel = info.size ? `，${Math.round(info.size / 1024 / 1024)} MB` : "";
      setUpdateMessage(null);
      Alert.alert(
        `发现新版本 ${info.version}`,
        `当前 ${version} → 新版 ${info.version}${sizeLabel}。下载完成后会校验摘要并调起安装。`,
        [
          { text: "取消", style: "cancel", onPress: () => setUpdateBusy(false) },
          {
            text: "下载并安装",
            onPress: () => {
              setUpdateMessage(`正在下载 ${info.version}…`);
              void downloadUpdate(info)
                .then(({ apkPath }) => {
                  setUpdateMessage(null);
                  return installUpdate(apkPath).then((launched) => {
                    if (!launched) setUpdateMessage("无法调起安装器，请手动安装");
                  });
                })
                .catch((error: unknown) => {
                  setUpdateMessage(
                    error instanceof Error ? error.message : String(error),
                  );
                })
                .finally(() => setUpdateBusy(false));
            },
          },
        ],
      );
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      {/* 页面纸面：与首页同一条竖向渐变（顶部暖光 → 纸面 → 纸底）。 */}
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="设置" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <SectionCard label="账号">
            <Row
              icon="shield"
              tone="steel"
              title={
                snapshot.loggedIn
                  ? `已登录${snapshot.displayName ? `：${snapshot.displayName}` : ""}`
                  : "登录 NIBI 账号"
              }
              detail={snapshot.loggedIn ? "切换账号" : "设备配对与付费授权"}
              onPress={() => void login(snapshot.loggedIn)}
            />
            {snapshot.loggedIn ? (
              <>
                <Divider />
                <Row
                  icon="x"
                  danger
                  title="退出登录"
                  detail="凭据与授权保留"
                  onPress={logout}
                />
              </>
            ) : null}
          </SectionCard>
        </AppearIn>

        {accountMessage ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <View style={[styles.accountMessage, { backgroundColor: th.card, borderColor: th.hairline }]}>
              {accountBusy ? <ActivityIndicator color={th.brand} /> : null}
              <Text style={[styles.accountMessageText, { color: th.inkSub }]}>{accountMessage}</Text>
            </View>
          </AppearIn>
        ) : null}

        {/* 通知（桌面「常规」组的任务通知/通知声音）：只在后台/锁屏弹，前台不影响。 */}
        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard label="通知">
            <ToggleRow
              icon="download"
              tone="steel"
              title="任务通知"
              detail="后台完成/待审批时提醒"
              value={device.taskNotifications}
              onChange={(value) => void updateDevicePreferences({ taskNotifications: value })}
            />
            <Divider />
            <ToggleRow
              icon="bell"
              tone="brand"
              title="通知声音"
              detail="提醒时播放提示音"
              value={device.notificationSound}
              onChange={(value) => {
                void updateDevicePreferences({ notificationSound: value });
                // 渠道创建后不可变：切声音要删掉重建。
                void syncNotificationChannel();
              }}
              disabled={!device.taskNotifications}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard label="交互">
            <Row
              icon="sliders"
              title="快捷动作"
              detail="输入框上方、加号菜单与长按消息"
              onPress={() => router.push("/settings/composer")}
            />
            <Divider />
            <Row
              icon="sparkles"
              title="会话显示"
              onPress={() => router.push("/settings/conversation")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(4, 32, 240)}>
          <SectionCard label="模型">
            <Row
              icon="monitor"
              tone="steel"
              title="模型服务"
              onPress={() => router.push("/settings/provider")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(5, 32, 240)}>
          <SectionCard label="项目">
            <Row
              icon="doc"
              title="项目管理"
              detail="共享工作区与项目记忆"
              onPress={() => router.push("/settings/projects")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(6, 32, 240)}>
          <SectionCard label="Agent">
            <Row
              icon="pen"
              title="个性化指令"
              detail="写给所有会话的全局指令"
              onPress={() => router.push("/settings/personalization")}
            />
            <Divider />
            <ToggleRow
              icon="clock"
              tone="plain"
              title="任务运行时保持唤醒"
              detail="回合执行期间不休屏"
              value={device.keepAwakeWhileRunning}
              onChange={(value) => void updateDevicePreferences({ keepAwakeWhileRunning: value })}
            />
            <Divider />
            <Row
              icon="sparkles"
              title="记忆"
              detail="按项目分开保存"
              onPress={() => router.push("/settings/memory")}
            />
            <Divider />
            <Row
              icon="sliders"
              tone="steel"
              title="诊断"
              detail="用量与网络状态"
              onPress={() => router.push("/settings/diagnostics")}
            />
            <Divider />
            <Row
              icon="user"
              tone="steel"
              title="子智能体"
              detail="自定义助手与工具面"
              onPress={() => router.push("/settings/subagents")}
            />
            <Divider />
            <Row
              icon="download"
              tone="steel"
              title="使用统计"
              detail="Tokens、模型与趋势"
              onPress={() => router.push("/settings/usage")}
            />
          </SectionCard>
        </AppearIn>

        {/* 外观：单卡三段分段控件——三行大卡表一个单选太重（2.0.1 审查）。
            选中段给卡底+发丝线+轻投影，所选项无需说明文案。 */}
        <AppearIn delay={staggerDelay(5, 32, 240)}>
          <SectionCard label="外观">
            <View style={[styles.segTrack, { backgroundColor: th.surfaceSoft }]}>
              {APPEARANCE_MODES.map((item) => {
                const active = appearanceMode === item.mode;
                return (
                  <PressableScale
                    key={item.mode}
                    scaleTo={0.96}
                    onPress={() =>
                      void saveAppearancePreferences({ version: 1, mode: item.mode })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`外观：${item.label}`}
                    accessibilityState={{ selected: active }}
                    style={styles.segCellOuter}
                  >
                    <View
                      style={[
                        styles.segCell,
                        {
                          backgroundColor: active ? th.card : "transparent",
                          borderColor: active ? th.hairline : "transparent",
                        },
                        ...(active ? [th.elevation.card] : []),
                      ]}
                    >
                      <Icon
                        name={item.icon}
                        size={14}
                        color={active ? th.brand : th.inkSub}
                      />
                      <Text
                        style={[styles.segLabel, { color: active ? th.ink : th.inkSub }]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
            {/* 界面动效（桌面「外观」同名项）：关掉后入场/按压动画直出终态；系统「减少动画」优先。 */}
            <Divider />
            <ToggleRow
              icon="sparkles"
              tone="plain"
              title="界面动效"
              detail="关闭后动画直出终态"
              value={device.motionEnabled}
              onChange={(value) => void updateDevicePreferences({ motionEnabled: value })}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(7, 32, 240)}>
          <SectionCard label="手机">
            <Row
              icon="phone"
              title="手机操控"
              detail="读屏点按与高级模式"
              onPress={() => router.push("/settings/phone")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(8, 32, 240)}>
          <SectionCard label="插件">
            <Row
              icon="puzzle"
              title="插件管理"
              onPress={() => router.push("/plugins")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(9, 32, 240)}>
          <SectionCard label="关于">
            <Row icon="info" tone="plain" title="NIBI-GO" detail={`版本 ${version}`} />
            <Divider />
            <Row
              icon="download"
              tone="steel"
              title="检查更新"
              detail={updateMessage ?? "从 GitHub Releases 检查新版本"}
              onPress={() => void checkUpdate()}
              right={updateBusy ? <ActivityIndicator color={th.brand} size="small" /> : undefined}
            />
          </SectionCard>
        </AppearIn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(4) },
  accountMessage: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  accountMessageText: { flex: 1, ...text("small") },
  segTrack: {
    flexDirection: "row",
    gap: space(1),
    padding: space(1),
    borderRadius: radius.control,
  },
  segCellOuter: { flex: 1 },
  segCell: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segLabel: { ...text("small"), fontWeight: "600" },
});
