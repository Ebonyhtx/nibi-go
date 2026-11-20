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
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describePhoneCapabilities, type PhoneStatus } from "@nibi-go/phone-tools";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PillButton } from "../../components/ui/PillButton";
import { ToggleRow } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import {
  canShowPhoneApproval,
  openPhoneAccessibilitySettings,
  openPhoneAppSettings,
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
  if (!status.available) return { value: "不可用", tone: "muted" };
  if (status.a11y.connected) return { value: "已连接", tone: "ok" };
  if (status.a11y.enabled) return { value: "已开启未连接", tone: "warn" };
  return { value: "未开启", tone: "muted" };
}

function shellStatusView(status: PhoneStatus): StatusView {
  if (!status.available) return { value: "不可用", tone: "muted" };
  if (!status.shell.installed) return { value: "未安装 Shizuku", tone: "muted" };
  if (!status.shell.running) return { value: "未运行", tone: "warn" };
  if (status.shell.permission !== "granted") return { value: "未授权", tone: "warn" };
  return { value: "已连接", tone: "ok" };
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

/** 动作按钮统一 PillButton（secondary）；disabled 态由 primitive 处理。 */
function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return <PillButton label={label} variant="secondary" onPress={onPress} disabled={disabled} />;
}

export default function PhoneSettingsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<PhoneStatus>(() => phoneStatus());
  const [confirmShell, setConfirmShell] = useState(false);
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

  const requestShellPermission = useCallback(() => {
    requestPhoneShellPermission();
    refresh();
    stopPolling();
    // Shizuku 的授权结果是异步的：每秒看一次状态，约 15 秒后停止。
    pollRef.current = setInterval(refresh, 1000);
    pollStopRef.current = setTimeout(stopPolling, 15_000);
  }, [refresh, stopPolling]);

  const a11yView = a11yStatusView(status);
  const shellView = shellStatusView(status);
  const capabilities = describePhoneCapabilities(status);
  const overlayAllowed = canShowPhoneApproval();

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[t.glowTop, t.bgGradient[0], t.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="手机操控" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: t.inkSub }]}>
            开启后，当前会话可以读取屏幕并操作手机；每次工具调用仍需在聊天里批准。工具能力固定，未开启时会说明原因。
          </Text>
        </AppearIn>

        {!status.available ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <Text style={[styles.warning, { color: t.amber }]}>
              当前环境没有手机操控原生模块（需要 Android 正式构建，Expo Go 不可用）。
            </Text>
          </AppearIn>
        ) : null}

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard>
            <ToggleRow
              icon="phone"
              title="手机操控（无障碍）"
              detail="读取屏幕文字，模拟点按、滑动与输入"
              value={status.a11y.enabled}
              onChange={toggleA11y}
              disabled={!status.available}
            />
            <Divider />
            <View style={styles.cardBody}>
              <Text style={[styles.copy, { color: t.inkSub }]}>
                会读取当前屏幕的文字并模拟点按、滑动与输入。密码、验证码、身份证与银行卡号在读屏结果里打码；每次工具调用仍需在聊天里批准。
              </Text>
              <StatusRow title="系统无障碍" view={a11yView} />
              <View style={styles.actions}>
                <ActionButton
                  label="打开系统无障碍设置"
                  onPress={openPhoneAccessibilitySettings}
                  disabled={!status.available}
                />
              </View>
              <StatusRow
                title="悬浮审批"
                view={{
                  value: overlayAllowed ? "已授权" : "未授权",
                  tone: overlayAllowed ? "ok" : "warn",
                }}
              />
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                {overlayAllowed
                  ? "审批卡悬浮在屏幕底部，不抢前台，目标应用保持在前台。"
                  : "未授权时审批卡会出现在 NIBI-GO 内，可能把目标应用切到后台。"}
              </Text>
              <View style={styles.actions}>
                <ActionButton
                  label={overlayAllowed ? "查看悬浮审批权限" : "授权悬浮审批"}
                  onPress={openPhoneOverlaySettings}
                  disabled={!status.available}
                />
              </View>
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                系统每次打开其他应用都弹「想要打开…」时，选「30天内允许」；ColorOS 还可以在
                应用信息 → 权限里允许「后台弹出界面」。
              </Text>
              <View style={styles.actions}>
                <ActionButton
                  label="打开应用信息"
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
              title="高级手机操控（Shizuku）"
              detail="通过 shell uid 执行安装、停止与系统设置命令"
              value={status.shell.enabled}
              onChange={toggleShell}
              disabled={!status.available}
            />
            <Divider />
            <View style={styles.cardBody}>
              <Text style={[styles.copy, { color: t.inkSub }]}>
                需要 Shizuku 已安装并运行。开启前会列出 shell uid 的能力与边界；它不等同于 root。
              </Text>
              <StatusRow title="Shizuku" view={shellView} />
              <StatusRow
                title="无线调试"
                view={{
                  value: status.shell.wirelessDebugging ? "已开启" : "未开启",
                  tone: status.shell.wirelessDebugging ? "ok" : "muted",
                }}
              />
              <View style={styles.actions}>
                <ActionButton
                  label="请求 Shizuku 授权"
                  onPress={requestShellPermission}
                  disabled={!status.available}
                />
                <ActionButton
                  label="打开 Shizuku"
                  onPress={openPhoneShellManager}
                  disabled={!status.available}
                />
              </View>
              <Text style={[styles.hint, { color: t.inkFaint }]}>
                {status.shell.wirelessDebugging
                  ? "系统无线调试已开启；在 Shizuku 里启动服务并授权后回到本页。"
                  : "安装并启动 Shizuku（可用无线调试配对）后回到本页授权。"}
              </Text>
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(4, 32, 240)}>
          <SectionCard label="当前能力">
            <View style={styles.chips}>
              {capabilities.map((item) => {
                const active = item !== "未开启" && item !== "不可用";
                return (
                  <View
                    key={item}
                    style={[styles.chip, { backgroundColor: active ? t.brandSoft : t.surfaceSoft }]}
                  >
                    <Text style={[styles.chipText, { color: active ? t.brand : t.inkFaint }]}>
                      {item}
                    </Text>
                  </View>
                );
              })}
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(5, 32, 240)}>
          <Text style={[styles.footnote, { color: t.inkGhost }]}>
            开关保存后，正在运行的回合结束时会自动刷新当前会话，不会新开对话；下一条消息起生效。
          </Text>
        </AppearIn>
      </ScrollView>

      <ConfirmDialog
        visible={confirmShell}
        danger
        title="开启高级手机操控？"
        message="将通过 Shizuku 以 shell uid 执行命令：安装/卸载应用、强制停止、修改系统设置、授予权限。它仍是 shell uid，不是 root，也不能绕过 FLAG_SECURE。每次调用仍需在聊天里批准。"
        confirmLabel="开启"
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
  footnote: { ...text("micro") },
});
