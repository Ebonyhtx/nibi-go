// 手机操控设置：无障碍（开关 1）与 Shizuku 高级模式（开关 2）。
//
// 只做状态、授权引导与开关；真正的读屏/手势/shell 在 nibi-phone 原生模块里。
// 开关变化会让当前会话在空闲时自动 resume 一次（见 useKernelConversation）。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describePhoneCapabilities, type PhoneStatus } from "@nibi-go/phone-tools";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Icon, type IconName } from "../../components/Icon";
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
import { radius, space, type as typeScale, useNibiTheme } from "../../theme";

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
        : { backgroundColor: t.panel, color: t.inkFaint };
  return (
    <View style={styles.statusRow}>
      <Text style={[styles.statusLabel, { color: t.inkFaint }]}>{title}</Text>
      <View style={[styles.statusBadge, { backgroundColor: palette.backgroundColor }]}>
        <Text style={[styles.statusValue, { color: palette.color }]}>{view.value}</Text>
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useNibiTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: t.card, borderColor: t.hairline },
        { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 },
      ]}
    >
      <Text style={[styles.actionText, { color: t.inkSub }]}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  title,
  detail,
  value,
  onValueChange,
  disabled,
}: {
  icon: IconName;
  title: string;
  detail: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const t = useNibiTheme();
  return (
    <View
      style={[
        styles.row,
        { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.hairline },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: t.panel }]}>
        <Icon name={icon} size={15} color={t.inkSub} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: t.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.rowDetail, { color: t.inkFaint }]} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: t.hairline, true: t.brandSoft }}
        thumbColor={value ? t.brand : t.card}
      />
    </View>
  );
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
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={[styles.head, { borderBottomColor: t.hairline }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={[styles.back, { backgroundColor: t.panel }]}
        >
          <Icon name="chevron-left" size={16} color={t.inkSub} />
        </Pressable>
        <Text style={[styles.title, { color: t.ink }]}>手机操控</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <Text style={[styles.intro, { color: t.inkSub }]}>
          开启后，当前会话可以读取屏幕并操作手机；每次工具调用仍需在聊天里批准。工具能力固定，未开启时会说明原因。
        </Text>

        {!status.available ? (
          <Text style={[styles.warning, { color: t.amber }]}>
            当前环境没有手机操控原生模块（需要 Android 正式构建，Expo Go 不可用）。
          </Text>
        ) : null}

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <ToggleRow
            icon="phone"
            title="手机操控（无障碍）"
            detail="读取屏幕文字，模拟点按、滑动与输入"
            value={status.a11y.enabled}
            onValueChange={toggleA11y}
            disabled={!status.available}
          />
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
        </View>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <ToggleRow
            icon="shield"
            title="高级手机操控（Shizuku）"
            detail="通过 shell uid 执行安装、停止与系统设置命令"
            value={status.shell.enabled}
            onValueChange={toggleShell}
            disabled={!status.available}
          />
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
        </View>

        <Text style={[styles.sectionTitle, { color: t.inkFaint }]}>当前能力</Text>
        <View
          style={[styles.capabilityCard, { backgroundColor: t.card, borderColor: t.hairline }]}
        >
          <View style={styles.chips}>
            {capabilities.map((item) => {
              const active = item !== "未开启" && item !== "不可用";
              return (
                <View
                  key={item}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? t.brandSoft : t.panel },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? t.brand : t.inkFaint }]}>
                    {item}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          开关保存后，正在运行的回合结束时会自动刷新当前会话，不会新开对话；下一条消息起生效。
        </Text>
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
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, textAlign: "center", fontSize: typeScale.heading, fontWeight: "700" },
  body: { padding: space(4), gap: space(4) },
  intro: { fontSize: 12, lineHeight: 18 },
  warning: { fontSize: 11.5, lineHeight: 17 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    minHeight: 54,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 12.5, fontWeight: "600" },
  rowDetail: { fontSize: 9.5, lineHeight: 14 },
  cardBody: {
    paddingHorizontal: space(2.5),
    paddingVertical: space(2.5),
    gap: space(2),
  },
  copy: { fontSize: 11.5, lineHeight: 17 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
  },
  statusLabel: { fontSize: 10.5, fontWeight: "600" },
  statusBadge: { paddingHorizontal: space(2), paddingVertical: 2, borderRadius: radius.chip },
  statusValue: { fontSize: 10, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  actionButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  actionText: { fontSize: 11.5, fontWeight: "600" },
  hint: { fontSize: 10, lineHeight: 15 },
  sectionTitle: { fontSize: 10.5, fontWeight: "700", paddingLeft: space(1) },
  capabilityCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  chip: { paddingHorizontal: space(2.5), paddingVertical: 3, borderRadius: radius.chip },
  chipText: { fontSize: 10, fontWeight: "600" },
  footnote: { fontSize: 10, lineHeight: 15 },
});
