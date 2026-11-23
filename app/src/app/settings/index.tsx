// 设置首页：分页入口 + 外观主题 + 中英文语言实时切换 + 通知/悬浮小鸟偏好 + 平板居中响应式布局。

import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
import { Row, ToggleRow } from "../../components/ui/Row";
import { PillButton } from "../../components/ui/PillButton";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { SegmentedControl, type SegmentedOption } from "../../components/ui/SegmentedControl";
import { dismissKeyboardOnFocus } from "../../composer/leave";
import { setLanguageMode, useI18n, type LanguageMode } from "../../i18n";
import { useResponsiveBodyStyle } from "../../layout/responsive";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { useSession } from "../../relay/useSession";
import { previewAgentSound, syncNotificationChannel } from "../../relay/notifications";
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

export default function SettingsHomeScreen() {
  const th = useNibiTheme();
  const { mode: languageMode, pick } = useI18n();
  const insets = useSafeAreaInsets();
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(4),
  });
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const { session, snapshot } = useSession();
  const appearanceMode = useAppearanceMode();
  const device = useDevicePreferences();
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const appearanceOptions = useMemo<readonly SegmentedOption<AppearanceMode>[]>(
    () => [
      { value: "system", icon: "monitor", label: pick("跟随系统", "System") },
      { value: "light", icon: "sun", label: pick("浅色", "Light") },
      { value: "dark", icon: "moon", label: pick("墨夜", "Dark") },
    ],
    [pick],
  );

  const languageOptions = useMemo<readonly SegmentedOption<LanguageMode>[]>(
    () => [
      { value: "system", icon: "globe", label: pick("跟随系统", "System") },
      { value: "zh-CN", label: "简体中文" },
      { value: "en-US", label: "English" },
    ],
    [pick],
  );

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
        setAccountMessage(
          current.error?.message ?? pick("登录没有完成，请重试", "Sign-in did not complete. Please retry."),
        );
      } else {
        setAccountMessage(
          pick(
            "已登录；进入插件市场会自动同步本机授权。",
            "Signed in. Device licenses sync automatically in Plugin Market.",
          ),
        );
      }
    } finally {
      setAccountBusy(false);
    }
  }

  function logout() {
    Alert.alert(
      pick("退出 NIBI 账号？", "Sign out of NIBI account?"),
      pick("配对凭据与本机已同步的设备授权会保留。", "Paired devices and local synced licenses will be kept."),
      [
        { text: pick("取消", "Cancel"), style: "cancel" },
        {
          text: pick("退出登录", "Sign out"),
          style: "destructive",
          onPress: () => {
            setAccountBusy(true);
            void session
              .logout()
              .then(() => setAccountMessage(pick("已退出登录", "Signed out")))
              .finally(() => setAccountBusy(false));
          },
        },
      ],
    );
  }

  async function checkUpdate() {
    if (updateBusy) return;
    setUpdateBusy(true);
    setUpdateMessage(pick("正在检查…", "Checking…"));
    let handedToDialog = false;
    try {
      const info = await checkForUpdate();
      if (!info) {
        setUpdateMessage(pick(`已是最新版本（${version}）`, `Up to date (${version})`));
        return;
      }
      const sizeLabel = info.size
        ? pick(`，${Math.round(info.size / 1024 / 1024)} MB`, `, ${Math.round(info.size / 1024 / 1024)} MB`)
        : "";
      setUpdateMessage(null);
      handedToDialog = true;
      Alert.alert(
        pick(`发现新版本 ${info.version}`, `Update available: ${info.version}`),
        pick(
          `当前 ${version} → 新版 ${info.version}${sizeLabel}。下载完成后会校验摘要并调起安装。`,
          `Current ${version} → New ${info.version}${sizeLabel}. Checksum will be verified before installing.`,
        ),
        [
          { text: pick("取消", "Cancel"), style: "cancel", onPress: () => setUpdateBusy(false) },
          {
            text: pick("下载并安装", "Download & install"),
            onPress: () => {
              setUpdateMessage(pick(`正在下载 ${info.version}…`, `Downloading ${info.version}…`));
              void downloadUpdate(info)
                .then(({ apkPath }) => {
                  setUpdateMessage(null);
                  return installUpdate(apkPath).then((launched) => {
                    if (!launched) {
                      setUpdateMessage(
                        pick("无法调起安装器，请手动安装", "Unable to launch installer. Install manually."),
                      );
                    }
                  });
                })
                .catch((error: unknown) => {
                  setUpdateMessage(error instanceof Error ? error.message : String(error));
                })
                .finally(() => setUpdateBusy(false));
            },
          },
        ],
        { cancelable: true, onDismiss: () => setUpdateBusy(false) },
      );
    } catch (error: unknown) {
      setUpdateMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!handedToDialog) setUpdateBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title={pick("设置", "Settings")} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={bodyStyle}>
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <SectionCard label={pick("账号", "Account")}>
            <Row
              icon="shield"
              tone="steel"
              title={
                snapshot.loggedIn
                  ? pick(
                      `已登录${snapshot.displayName ? `：${snapshot.displayName}` : ""}`,
                      `Signed in${snapshot.displayName ? `: ${snapshot.displayName}` : ""}`,
                    )
                  : pick("登录 NIBI 账号", "Sign in to NIBI")
              }
              detail={
                snapshot.loggedIn
                  ? pick("切换账号", "Switch account")
                  : pick("远控设备配对与云端同步", "Remote pairing & cloud sync")
              }
              onPress={() => void login(snapshot.loggedIn)}
            />
            {snapshot.loggedIn ? (
              <>
                <Divider />
                <Row
                  icon="x"
                  danger
                  title={pick("退出登录", "Sign out")}
                  detail={pick("凭据与授权保留", "Credentials & licenses kept")}
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

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard label={pick("通知与悬浮小鸟", "Notifications & Floating Pet")}>
            <ToggleRow
              icon="download"
              tone="steel"
              title={pick("任务通知", "Task notifications")}
              detail={pick("后台完成或待审批时提醒", "Notify on completion or approval needed")}
              value={device.taskNotifications}
              onChange={(value) => void updateDevicePreferences({ taskNotifications: value })}
            />
            <Divider />
            <ToggleRow
              icon="bell"
              tone="brand"
              title={pick("通知声音", "Notification sound")}
              detail={pick(
                "提醒时播放 NIBI 提示音（完成/审批/出错三种音色）",
                "Play NIBI alert sounds (completion, approval, failure)",
              )}
              value={device.notificationSound}
              onChange={(value) => {
                void updateDevicePreferences({ notificationSound: value });
                void syncNotificationChannel();
                // 打开时立刻试听一声完成鸟鸣：让用户确认系统通知流没有静音。
                if (value) previewAgentSound("complete");
              }}
              disabled={!device.taskNotifications}
            />
            {device.notificationSound && device.taskNotifications ? (
              <View style={styles.soundPreview}>
                {(
                  [
                    ["complete", pick("试听·完成", "Test: done")],
                    ["approval", pick("试听·审批", "Test: approval")],
                    ["error", pick("试听·出错", "Test: failure")],
                  ] as const
                ).map(([kind, label]) => (
                  <PillButton
                    key={kind}
                    label={label}
                    variant="secondary"
                    buttonSize="sm"
                    onPress={() => previewAgentSound(kind)}
                  />
                ))}
              </View>
            ) : null}
            <Divider />
            <ToggleRow
              icon="sparkles"
              tone="brand"
              title={pick("App 外悬浮小鸟", "Floating NIBI Bird")}
              detail={pick("切出应用或手机操控时小鸟随行，点按切回", "NIBI Bird floats over other apps; tap to return")}
              value={device.statusBubble}
              onChange={(value) => void updateDevicePreferences({ statusBubble: value })}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard label={pick("交互", "Interaction")}>
            <Row
              icon="sliders"
              title={pick("快捷动作", "Quick actions")}
              detail={pick("输入框上方、加号菜单与长按消息", "Composer bar, + menu & message long-press")}
              onPress={() => router.push("/settings/composer")}
            />
            <Divider />
            <Row
              icon="sparkles"
              title={pick("会话显示", "Conversation display")}
              onPress={() => router.push("/settings/conversation")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(4, 32, 240)}>
          <SectionCard label={pick("模型", "Models")}>
            <Row
              icon="monitor"
              tone="steel"
              title={pick("模型服务", "Model providers")}
              onPress={() => router.push("/settings/provider")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(5, 32, 240)}>
          <SectionCard label={pick("项目", "Projects")}>
            <Row
              icon="doc"
              title={pick("项目管理", "Manage projects")}
              detail={pick("共享工作区与项目记忆", "Shared workspaces & project memory")}
              onPress={() => router.push("/settings/projects")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(6, 32, 240)}>
          <SectionCard label="Agent">
            <Row
              icon="pen"
              title={pick("个性化指令", "Custom instructions")}
              detail={pick("写给所有会话的全局指令", "Global rules for all sessions (AGENTS.md)")}
              onPress={() => router.push("/settings/personalization")}
            />
            <Divider />
            <ToggleRow
              icon="clock"
              tone="plain"
              title={pick("任务运行时保持唤醒", "Keep screen awake while running")}
              detail={pick("回合执行期间不休屏", "Prevent sleep during active turns")}
              value={device.keepAwakeWhileRunning}
              onChange={(value) => void updateDevicePreferences({ keepAwakeWhileRunning: value })}
            />
            <Divider />
            <Row
              icon="sparkles"
              title={pick("记忆", "Memory")}
              detail={pick("按项目分开保存", "Stored per project")}
              onPress={() => router.push("/settings/memory")}
            />
            <Divider />
            <Row
              icon="info"
              tone="steel"
              title={pick("诊断", "Diagnostics")}
              detail={pick("用量与网络状态", "Cache hit rate & network status")}
              onPress={() => router.push("/settings/diagnostics")}
            />
            <Divider />
            <Row
              icon="user"
              tone="steel"
              title={pick("子智能体", "Subagents")}
              detail={pick("自定义助手与工具面", "Custom personas & tool scopes")}
              onPress={() => router.push("/settings/subagents")}
            />
            <Divider />
            <Row
              icon="download"
              tone="steel"
              title={pick("使用统计", "Usage stats")}
              detail={pick("Tokens、模型与趋势", "Tokens, models & trends")}
              onPress={() => router.push("/settings/usage")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(7, 32, 240)}>
          <SectionCard label={pick("语言 / Language", "Language / 语言")}>
            <View style={styles.segWrap}>
              <SegmentedControl
                options={languageOptions}
                value={languageMode}
                onChange={(mode) => void setLanguageMode(mode)}
              />
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(7, 32, 240)}>
          <SectionCard label={pick("外观", "Appearance")}>
            <View style={styles.segWrap}>
              <SegmentedControl
                options={appearanceOptions}
                value={appearanceMode}
                onChange={(mode) => void saveAppearancePreferences({ version: 1, mode })}
              />
            </View>
            <Divider />
            <ToggleRow
              icon="sparkles"
              tone="plain"
              title={pick("界面动效", "Animations")}
              detail={pick("关闭后动画直出终态", "Disable transitions for instant rendering")}
              value={device.motionEnabled}
              onChange={(value) => void updateDevicePreferences({ motionEnabled: value })}
            />
            <Divider />
            <ToggleRow
              icon="phone"
              tone="plain"
              title={pick("触感反馈", "Haptics")}
              detail={pick("按键、开关与侧栏过阈震动", "Tactile feedback on buttons & gestures")}
              value={device.hapticsEnabled}
              onChange={(value) => void updateDevicePreferences({ hapticsEnabled: value })}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(8, 32, 240)}>
          <SectionCard label={pick("手机", "Phone")}>
            <Row
              icon="phone"
              title={pick("手机操控", "Phone control")}
              detail={pick("读屏点按与高级模式", "Accessibility tap & advanced shell mode")}
              onPress={() => router.push("/settings/phone")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(8, 32, 240)}>
          <SectionCard label={pick("插件", "Plugins")}>
            <Row
              icon="plug"
              title={pick("插件管理", "Manage plugins")}
              onPress={() => router.push("/plugins")}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(9, 32, 240)}>
          <SectionCard label={pick("关于", "About")}>
            <Row
              icon="info"
              tone="plain"
              title="NIBI-GO"
              detail={pick(`版本 ${version}`, `Version ${version}`)}
            />
            <Divider />
            <Row
              icon="download"
              tone="steel"
              title={pick("检查更新", "Check for updates")}
              detail={updateMessage ?? pick("从 GitHub Releases 检查新版本", "Check GitHub Releases for updates")}
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
  // 三音色试听：只在声音开启时出现在开关下面，与行内文字共用左内边距。
  soundPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingBottom: space(2.5),
  },
  accountMessage: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  accountMessageText: { flex: 1, ...text("small") },
  segWrap: { padding: space(2) },
});
