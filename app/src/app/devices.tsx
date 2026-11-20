import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { WebRemoteControlRelayV2Device } from "@nibi-go/shared-extract";

import { Icon } from "../components/Icon";
import { PillButton } from "../components/ui/PillButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { PressableScale } from "../motion/PressableScale";
import { useSession } from "../relay/useSession";
import { radius, size, space, text, useNibiTheme, type NibiTheme } from "../theme";

// 设备列表屏（relay-v2-pairing.md §06 简化版：在线优先 + 手动刷新，不轮询、不做最近设备自动连接——
// 自动接续随 A2 里程碑一并做）。在线设备点击即连接。
// 2.0：ScreenHeader（登录态右侧刷新钮）+ 主题 token 统一；加载/登录/连接逻辑不变。
export default function DevicesScreen() {
  const th = useNibiTheme();
  const styles = useMemo(() => makeStyles(th), [th]);
  const insets = useSafeAreaInsets();
  const { session, snapshot } = useSession();
  const [devices, setDevices] = useState<WebRemoteControlRelayV2Device[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDevices(await session.fetchDevices(new AbortController().signal));
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setLoadError(
        raw.includes("auth-required") ? "需要重新登录 NIBI 账号" : "无法加载设备，请检查网络后刷新。",
      );
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
        setLoadError(current.error?.message ?? "登录没有完成，请重试");
        return;
      }
      await load();
    } finally {
      setLoggingIn(false);
    }
  }

  const online = devices?.filter((d) => d.online) ?? [];
  const offline = devices?.filter((d) => !d.online) ?? [];

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="选择电脑"
        onBack={() => router.back()}
        right={
          snapshot.loggedIn ? (
            <PressableScale
              onPress={() => void load()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="刷新设备列表"
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
        <View style={styles.center}>
          <Text style={styles.intro}>登录 NIBI 账号后即可查看并连接你的电脑。</Text>
          <Text style={styles.hint}>
            手机远控的网页登录与这里的账号登录是两套；在这里登录一次，GO 的配对、设备列表和插件授权都会用它。
          </Text>
          {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
          <PillButton
            label={loggingIn ? "正在登录…" : "登录 NIBI 账号"}
            buttonSize="lg"
            onPress={() => void login()}
            disabled={loggingIn}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.container,
            { paddingBottom: insets.bottom + space(6) },
          ]}
        >
          {loadError && <Text style={styles.error}>{loadError}</Text>}

          {devices === null && !loadError && <Text style={styles.empty}>正在加载设备…</Text>}
          {devices?.length === 0 && (
            <Text style={styles.empty}>
              暂无设备。在电脑端登录同一账号并开启 Web 远程控制，然后刷新列表。
            </Text>
          )}

          {online.length > 0 && <Text style={styles.group}>在线 {online.length}</Text>}
          {online.map((device) => (
            <PressableScale
              key={device.device_sid}
              scaleTo={0.985}
              style={[styles.row, styles.rowOnline]}
              onPress={() =>
                void session.startFromDevice(device).finally(() => router.replace("/work"))
              }
              accessibilityRole="button"
              accessibilityLabel={device.meta.name?.trim() || "未命名设备"}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{device.meta.name?.trim() || "未命名设备"}</Text>
                <Text style={styles.rowSub}>
                  {device.meta.platform || "未知平台"}
                  {device.meta.version ? ` · v${device.meta.version}` : ""}
                </Text>
              </View>
              <Icon name="chevron-right" size={15} color={th.inkFaint} />
            </PressableScale>
          ))}

          {offline.length > 0 && <Text style={styles.group}>离线 {offline.length}</Text>}
          {offline.map((device) => (
            <View key={device.device_sid} style={[styles.row, styles.rowOffline]}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, styles.dim]}>
                  {device.meta.name?.trim() || "未命名设备"}
                </Text>
                <Text style={[styles.rowSub, styles.dim]}>
                  {device.meta.platform || "未知平台"} · 离线
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
    container: {
      paddingHorizontal: space(6),
      paddingTop: space(2),
      gap: space(2.5),
    },
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
      gap: space(4),
      padding: space(6),
    },
  });
