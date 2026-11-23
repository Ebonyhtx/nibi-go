import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { WebRemoteControlRelayV2Device } from "@nibi-go/shared-extract";

import { Icon } from "../components/Icon";
import { PillButton } from "../components/ui/PillButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { useI18n } from "../i18n";
import { useResponsiveBodyStyle } from "../layout/responsive";
import { PressableScale } from "../motion/PressableScale";
import { useSession } from "../relay/useSession";
import { radius, size, space, text, useNibiTheme, type NibiTheme } from "../theme";

type LoadError = "auth" | "network" | "login-incomplete" | { message: string } | null;

// 设备列表屏（relay-v2-pairing.md §06 简化版：在线优先 + 手动刷新，不轮询、不做最近设备自动连接——
// 自动接续随 A2 里程碑一并做）。在线设备点击即连接。
// 2.0：ScreenHeader（登录态右侧刷新钮）+ 主题 token 统一；加载/登录/连接逻辑不变。
export default function DevicesScreen() {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const styles = useMemo(() => makeStyles(th), [th]);
  const insets = useSafeAreaInsets();
  const listBodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(2.5),
  });
  const centerBodyStyle = useResponsiveBodyStyle({
    paddingTop: space(6),
    paddingBottom: insets.bottom + space(6),
    gap: space(4),
  });
  const { session, snapshot } = useSession();
  const [devices, setDevices] = useState<WebRemoteControlRelayV2Device[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loadError, setLoadError] = useState<LoadError>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDevices(await session.fetchDevices(new AbortController().signal));
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setLoadError(raw.includes("auth-required") ? "auth" : "network");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  async function login() {
    if (loggingIn) return;
    setLoggingIn(true);
    setLoadError(null);
    try {
      await session.login();
      const current = session.getSnapshot();
      if (!current.loggedIn) {
        setLoadError(current.error?.message ? { message: current.error.message } : "login-incomplete");
        return;
      }
      await load();
    } finally {
      setLoggingIn(false);
    }
  }

  const loadErrorText =
    loadError === "auth"
      ? pick("需要重新登录 NIBI 账号", "Please sign in to your NIBI account again")
      : loadError === "network"
        ? pick(
            "无法加载设备，请检查网络后刷新。",
            "Unable to load devices. Check your network and refresh.",
          )
        : loadError === "login-incomplete"
          ? pick("登录没有完成，请重试", "Sign-in did not complete. Please retry.")
          : loadError?.message ?? null;

  const online = devices?.filter((d) => d.online) ?? [];
  const offline = devices?.filter((d) => !d.online) ?? [];

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={pick("选择电脑", "Select Computer")}
        onBack={() => router.back()}
        right={
          snapshot.loggedIn ? (
            <PressableScale
              onPress={() => void load()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={pick("刷新设备列表", "Refresh device list")}
              style={[
                styles.headerAction,
                {
                  backgroundColor: th.glass,
                  borderColor: th.glassBorder,
                  opacity: loading ? 0.5 : 1,
                },
              ]}
            >
              {loading ? (
                <ActivityIndicator color={th.brand} size="small" />
              ) : (
                <Icon name="refresh" size={16} color={th.inkSub} />
              )}
            </PressableScale>
          ) : undefined
        }
      />

      {!snapshot.loggedIn ? (
        <View style={[styles.center, centerBodyStyle]}>
          <Text style={styles.intro}>
            {pick(
              "登录 NIBI 账号后即可查看并连接你的电脑。",
              "Sign in to your NIBI account to view and connect to your computers.",
            )}
          </Text>
          <Text style={styles.hint}>
            {pick(
              "手机远控的网页登录与这里的账号登录是两套；在这里登录一次，GO 的配对、设备列表和插件授权都会用它。",
              "Web remote sign-in and app account sign-in are separate. Sign in here once for GO pairing, device list, and plugin licenses.",
            )}
          </Text>
          {loadErrorText ? <Text style={styles.error}>{loadErrorText}</Text> : null}
          <PillButton
            label={
              loggingIn
                ? pick("正在登录…", "Signing in…")
                : pick("登录 NIBI 账号", "Sign in to NIBI")
            }
            buttonSize="lg"
            onPress={() => void login()}
            disabled={loggingIn}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={listBodyStyle}>
          {loadErrorText && <Text style={styles.error}>{loadErrorText}</Text>}

          {devices === null && !loadErrorText && (
            <Text style={styles.empty}>{pick("正在加载设备…", "Loading devices…")}</Text>
          )}
          {devices?.length === 0 && (
            <Text style={styles.empty}>
              {pick(
                "暂无设备。在电脑端登录同一账号并开启 Web 远程控制，然后刷新列表。",
                "No devices found. Sign in to the same account on your computer, enable Web Remote Control, then refresh.",
              )}
            </Text>
          )}

          {online.length > 0 && (
            <Text style={styles.group}>
              {pick(`在线 ${online.length}`, `Online ${online.length}`)}
            </Text>
          )}
          {online.map((device) => {
            const deviceName = device.meta.name?.trim() || pick("未命名设备", "Unnamed device");
            return (
              <PressableScale
                key={device.device_sid}
                scaleTo={0.985}
                style={[styles.row, styles.rowOnline]}
                onPress={() =>
                  void session.startFromDevice(device).finally(() => router.replace("/work"))
                }
                accessibilityRole="button"
                accessibilityLabel={deviceName}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{deviceName}</Text>
                  <Text style={styles.rowSub}>
                    {device.meta.platform || pick("未知平台", "Unknown platform")}
                    {device.meta.version ? ` · v${device.meta.version}` : ""}
                  </Text>
                </View>
                <Icon name="chevron-right" size={15} color={th.inkFaint} />
              </PressableScale>
            );
          })}

          {offline.length > 0 && (
            <Text style={styles.group}>
              {pick(`离线 ${offline.length}`, `Offline ${offline.length}`)}
            </Text>
          )}
          {offline.map((device) => (
            <View key={device.device_sid} style={[styles.row, styles.rowOffline]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, styles.dim]}>
                  {device.meta.name?.trim() || pick("未命名设备", "Unnamed device")}
                </Text>
                <Text style={[styles.rowSub, styles.dim]}>
                  {`${device.meta.platform || pick("未知平台", "Unknown platform")} · ${pick("离线", "Offline")}`}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (th: NibiTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: th.bg },
    headerAction: {
      width: size.button,
      height: size.button,
      borderRadius: radius.control,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: "center",
      justifyContent: "center",
    },
    group: {
      ...text("micro"),
      color: th.inkFaint,
      fontWeight: "700",
      letterSpacing: 0.4,
      marginTop: space(2),
      paddingHorizontal: space(1),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space(3),
      padding: space(4),
      borderRadius: radius.control,
      backgroundColor: th.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: th.hairline,
    },
    rowOnline: { backgroundColor: th.brandSoft },
    rowOffline: { opacity: 0.6 },
    rowText: { flex: 1, gap: space(0.5) },
    rowTitle: { ...text("bodyLg"), fontWeight: "600", color: th.ink },
    rowSub: { ...text("small"), color: th.inkSub },
    dim: { color: th.inkFaint },
    error: { ...text("small"), color: th.red, textAlign: "center", padding: space(2) },
    empty: {
      ...text("small"),
      color: th.inkSub,
      textAlign: "center",
      paddingVertical: space(4),
    },
    intro: { ...text("small"), color: th.inkSub, textAlign: "center" },
    hint: { ...text("small"), color: th.inkSub, textAlign: "center" },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
  });
