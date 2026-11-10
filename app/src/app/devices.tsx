import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";

import type { WebRemoteControlRelayV2Device } from "@nibi-go/shared-extract";

import { useSession } from "../relay/useSession";

// 设备列表屏（relay-v2-pairing.md §06 简化版：在线优先 + 手动刷新，不轮询、不做最近设备自动连接——
// 自动接续随 A2 里程碑一并做）。在线设备点击即连接。
export default function DevicesScreen() {
  const { session, snapshot } = useSession();
  const [devices, setDevices] = useState<WebRemoteControlRelayV2Device[] | null>(null);
  const [loading, setLoading] = useState(false);
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

  if (!snapshot.loggedIn) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>请先在 NIBI-WORK 屏登录账号。</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>返回</Text>
        </Pressable>
      </View>
    );
  }

  const online = devices?.filter((d) => d.online) ?? [];
  const offline = devices?.filter((d) => !d.online) ?? [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>选择电脑</Text>
        <Pressable style={styles.refresh} onPress={() => void load()} disabled={loading}>
          <Text style={styles.refreshText}>{loading ? "刷新中…" : "刷新"}</Text>
        </Pressable>
      </View>

      {loadError && <Text style={styles.error}>{loadError}</Text>}

      {devices === null && !loadError && <Text style={styles.empty}>正在加载设备…</Text>}
      {devices?.length === 0 && (
        <Text style={styles.empty}>
          暂无设备。在电脑端登录同一账号并开启 Web 远程控制，然后刷新列表。
        </Text>
      )}

      {online.length > 0 && <Text style={styles.group}>在线 {online.length}</Text>}
      {online.map((device) => (
        <Pressable
          key={device.device_sid}
          style={[styles.row, styles.rowOnline]}
          onPress={() => void session.startFromDevice(device).finally(() => router.replace("/work"))}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{device.meta.name?.trim() || "未命名设备"}</Text>
            <Text style={styles.rowSub}>
              {device.meta.platform || "未知平台"}
              {device.meta.version ? ` · v${device.meta.version}` : ""}
            </Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
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

      <Pressable style={styles.back} onPress={() => router.back()}>
        <Text style={styles.linkText}>返回</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "700" },
  refresh: { padding: 8 },
  refreshText: { fontSize: 14, color: "#2563eb", fontWeight: "600" },
  group: { fontSize: 12, color: "#888", marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 12, backgroundColor: "#f5f7fa" },
  rowOnline: { backgroundColor: "#e8f0fe" },
  rowOffline: { opacity: 0.6 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12, color: "#666", marginTop: 2 },
  dim: { color: "#999" },
  arrow: { fontSize: 18, color: "#888" },
  error: { fontSize: 13, color: "#c0392b", textAlign: "center", padding: 8 },
  empty: { fontSize: 13, color: "#888", textAlign: "center", paddingVertical: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  button: { padding: 14, borderRadius: 12, backgroundColor: "#e8f0fe" },
  buttonText: { fontSize: 15, fontWeight: "600" },
  back: { alignSelf: "center", padding: 12, marginTop: 8 },
  linkText: { fontSize: 13, color: "#888" },
});
