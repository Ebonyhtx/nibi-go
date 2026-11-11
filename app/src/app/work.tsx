import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ConnState } from "@nibi-go/relay-client";

import { useSession } from "../relay/useSession";

// 连接过程页阶段文案（对齐 relay-v2-pairing.md §06 连接过程页；非线性态不高亮进度段）
const PHASE_TEXT: Record<ConnState, string> = {
  idle: "未连接",
  connecting: "正在连接中转服务…",
  authenticating: "设备鉴权中…",
  waiting_terminal: "等待桌面端配对…",
  paired: "已连接",
  kicked: "会话冲突：已在其他设备连接",
  error: "连接失败",
};

// A1-2：配对与连接枢纽屏（登录门禁 → 扫码/设备列表 → 连接状态 → 免扫重连）。
// 聊天/任务面在 A2 接入（chat-core）；本屏只承载 A1 的配对语义。
export default function WorkScreen() {
  const { session, snapshot } = useSession();
  const busy = snapshot.connState !== "idle";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>NIBI-WORK</Text>

      {snapshot.error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{snapshot.error.message}</Text>
        </View>
      )}

      {!snapshot.loggedIn ? (
        <>
          <Text style={styles.hint}>登录后即可远控桌面，手机和电脑需登录同一账号。</Text>
          <Pressable style={styles.button} onPress={() => void session.login()}>
            <Text style={styles.buttonText}>登录 NIBI 账号</Text>
          </Pressable>
        </>
      ) : (
        <>
          {snapshot.displayName && (
            <Text style={styles.account}>当前账号：{snapshot.displayName}</Text>
          )}

          <View style={styles.statusCard}>
            <Text style={styles.statusText}>{PHASE_TEXT[snapshot.connState]}</Text>
            {snapshot.credential?.deviceName && (
              <Text style={styles.deviceName}>{snapshot.credential.deviceName}</Text>
            )}
            {snapshot.connState === "paired" && (
              <Text
                style={[
                  styles.encryption,
                  snapshot.encryption === "plaintext" && styles.encryptionWarn,
                ]}
              >
                {snapshot.encryption === "secure"
                  ? "🔒 端到端加密"
                  : snapshot.encryption === "plaintext"
                    ? "⚠️ 未加密连接（对端不支持协商）"
                    : "正在协商加密…"}
              </Text>
            )}
          </View>

          {busy ? (
            <>
              <Pressable style={styles.button} onPress={() => router.push("/chat")}>
                <Text style={styles.buttonText}>打开聊天</Text>
              </Pressable>
              <Pressable style={styles.buttonSecondary} onPress={() => session.disconnect()}>
                <Text style={styles.buttonText}>断开</Text>
              </Pressable>
            </>
          ) : (
            <>
              {snapshot.credential && (
                <Pressable style={styles.button} onPress={() => void session.resume()}>
                  <Text style={styles.buttonText}>
                    连接 {snapshot.credential.deviceName ?? "上次设备"}
                  </Text>
                </Pressable>
              )}
              <Pressable style={styles.button} onPress={() => router.push("/scan")}>
                <Text style={styles.buttonText}>扫码连接桌面</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => router.push("/devices")}>
                <Text style={styles.buttonText}>设备列表</Text>
              </Pressable>
            </>
          )}

          <Pressable style={styles.link} onPress={() => void session.logout()}>
            <Text style={styles.linkText}>切换账号</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 12 },
  hint: { fontSize: 13, color: "#666", textAlign: "center", marginBottom: 8 },
  account: { fontSize: 12, color: "#666" },
  statusCard: {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f5f7fa",
    alignItems: "center",
    marginVertical: 8,
  },
  statusText: { fontSize: 15, fontWeight: "600" },
  deviceName: { fontSize: 12, color: "#666", marginTop: 4 },
  encryption: { fontSize: 12, color: "#1e7d32", marginTop: 6 },
  encryptionWarn: { color: "#b26a00" },
  errorCard: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fdecec",
    alignItems: "center",
  },
  errorText: { fontSize: 13, color: "#c0392b", textAlign: "center" },
  button: {
    width: 260,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#e8f0fe",
    alignItems: "center",
  },
  buttonSecondary: {
    width: 260,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fdecec",
    alignItems: "center",
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  link: { marginTop: 12, padding: 8 },
  linkText: { fontSize: 12, color: "#888" },
});
