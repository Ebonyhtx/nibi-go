// 本机记忆设置：自动记忆按会话的工作区（项目）分目录（与桌面端同一口径）。
// 内核按每次请求的 workspace 解析 <cli>/memories/projects/<项目>-<hash>/memory；
//
// 开关只在会话物化时交给内核（session/requestRuntimePreferences.memoryEnabled）；
// 已打开的会话要重新打开才生效。体量/清空复用 kernel 的 sessionData/measure|purge。
// 2.0：ScreenHeader + SectionCard 统一；清空入口改为 danger Row（Alert 确认流程不变）。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Paths } from "expo-file-system";

import { Icon } from "../../components/Icon";
import { Row } from "../../components/ui/Row";
import { Divider, SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { currentKernelClient } from "../../kernel/kernelRegistry";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { PressableScale } from "../../motion/PressableScale";
import { clearMemory, measureMemory, type MemoryUsageEntry } from "../../memory/usage";
import { useMemoryPreferences } from "../../memory/useMemoryPreferences";
import { useProjects } from "../../kernel/projects";
import { documentRootOf, projectIdOfWorkspace } from "../../kernel/workspace";
import { radius, size, space, text, useNibiTheme } from "../../theme";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MemorySettingsScreen() {
  const th = useNibiTheme();
  const projects = useProjects();
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
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="记忆" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        {/* 2.0.1：说明段压成一句。内核按 workspace 分项目记忆（2026-11-21 运营者报告后修正）。 */}
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: th.inkSub }]}>
            记忆按会话的工作区（项目）分开保存。
          </Text>
        </AppearIn>

        <AppearIn delay={staggerDelay(1, 32, 240)}>
          <SectionCard>
            <Row
              icon="sparkles"
              tone="brand"
              title="启用本机记忆"
              detail="关闭后新会话不再读写记忆"
              // 右槽直接放 Switch（与 ui/ToggleRow 同一配色）；写回逻辑保持原样（保存即提示）。
              right={
                <Switch
                  value={preferences.enabled}
                  onValueChange={(enabled) => {
                    setEnabled(enabled);
                    setMessage("记忆设置已保存；对下一个新会话生效。");
                  }}
                  trackColor={{ false: th.surfaceSoft, true: th.brandSoft }}
                  thumbColor={preferences.enabled ? th.brand : th.inkFaint}
                  ios_backgroundColor={th.surfaceSoft}
                />
              }
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard label="已保存的记忆">
            <View style={styles.usageHead}>
              {totalBytes === null ? (
                <Text style={[styles.usageStatus, { color: th.inkFaint }]}>正在读取…</Text>
              ) : totalBytes === 0 ? (
                <Text style={[styles.usageStatus, { color: th.inkFaint }]}>还没有保存记忆。</Text>
              ) : (
                <Text style={[styles.total, { color: th.ink }]}>{formatBytes(totalBytes)}</Text>
              )}
              <PressableScale
                onPress={() => void refresh()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="刷新记忆体量"
                style={[styles.refresh, { backgroundColor: th.surfaceSoft }, busy ? styles.busy : null]}
              >
                {busy ? (
                  <ActivityIndicator color={th.brand} size="small" />
                ) : (
                  <Icon name="refresh" size={14} color={th.inkSub} />
                )}
              </PressableScale>
            </View>
            {totalBytes !== null && totalBytes > 0 ? (
              <View style={styles.usageEntries}>
                {entries.map((entry) => {
                  const root = documentRootOf(Paths.document.uri);
                  const projectId = projectIdOfWorkspace(root, entry.workspacePath);
                  const projectName = projectId
                    ? (projects.projects.find((entry2) => entry2.id === projectId)?.name ?? projectId)
                    : entry.workspacePath.split("/").filter(Boolean).pop() ?? entry.workspacePath;
                  return (
                    <Text key={entry.workspacePath} style={[styles.usageEntry, { color: th.inkFaint }]}>
                      {projectName} · {formatBytes(entry.bytes)}
                    </Text>
                  );
                })}
              </View>
            ) : null}
            <Divider />
            <Row
              icon="trash"
              danger
              title="清空本机记忆"
              detail="删除全部记忆，不影响会话"
              onPress={confirmClear}
            />
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard>
            <Row
              icon="sliders"
              tone="steel"
              title="诊断"
              detail="用量与网络状态"
              onPress={() => router.push("/settings/diagnostics")}
            />
          </SectionCard>
        </AppearIn>

        {message ? (
          <AppearIn delay={staggerDelay(4, 32, 240)}>
            <View style={[styles.message, { backgroundColor: th.card, borderColor: th.hairline }]}>
              <Text style={[styles.messageText, { color: th.inkSub }]}>{message}</Text>
            </View>
          </AppearIn>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  intro: { ...text("small") },
  usageHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2),
  },
  usageStatus: { flex: 1, ...text("small") },
  total: { flex: 1, ...text("title"), fontWeight: "700" },
  usageEntries: {
    gap: space(1),
    paddingHorizontal: space(3.5),
    paddingBottom: space(1.5),
  },

  usageEntry: { ...text("micro") },
  refresh: {
    width: size.chip,
    height: size.chip,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { opacity: 0.6 },
  message: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
  },
  messageText: { ...text("small") },
});
