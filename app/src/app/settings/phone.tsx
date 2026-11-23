// 手机操控设置：无障碍（开关 1）与 Shizuku 高级模式（开关 2）。
//
// 只做状态、授权引导与开关；真正的读屏/手势/shell 在 nibi-phone 原生模块里。
// 开关变化会让当前会话在空闲时自动 resume 一次（见 useKernelConversation）。
// 2.0：ScreenHeader + SectionCard；开关行统一 ui/ToggleRow，状态徽标/能力 chip
// 走 soft 底 + 对应色文字（ok/amber/muted），动作按钮统一 PillButton。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type PhoneStatus } from "@nibi-go/phone-tools";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PillButton } from "../../components/ui/PillButton";
import { ToggleRow } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { pickText, useI18n } from "../../i18n";
import { useResponsiveBodyStyle } from "../../layout/responsive";
import {
  canShowPhoneApproval,
  installPhoneShellManager,
  openPhoneAccessibilitySettings,
  openPhoneAppSettings,
  openPhoneInstallPermissionSettings,
  openPhoneOverlaySettings,
  openPhoneShellManager,
  phoneStatus,
  requestPhoneShellPermission,
  setPhoneA11yEnabled,
  setPhoneShellEnabled,
} from "../../phone/status";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { radius, space, text, useNibiTheme } from "../../theme";

type StatusTone = "ok" | "warn" | "muted";

interface StatusView {
  value: string;
  tone: StatusTone;
}

function a11yStatusView(status: PhoneStatus): StatusView {
  if (!status.available) return { value: pickText("不可用", "Unavailable"), tone: "muted" };
  if (status.a11y.connected) return { value: pickText("已连接", "Connected"), tone: "ok" };
  if (status.a11y.enabled) {
    return { value: pickText("已开启未连接", "Enabled · not connected"), tone: "warn" };
  }
  return { value: pickText("未开启", "Off"), tone: "muted" };
}

function shellStatusView(status: PhoneStatus): StatusView {
  if (!status.available) return { value: pickText("不可用", "Unavailable"), tone: "muted" };
  if (!status.shell.installed) {
    return { value: pickText("未安装 Shizuku", "Shizuku not installed"), tone: "muted" };
  }
  if (!status.shell.running) return { value: pickText("未运行", "Not running"), tone: "warn" };
  if (status.shell.permission !== "granted") {
    return { value: pickText("未授权", "Not authorized"), tone: "warn" };
  }
  return { value: pickText("已连接", "Connected"), tone: "ok" };
}

interface CapabilityChip {
  key: string;
  label: string;
  active: boolean;
}

function capabilityChips(status: PhoneStatus): CapabilityChip[] {
  if (!status.available) {
    return [{ key: "unavailable", label: pickText("不可用", "Unavailable"), active: false }];
  }
  const chips: CapabilityChip[] = [];
  if (status.a11y.connected) {
    chips.push({ key: "read", label: pickText("读屏", "Screen read"), active: true });
    chips.push({ key: "input", label: pickText("点按/输入", "Tap & type"), active: true });
    if (status.a11y.canScreenshot) {
      chips.push({ key: "shot", label: pickText("截屏", "Screenshot"), active: true });
    }
  }
  if (status.shell.enabled && status.shell.permission === "granted" && status.shell.running) {
    chips.push({ key: "shell", label: "shell", active: true });
  }
  return chips.length > 0
    ? chips
    : [{ key: "off", label: pickText("未开启", "Off"), active: false }];
}

function StatusRow({ title, view }: { title: string; view: StatusView }) {
  const t = useNibiTheme();
  const palette =
    view.tone === "ok"
      ? { backgroundColor: t.okSoft, color: t.ok }
      : view.tone === "warn"
        ? { backgroundColor: t.amberSoft, color: t.amber }
        : { backgroundColor: t.surfaceSoft, color: t.inkFaint };
  return (
    <View style={styles.statusRow}>
      <Text style={[styles.statusLabel, { color: t.inkFaint }]}>{title}</Text>
      <View style={[styles.statusBadge, { backgroundColor: palette.backgroundColor }]}>
        <Text style={[styles.statusValue, { color: palette.color }]}>{view.value}</Text>
      </View>
    </View>
  );
}

/** 动作按钮统一 PillButton；disabled 态由 primitive 处理。 */
function ActionButton({
  label,
  onPress,
  disabled,
  variant = "secondary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <PillButton label={label} variant={variant} buttonSize="sm" onPress={onPress} disabled={disabled} />
  );
}

export default function PhoneSettingsScreen() {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(4),
  });
  const [status, setStatus] = useState<PhoneStatus>(() => phoneStatus());
  const [confirmShell, setConfirmShell] = useState(false);
  const [installing, setInstalling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setStatus(phoneStatus());
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (pollStopRef.current !== null) {
      clearTimeout(pollStopRef.current);
      pollStopRef.current = null;
    }
  }, []);

  // 从系统无障碍设置或 Shizuku 回来后刷新；离开页面就停掉轮询。
  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => stopPolling();
    }, [refresh, stopPolling]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => stopPolling, [stopPolling]);

  const toggleA11y = useCallback((enabled: boolean) => {
    setStatus(setPhoneA11yEnabled(enabled));
    // 打开 App 内开关后直接引导到系统无障碍页，少一步找入口。
    if (enabled) openPhoneAccessibilitySettings();
  }, []);

  const toggleShell = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        setConfirmShell(true);
        return;
      }
      stopPolling();
      setStatus(setPhoneShellEnabled(false));
    },
    [stopPolling],
  );

  const confirmShellEnabled = useCallback(() => {
    setConfirmShell(false);
    setStatus(setPhoneShellEnabled(true));
  }, []);

  const startPolling = useCallback(
    (durationMs = 20_000) => {
      stopPolling();
      pollRef.current = setInterval(refresh, 1000);
      pollStopRef.current = setTimeout(stopPolling, durationMs);
    },
    [refresh, stopPolling],
  );

  const requestShellPermission = useCallback(() => {
    const requested = requestPhoneShellPermission();
    refresh();
    if (!requested) {
      Alert.alert(
        pickText("Shizuku 未运行", "Shizuku is not running"),
        pickText(
          "先在 Shizuku 应用里启动服务（可用无线调试配对），再回到本页请求授权。",
          "Start the service in the Shizuku app (pair via Wireless debugging), then return here to request access.",
        ),
        [
          { text: pickText("知道了", "OK"), style: "cancel" },
          {
            text: pickText("打开 Shizuku", "Open Shizuku"),
            onPress: () => openPhoneShellManager(),
          },
        ],
      );
      return;
    }
    // Shizuku 的授权结果是异步的：每秒看一次状态，约 20 秒后停止。
    startPolling();
  }, [refresh, startPolling]);

  /**
   * 随包内置安装包的一键安装。未安装时这是主入口，不再像 0.1.7 那样点按钮
   * 毫无反馈；系统安装器会自己接管确认界面，回到本页后状态自动刷新。
   */
  const installShell = useCallback(() => {
    if (installing) return;
    setInstalling(true);
    void installPhoneShellManager()
      .then((result) => {
        if (result.status === "started") {
          Alert.alert(
            pickText("安装器已打开", "Installer opened"),
            pickText(
              "按系统提示完成安装；装好后回到本页，Shizuku 状态会自动刷新。",
              "Finish the installation, then come back — the Shizuku status refreshes automatically.",
            ),
          );
          startPolling(30_000);
          return;
        }
        if (result.status === "permission_required") {
          Alert.alert(
            pickText("需要允许安装应用", "Allow app installs"),
            pickText(
              "系统要求先允许 NIBI-GO 安装应用。点「去授权」打开设置，允许后回来再点一次安装。",
              "Android requires you to allow NIBI-GO to install apps. Open the setting, allow it, then tap Install again.",
            ),
            [
              { text: pickText("取消", "Cancel"), style: "cancel" },
              {
                text: pickText("去授权", "Open settings"),
                onPress: openPhoneInstallPermissionSettings,
              },
            ],
          );
          return;
        }
        Alert.alert(
          pickText("安装未开始", "Install did not start"),
          result.message ||
            pickText(
              "随包安装包当前不可用；请稍后重试或到 Shizuku 官网下载。",
              "The bundled installer is unavailable right now. Retry later or download Shizuku from its official site.",
            ),
        );
      })
      .finally(() => setInstalling(false));
  }, [installing, startPolling]);

  const openShell = useCallback(() => {
    if (!openPhoneShellManager()) {
      Alert.alert(
        pickText("未安装 Shizuku", "Shizuku is not installed"),
        pickText(
          "先点「安装 Shizuku」完成随包安装，再打开它启动服务。",
          "Tap Install Shizuku first, then open it to start the service.",
        ),
      );
    }
  }, []);

  const a11yView = a11yStatusView(status);
  const shellView = shellStatusView(status);
  const capabilities = capabilityChips(status);
  const overlayAllowed = canShowPhoneApproval();

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[t.glowTop, t.bgGradient[0], t.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title={pick("手机操控", "Phone control")} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={bodyStyle}>
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: t.inkSub }]}>
            {pick(
              "开启后助手可读屏并操作手机；每次操作都会先在聊天里征求批准。",
              "Lets the assistant read the screen and control your phone; every action asks for your approval first.",
            )}
          </Text>
        </AppearIn>

        {!status.available ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <Text style={[styles.warning, { color: t.amber }]}>
              {pick(
                "当前环境没有手机操控原生模块（需要 Android 正式构建，Expo Go 不可用）。",
                "The native phone-control module isn't available in this environment (requires an Android build; unavailable in Expo Go).",
              )}
            </Text>
          </AppearIn>
        ) : null}

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard>
            <ToggleRow
              icon="phone"
              title={pick("手机操控（无障碍）", "Phone control (Accessibility)")}
              detail={pick(
                "读取屏幕文字，模拟点按、滑动与输入",
                "Read on-screen text and simulate taps, swipes, and typing",
              )}
              value={status.a11y.enabled}
              onChange={toggleA11y}
              disabled={!status.available}
            />
            <Divider />
            <View style={styles.cardBody}>
              {/* 2.0.1：与页顶重复的「每次都批准」删掉；只留打码这条隐私承诺。 */}
              <Text style={[styles.copy, { color: t.inkSub }]}>
                {pick(
                  "密码与验证码在读屏结果里会打码。",
                  "Passwords and verification codes are masked in screen reads.",
                )}
              </Text>
              <StatusRow title={pick("系统无障碍", "Accessibility service")} view={a11yView} />
              <View style={styles.actions}>
                <ActionButton
                  label={pick("打开系统无障碍设置", "Open Accessibility settings")}
                  onPress={openPhoneAccessibilitySettings}
                  disabled={!status.available}
                />
              </View>
              <StatusRow
                title={pick("悬浮审批", "Floating approval")}
                view={{
                  value: overlayAllowed ? pick("已授权", "Allowed") : pick("未授权", "Not allowed"),
                  tone: overlayAllowed ? "ok" : "warn",
                }}
              />
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                {overlayAllowed
                  ? pick(
                      "审批卡悬浮在屏幕底部，不抢前台，目标应用保持在前台。",
                      "Approval cards float at the bottom so the target app stays in the foreground.",
                    )
                  : pick(
                      "未授权时审批卡会出现在 NIBI-GO 内，可能把目标应用切到后台。",
                      "Without overlay permission, approvals appear inside NIBI-GO and may switch away from the target app.",
                    )}
              </Text>
              <View style={styles.actions}>
                <ActionButton
                  label={
                    overlayAllowed
                      ? pick("查看悬浮审批权限", "Review overlay permission")
                      : pick("授权悬浮审批", "Grant overlay permission")
                  }
                  onPress={openPhoneOverlaySettings}
                  disabled={!status.available}
                />
              </View>
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                {pick(
                  "系统每次打开其他应用都弹「想要打开…」时，选「30天内允许」；ColorOS 还可以在应用信息 → 权限里允许「后台弹出界面」。",
                  "If Android prompts every time NIBI opens another app, choose \"Allow for 30 days\"; on ColorOS, also allow \"Display pop-up windows in background\" in App info → Permissions.",
                )}
              </Text>
              <View style={styles.actions}>
                <ActionButton
                  label={pick("打开应用信息", "Open app info")}
                  onPress={openPhoneAppSettings}
                  disabled={!status.available}
                />
              </View>
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard>
            <ToggleRow
              icon="shield"
              tone="steel"
              title={pick("高级手机操控（Shizuku）", "Advanced control (Shizuku)")}
              detail={pick(
                "安装、停止与系统设置命令",
                "Install/stop apps and modify system settings",
              )}
              value={status.shell.enabled}
              onChange={toggleShell}
              disabled={!status.available || (!status.shell.installed && !status.shell.enabled)}
            />
            <Divider />
            <View style={styles.cardBody}>
              <Text style={[styles.copy, { color: t.inkSub }]}>
                {status.shell.installed
                  ? pick(
                      "需要先安装并运行 Shizuku；权限等同 shell uid，不是 root。",
                      "Requires Shizuku to be installed and running; runs as shell uid, not root.",
                    )
                  : pick(
                      "Shizuku 安装包已内置在 NIBI-GO 里，点下方一键安装（约 2.5 MB，无需联网）。装好后在 Shizuku 里用无线调试启动服务。",
                      "Shizuku is bundled inside NIBI-GO. Tap Install below (about 2.5 MB, no network needed), then start its service via Wireless debugging.",
                    )}
              </Text>
              <StatusRow title="Shizuku" view={shellView} />
              <StatusRow
                title={pick("无线调试", "Wireless debugging")}
                view={{
                  value: status.shell.wirelessDebugging
                    ? pick("已开启", "On")
                    : pick("未开启", "Off"),
                  tone: status.shell.wirelessDebugging ? "ok" : "muted",
                }}
              />
              {!status.shell.installed ? (
                <View style={styles.actions}>
                  <ActionButton
                    variant="primary"
                    label={
                      installing
                        ? pick("正在准备安装…", "Preparing installer…")
                        : pick("安装 Shizuku（随包内置）", "Install Shizuku (bundled)")
                    }
                    onPress={installShell}
                    disabled={!status.available || installing}
                  />
                </View>
              ) : (
                <View style={styles.actions}>
                  <ActionButton
                    label={pick("请求 Shizuku 授权", "Request Shizuku access")}
                    onPress={requestShellPermission}
                    disabled={!status.available}
                  />
                  <ActionButton
                    label={pick("打开 Shizuku", "Open Shizuku")}
                    onPress={openShell}
                    disabled={!status.available}
                  />
                </View>
              )}
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                {!status.shell.installed
                  ? pick(
                      "点安装后按系统提示完成；回到本页会自动刷新状态。",
                      "Finish the system install prompt; this page refreshes when you come back.",
                    )
                  : !status.shell.running
                    ? pick(
                        "打开 Shizuku 并启动服务（可用无线调试配对），再回到本页请求授权。",
                        "Open Shizuku and start its service (pair via Wireless debugging), then return here to authorize.",
                      )
                    : status.shell.wirelessDebugging
                      ? pick(
                          "在 Shizuku 里启动服务并授权后回到本页。",
                          "Start the service in Shizuku and grant permission, then return here.",
                        )
                      : pick(
                          "先开启系统「无线调试」，在 Shizuku 里配对并启动服务。",
                          "Turn on Wireless debugging first, then pair and start the service in Shizuku.",
                        )}
              </Text>
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(4, 32, 240)}>
          <SectionCard label={pick("状态", "Status")}>
            <View style={styles.chips}>
              {capabilities.map((item) => (
                <View
                  key={item.key}
                  style={[styles.chip, { backgroundColor: item.active ? t.brandSoft : t.surfaceSoft }]}
                >
                  <Text style={[styles.chipText, { color: item.active ? t.brand : t.inkFaint }]}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>
          </SectionCard>
        </AppearIn>
      </ScrollView>

      <ConfirmDialog
        visible={confirmShell}
        danger
        title={pick("开启高级手机操控？", "Enable advanced phone control?")}
        message={pick(
          "将通过 Shizuku 以 shell uid 执行命令：安装/卸载应用、强制停止、修改系统设置、授予权限。它仍是 shell uid，不是 root，也不能绕过 FLAG_SECURE。每次调用仍需在聊天里批准。",
          "Commands will run via Shizuku as shell uid: install/uninstall apps, force-stop, change system settings, and grant permissions. This is not root and cannot bypass FLAG_SECURE. Every call still requires your approval in chat.",
        )}
        confirmLabel={pick("开启", "Enable")}
        onCancel={() => setConfirmShell(false)}
        onConfirm={confirmShellEnabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(4) },
  intro: { ...text("small") },
  warning: { ...text("small") },
  cardBody: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    gap: space(2),
  },
  copy: { ...text("small") },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
  },
  statusLabel: { ...text("small"), fontWeight: "600" },
  statusBadge: { paddingHorizontal: space(2), paddingVertical: space(0.5), borderRadius: radius.chip },
  statusValue: { ...text("micro"), fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  hint: { ...text("micro") },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(1.5),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  chip: { paddingHorizontal: space(2.5), paddingVertical: space(0.75), borderRadius: radius.chip },
  chipText: { ...text("micro"), fontWeight: "600" },
});
