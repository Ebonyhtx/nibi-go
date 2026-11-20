// 记忆与链路诊断：缓存命中率、逐轮用量、模型网络状态、记忆抽取请求。
//
// 数据全部来自内核已有的 `session/debug` 与 `sessionData/measure`，不新增内核能力。
// 逐轮 hitRate 的分母是 input_tokens（与会话级上下文面板口径不同），UI 明确标注。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { KernelDebugNetworkEntry, KernelDebugSnapshot } from "@nibi-go/kernel-session";

import { Icon } from "../../components/Icon";
import { currentKernelClient } from "../../kernel/kernelRegistry";
import { measureMemory, type MemoryUsageEntry } from "../../memory/usage";
import { useMemoryPreferences } from "../../memory/useMemoryPreferences";
import { radius, space, type as typeScale, useNibiTheme } from "../../theme";

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(statusType: string): "ok" | "warn" | "bad" | "muted" {
  if (statusType.includes("failed")) return "bad";
  if (statusType.includes("retry") || statusType.includes("stalled")) return "warn";
  if (statusType.includes("completed")) return "ok";
  return "muted";
}

function sourceLabel(entry: KernelDebugNetworkEntry): string {
  const source = entry.querySource ?? entry.queryId ?? "";
  if (source.includes("project_memory_extract")) return "记忆抽取";
  if (source.includes("title")) return "标题";
  if (source) return source;
  return "主回合";
}

export default function DiagnosticsScreen() {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const { preferences } = useMemoryPreferences();
  const [snapshot, setSnapshot] = useState<KernelDebugSnapshot | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<MemoryUsageEntry[]>([]);
  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const run = useCallback(async () => {
    const client = currentKernelClient();
    if (!client) {
      setError("内核会话还没就绪：先回首页打开一个会话，再回来诊断。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const hasSession = client.currentSessionId !== null;
      const [next, memory] = await Promise.all([
        // 没有会话时内核没有可读的 debug 快照；不要把整页打成失败。
        hasSession ? client.debugSnapshot() : Promise.resolve(null),
        measureMemory(client).catch((cause: unknown) => {
          console.warn("[nibigo] 记忆体量读取失败", cause);
          return null;
        }),
      ]);
      setSnapshot(next);
      if (memory) {
        setMemoryEntries(memory.entries);
        setMemoryBytes(memory.totalBytes);
      }
      if (!hasSession) {
        setError("还没有打开的本机会话：先配置模型并新建一个对话；记忆体量仍可查看。");
      }
      setCheckedAt(new Date());
    } catch (cause) {
      setError(`诊断失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  const rounds = snapshot?.rounds ?? [];
  const network = snapshot?.networkEntries ?? [];
  const cache = snapshot?.cache ?? null;
  const extraction = network.filter((entry) => sourceLabel(entry) === "记忆抽取");
  const extractionFailed = extraction.filter((entry) => entry.statusType.includes("failed"));
  const networkIssues = network.filter((entry) => {
    const tone = statusTone(entry.statusType);
    return tone === "bad" || tone === "warn";
  });
  const lastRound = rounds[rounds.length - 1];
  const cacheTone =
    cache?.hitRate === null || cache?.hitRate === undefined
      ? t.inkFaint
      : cache.hitRate >= 0.7
        ? t.ok
        : cache.hitRate >= 0.4
          ? t.amber
          : t.red;
  const warnings: string[] = [];
  if (preferences.enabled && rounds.length >= 2 && cache?.hitRate !== null && cache?.hitRate !== undefined && cache.hitRate < 0.5) {
    warnings.push(
      "缓存命中率偏低：先确认这是同一会话的连续对话；如果记忆/系统提示每轮都在变，前缀缓存会反复失效。",
    );
  }
  if (extractionFailed.length > 0) {
    warnings.push(
      `记忆抽取有 ${extractionFailed.length} 次失败；主回合不受影响，但本轮记忆不会更新。`,
    );
  }
  if (networkIssues.length > 0) {
    warnings.push(`模型链路有 ${networkIssues.length} 条失败/重试/停滞记录，见下方网络状态。`);
  }
  if (!preferences.enabled && (memoryBytes ?? 0) > 0) {
    warnings.push("记忆已关闭，但磁盘上仍有历史记忆；新会话不会再注入，需要时可回记忆页清空。");
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
        <Text style={[styles.title, { color: t.ink }]}>记忆与链路诊断</Text>
        <Pressable
          onPress={() => void run()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="重新诊断"
          style={[styles.back, { backgroundColor: t.panel, opacity: loading ? 0.6 : 1 }]}
        >
          {loading ? (
            <ActivityIndicator color={t.brand} />
          ) : (
            <Icon name="refresh" size={16} color={t.inkSub} />
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        <Text style={[styles.intro, { color: t.inkSub }]}>
          诊断只看本机事实，不会改动会话。逐轮命中率的口径是 cacheRead / input_tokens，
          与右侧上下文面板的会话级口径不同。
        </Text>

        {error ? (
          <View style={[styles.message, { backgroundColor: t.amberSoft, borderColor: t.hairline }]}>
            <Text style={[styles.messageText, { color: t.amber }]}>{error}</Text>
          </View>
        ) : null}

        {warnings.length > 0 ? (
          <View style={[styles.card, { backgroundColor: t.amberSoft, borderColor: t.hairline }]}>
            <Text style={[styles.cardTitle, { color: t.amber }]}>需要复查</Text>
            {warnings.map((warning) => (
              <Text key={warning} style={[styles.detail, { color: t.amber }]}>
                · {warning}
              </Text>
            ))}
          </View>
        ) : rounds.length > 0 || cache !== null || network.length > 0 ? (
          <View style={[styles.card, { backgroundColor: t.okSoft, borderColor: t.hairline }]}>
            <Text style={[styles.cardTitle, { color: t.ok }]}>未发现异常</Text>
            <Text style={[styles.detail, { color: t.ok }]}>
              记忆开关、缓存与模型链路都有可读数据；继续正常对话即可。
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: t.panel, borderColor: t.hairline }]}>
            <Text style={[styles.cardTitle, { color: t.inkSub }]}>还没有可诊断的回合</Text>
            <Text style={[styles.detail, { color: t.inkFaint }]}>
              先发一条消息，让内核产生一轮用量与模型网络状态；记忆占用仍可在这里查看。
            </Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <Text style={[styles.cardTitle, { color: t.ink }]}>记忆</Text>
          <View style={styles.kv}>
            <Text style={[styles.key, { color: t.inkFaint }]}>开关</Text>
            <Text style={[styles.value, { color: preferences.enabled ? t.ok : t.inkSub }]}>
              {preferences.enabled ? "开启（本机共享）" : "关闭"}
            </Text>
          </View>
          <View style={styles.kv}>
            <Text style={[styles.key, { color: t.inkFaint }]}>磁盘占用</Text>
            <Text style={[styles.value, { color: t.ink }]}>
              {memoryBytes === null ? "—" : memoryBytes === 0 ? "没有保存记忆" : formatBytes(memoryBytes)}
            </Text>
          </View>
          {memoryEntries.map((entry) => (
            <View key={entry.workspacePath} style={styles.kv}>
              <Text style={[styles.key, { color: t.inkGhost }]} numberOfLines={1}>
                {entry.workspacePath}
              </Text>
              <Text style={[styles.value, { color: t.inkFaint }]}>{formatBytes(entry.bytes)}</Text>
            </View>
          ))}
          <View style={styles.kv}>
            <Text style={[styles.key, { color: t.inkFaint }]}>抽取请求</Text>
            <Text
              style={[
                styles.value,
                { color: extractionFailed.length > 0 ? t.red : extraction.length > 0 ? t.ok : t.inkFaint },
              ]}
            >
              {extraction.length === 0
                ? "本次会话还没有"
                : `${extraction.length} 次${extractionFailed.length > 0 ? `（失败 ${extractionFailed.length}）` : "，全部成功"}`}
            </Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <Text style={[styles.cardTitle, { color: t.ink }]}>缓存</Text>
          <View style={styles.kv}>
            <Text style={[styles.key, { color: t.inkFaint }]}>累计命中率</Text>
            <Text style={[styles.bigValue, { color: cacheTone }]}>
              {percent(cache?.hitRate ?? null)}
            </Text>
          </View>
          <Text style={[styles.detail, { color: t.inkFaint }]}>
            {cache
              ? `${cache.hitRateRequestCount} 轮 · 输入 ${cache.totalInputTokens} · 命中 ${cache.totalCacheReadTokens}`
              : "还没有可统计的回合"}
          </Text>
          {lastRound ? (
            <Text style={[styles.detail, { color: t.inkFaint }]}>
              最近一轮：输入 {lastRound.usage.inputTokens} · 输出 {lastRound.usage.outputTokens} ·
              缓存读 {lastRound.usage.cachedInputTokens} · 命中 {percent(lastRound.hitRate)}
            </Text>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <Text style={[styles.cardTitle, { color: t.ink }]}>逐轮用量</Text>
          {rounds.length === 0 ? (
            <Text style={[styles.detail, { color: t.inkFaint }]}>还没有结束的回合。</Text>
          ) : (
            rounds
              .slice(-8)
              .reverse()
              .map((round) => (
                <View key={round.eventKey} style={styles.roundRow}>
                  <Text style={[styles.roundIndex, { color: t.inkFaint }]}>#{round.requestIndex}</Text>
                  <Text style={[styles.roundCell, { color: t.inkSub }]}>
                    入 {round.usage.inputTokens}
                  </Text>
                  <Text style={[styles.roundCell, { color: t.inkSub }]}>
                    出 {round.usage.outputTokens}
                  </Text>
                  <Text style={[styles.roundCell, { color: t.inkSub }]}>
                    缓存读 {round.usage.cachedInputTokens}
                  </Text>
                  <Text style={[styles.roundRate, { color: t.ink }]}>{percent(round.hitRate)}</Text>
                </View>
              ))
          )}
        </View>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
          <Text style={[styles.cardTitle, { color: t.ink }]}>模型网络状态</Text>
          {network.length === 0 ? (
            <Text style={[styles.detail, { color: t.inkFaint }]}>还没有模型请求记录。</Text>
          ) : (
            network
              .slice(-12)
              .reverse()
              .map((entry) => {
                const tone = statusTone(entry.statusType);
                const color =
                  tone === "bad" ? t.red : tone === "warn" ? t.amber : tone === "ok" ? t.ok : t.inkFaint;
                return (
                  <View key={entry.eventKey} style={styles.networkRow}>
                    <Text style={[styles.networkStatus, { color }]}>{entry.statusType}</Text>
                    <Text style={[styles.networkMeta, { color: t.inkFaint }]} numberOfLines={1}>
                      {sourceLabel(entry)} · {entry.modelId || entry.providerId} · 尝试 {entry.attempt}/
                      {entry.maxAttempts}
                      {entry.statusCode ? ` · HTTP ${entry.statusCode}` : ""}
                      {entry.durationMs !== undefined ? ` · ${entry.durationMs}ms` : ""}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </Text>
                  </View>
                );
              })
          )}
        </View>

        <Text style={[styles.footnote, { color: t.inkGhost }]}>
          {checkedAt ? `检查于 ${checkedAt.toLocaleTimeString()}` : "尚未检查"} ·
          记忆抽取是旁路请求，失败不会中断主回合。
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
  intro: { fontSize: 11.5, lineHeight: 18 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
    gap: space(2),
  },
  cardTitle: { fontSize: 13, fontWeight: "700" },
  detail: { fontSize: 10.5, lineHeight: 16 },
  message: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: space(3) },
  messageText: { fontSize: 12, lineHeight: 18 },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  key: { fontSize: 10.5, flex: 1 },
  value: { fontSize: 11, fontWeight: "600" },
  bigValue: { fontSize: 22, fontWeight: "700" },
  roundRow: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  roundIndex: { fontSize: 10, width: 28 },
  roundCell: { fontSize: 9.5, flex: 1 },
  roundRate: { fontSize: 10, fontWeight: "700", width: 40, textAlign: "right" },
  networkRow: { gap: 1 },
  networkStatus: { fontSize: 10, fontWeight: "700" },
  networkMeta: { fontSize: 9.5, lineHeight: 14 },
  footnote: { fontSize: 10, lineHeight: 15 },
});
