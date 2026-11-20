// 本机记忆设置：GO 的自动记忆是设备级、所有会话共享（与桌面端按工作区不同）。
//
// 开关只在会话物化时交给内核（session/requestRuntimePreferences.memoryEnabled）；
// 已打开的会话要重新打开才生效。体量/清空复用 kernel 的 sessionData/measure|purge。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../../components/Icon";
import { currentKernelClient } from "../../kernel/kernelRegistry";
import { clearMemory, measureMemory, type MemoryUsageEntry } from "../../memory/usage";
import { useMemoryPreferences } from "../../memory/useMemoryPreferences";
import { radius, space, type as typeScale, useNibiTheme } from "../../theme";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RowLink({
  title,
  detail,
  onPress,
  destructive,
}: {
  title: string;
  detail: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const t = useNibiTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.65 : 1 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.linkTitle, { color: destructive ? t.red : t.ink }]}>{title}</Text>
        <Text style={[styles.linkDetail, { color: t.inkFaint }]}>{detail}</Text>
      </View>
      <Icon name="chevron-right" size={15} color={t.inkGhost} />
    </Pressable>
  );
}

export default function MemorySettingsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { preferences, setEnabled } = useMemoryPreferences();
  const [entries, setEntries] = useState<MemoryUsageEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const client = currentKernelClient();
    if (!client) {
      setMessage("内核会话还没就绪：先回首页打开一个会话，再回来查看。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const usage = await measureMemory(client);
      setEntries(usage.entries);
      setTotalBytes(usage.totalBytes);
    } catch (error) {
      setMessage(`读取记忆体量失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  function confirmClear() {
    const client = currentKernelClient();
    if (!client) {
      setMessage("内核会话还没就绪：先回首页打开一个会话，再回来清空。");
      return;
    }
    Alert.alert(
      "清空本机记忆？",
      "会删除所有会话共享的记忆文件，不删除会话本身。已经打开的会话仍持有内存里的记忆，重新打开后才完全消失。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清空",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            setMessage(null);
            void clearMemory(client)
              .then((bytes) => {
                setMessage(`已清空本机记忆（释放 ${formatBytes(bytes)}）`);
                setEntries([]);
                setTotalBytes(0);
              })
              .catch((error: unknown) => {
                setMessage(
                  `清空失败：${error instanceof Error ? error.message : String(error)}`,
                );
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

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
        <Text style={[styles.title, { color: t.ink }]}>记忆</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <Text style={[styles.intro, { color: t.inkSub }]}>
          NIBI-GO 的自动记忆是<Text style={{ fontWeight: "700" }}>本机共享</Text>
          的：所有会话读写同一份记忆，不像桌面端那样按项目隔离。开启后，回合结束会额外调用一次模型做抽取，
          可能增加 Token 成本。
        </Text>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <View style={styles.toggleRow}>
            <View style={[styles.rowIcon, { backgroundColor: t.panel }]}>
              <Icon name="sparkles" size={15} color={t.inkSub} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.rowTitle, { color: t.ink }]}>启用本机记忆</Text>
              <Text style={[styles.rowDetail, { color: t.inkFaint }]}>
                关闭后，新会话不再读取或更新记忆；已打开的会话重新打开后生效。
              </Text>
            </View>
            <Switch
              value={preferences.enabled}
              onValueChange={(enabled) => {
                setEnabled(enabled);
                setMessage("记忆设置已保存；对下一个新会话生效。");
              }}
              trackColor={{ false: t.hairline, true: t.brandSoft }}
              thumbColor={preferences.enabled ? t.brand : t.card}
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <View style={styles.usageHead}>
            <Text style={[styles.sectionTitle, { color: t.ink }]}>已保存的记忆</Text>
            <Pressable
              onPress={() => void refresh()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="刷新记忆体量"
              style={[styles.refresh, { backgroundColor: t.panel, opacity: busy ? 0.6 : 1 }]}
            >
              {busy ? (
                <ActivityIndicator color={t.brand} />
              ) : (
                <Icon name="refresh" size={14} color={t.inkSub} />
              )}
            </Pressable>
          </View>
          {totalBytes === null ? (
            <Text style={[styles.rowDetail, { color: t.inkFaint }]}>正在读取…</Text>
          ) : totalBytes === 0 ? (
            <Text style={[styles.rowDetail, { color: t.inkFaint }]}>还没有保存记忆。</Text>
          ) : (
            <>
              <Text style={[styles.total, { color: t.ink }]}>{formatBytes(totalBytes)}</Text>
              {entries.map((entry) => (
                <Text key={entry.workspacePath} style={[styles.rowDetail, { color: t.inkFaint }]}>
                  {entry.workspacePath} · {formatBytes(entry.bytes)}
                </Text>
              ))}
            </>
          )}
          <RowLink
            title="清空本机记忆"
            detail="删除所有会话共享的记忆文件；不删除会话。"
            onPress={confirmClear}
            destructive
          />
        </View>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <RowLink
            title="记忆与链路诊断"
            detail="看缓存命中率、逐轮用量与记忆抽取请求是否正常。"
            onPress={() => router.push("/settings/diagnostics")}
          />
        </View>

        {message ? (
          <View style={[styles.message, { backgroundColor: t.panel, borderColor: t.hairline }]}>
            <Text style={[styles.messageText, { color: t.inkSub }]}>{message}</Text>
          </View>
        ) : null}

        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          记忆文件位置由内核按本机 workspace 计算；GO 目前是设备级共享。开关本身不写会话记录。
        </Text>
      </ScrollView>
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
  body: { padding: space(4), gap: space(3) },
  intro: { fontSize: 12, lineHeight: 19 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
    gap: space(2),
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 13.5, fontWeight: "600" },
  rowDetail: { fontSize: 10.5, lineHeight: 16 },
  usageHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 13, fontWeight: "700" },
  refresh: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  total: { fontSize: 20, fontWeight: "700" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.06)",
    paddingTop: space(2),
    marginTop: space(1),
  },
  linkTitle: { fontSize: 12.5, fontWeight: "600" },
  linkDetail: { fontSize: 10, lineHeight: 15 },
  message: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: space(3) },
  messageText: { fontSize: 12, lineHeight: 18 },
  footnote: { fontSize: 10, lineHeight: 15 },
});
