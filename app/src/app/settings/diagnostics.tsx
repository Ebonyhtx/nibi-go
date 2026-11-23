// 记忆与链路诊断：缓存命中率、逐轮用量、模型网络状态、记忆抽取请求。
//
// 数据全部来自内核已有的 `session/debug` 与 `sessionData/measure`，不新增内核能力。
// 逐轮 hitRate 的分母是 input_tokens（与会话级上下文面板口径不同），UI 明确标注。
// 2.0：ScreenHeader + 数据卡改 SectionCard；状态横幅仍用 soft 底（amber/ok/panel）。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { KernelDebugNetworkEntry, KernelDebugSnapshot } from "@nibi-go/kernel-session";

import { Icon } from "../../components/Icon";
import { SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { useI18n } from "../../i18n";
import { currentKernelClient } from "../../kernel/kernelRegistry";
import { useResponsiveBodyStyle } from "../../layout/responsive";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { PressableScale } from "../../motion/PressableScale";
import { measureMemory, type MemoryUsageEntry } from "../../memory/usage";
import { useMemoryPreferences } from "../../memory/useMemoryPreferences";
import { radius, size, space, text, useNibiTheme } from "../../theme";

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const clamped = Math.max(0, Math.min(1, value));
  return `${Math.round(clamped * 100)}%`;
}

/**
 * 内核 `Usage.input_tokens` 存的是「未命中缓存的新输入」（OpenAI 适配器已做 `input - cached` 归一化，
 * 与 Anthropic 口径一致），因此单轮真实总输入 = `inputTokens + cachedInputTokens + cachedWriteInputTokens`。
 * 旧 `session/debug` 直接用 `cached / uncachedInput` 会算出 >100%（如 2242%），这里按真实总输入归一。
 */
function roundTotalInputOf(usage: {
  inputTokens: number;
  cachedInputTokens: number;
  cachedWriteInputTokens?: number;
}): number {
  return (
    Math.max(0, usage.inputTokens) +
    Math.max(0, usage.cachedInputTokens) +
    Math.max(0, usage.cachedWriteInputTokens ?? 0)
  );
}

function roundHitRateOf(usage: {
  inputTokens: number;
  cachedInputTokens: number;
  cachedWriteInputTokens?: number;
}): number | null {
  const total = roundTotalInputOf(usage);
  return total > 0 ? Math.min(1, Math.max(0, usage.cachedInputTokens) / total) : null;
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

function entrySourceOf(entry: KernelDebugNetworkEntry): string {
  return entry.querySource ?? entry.queryId ?? "";
}

function isMemoryExtractionSource(source: string): boolean {
  return source.includes("project_memory_extract");
}

function sourceLabel(
  entry: KernelDebugNetworkEntry,
  pick: <T = string>(zh: T, en: T) => T,
): string {
  const source = entrySourceOf(entry);
  if (isMemoryExtractionSource(source)) return pick("记忆抽取", "Memory extraction");
  if (source.includes("title")) return pick("标题", "Title");
  if (source) return source;
  return pick("主回合", "Main turn");
}

type DiagnosticError =
  | { kind: "no-client" }
  | { kind: "no-session" }
  | { kind: "failed"; detail: string };

export default function DiagnosticsScreen() {
  const th = useNibiTheme();
  const { pick, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const bodyStyle = useResponsiveBodyStyle({
    paddingTop: space(2),
    paddingBottom: insets.bottom + space(6),
    gap: space(3),
  });
  const { preferences } = useMemoryPreferences();
  const [snapshot, setSnapshot] = useState<KernelDebugSnapshot | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<MemoryUsageEntry[]>([]);
  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DiagnosticError | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const run = useCallback(async () => {
    const client = currentKernelClient();
    if (!client) {
      setError({ kind: "no-client" });
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
        setError({ kind: "no-session" });
      }
      setCheckedAt(new Date());
    } catch (cause) {
      setError({
        kind: "failed",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  const errorText =
    error === null
      ? null
      : error.kind === "no-client"
        ? pick(
            "内核会话还没就绪：先回首页打开一个会话，再回来诊断。",
            "Kernel session is not ready yet. Open a session from Home and retry.",
          )
        : error.kind === "no-session"
          ? pick(
              "还没有打开的会话：先配置模型并新建对话；记忆数据仍可查看。",
              "No open session yet. Configure a model and start a chat; memory data is still available.",
            )
          : pick(`诊断失败：${error.detail}`, `Diagnostics failed: ${error.detail}`);

  const rounds = snapshot?.rounds ?? [];
  const network = snapshot?.networkEntries ?? [];
  const cache = snapshot?.cache ?? null;
  const extraction = network.filter((entry) => isMemoryExtractionSource(entrySourceOf(entry)));
  const extractionFailed = extraction.filter((entry) => entry.statusType.includes("failed"));
  const networkIssues = network.filter((entry) => {
    const tone = statusTone(entry.statusType);
    return tone === "bad" || tone === "warn";
  });
  const lastRound = rounds[rounds.length - 1];
  const totalCacheWriteTokens = rounds.reduce(
    (sum, r) => sum + Math.max(0, r.usage.cachedWriteInputTokens ?? 0),
    0,
  );
  const cumulativeTotalInput = cache
    ? Math.max(0, cache.totalInputTokens) +
      Math.max(0, cache.totalCacheReadTokens) +
      totalCacheWriteTokens
    : 0;
  const cumulativeHitRate =
    cache && cumulativeTotalInput > 0
      ? Math.min(1, Math.max(0, cache.totalCacheReadTokens) / cumulativeTotalInput)
      : null;
  const cacheTone =
    cumulativeHitRate === null
      ? th.inkFaint
      : cumulativeHitRate >= 0.7
        ? th.ok
        : cumulativeHitRate >= 0.4
          ? th.amber
          : th.red;
  const warnings: string[] = [];
  if (
    preferences.enabled &&
    rounds.length >= 2 &&
    cumulativeHitRate !== null &&
    cumulativeHitRate < 0.5
  ) {
    warnings.push(
      pick(
        "缓存命中率偏低：先确认这是同一会话的连续对话；如果记忆/系统提示每轮都在变，前缀缓存会反复失效。",
        "Low cache hit rate: confirm this is a continuous session. If memory or system prompts change every turn, prefix caching will keep missing.",
      ),
    );
  }
  if (extractionFailed.length > 0) {
    warnings.push(
      pick(
        `记忆抽取有 ${extractionFailed.length} 次失败；主回合不受影响，但本轮记忆不会更新。`,
        `Memory extraction failed ${extractionFailed.length} time(s). Main turns are unaffected, but memory will not update.`,
      ),
    );
  }
  if (networkIssues.length > 0) {
    warnings.push(
      pick(
        `模型链路有 ${networkIssues.length} 条失败/重试/停滞记录，见下方网络状态。`,
        `${networkIssues.length} failure/retry/stall event(s) in the model pipeline. See network status below.`,
      ),
    );
  }
  if (!preferences.enabled && (memoryBytes ?? 0) > 0) {
    warnings.push(
      pick(
        "记忆已关闭，但磁盘上仍有历史记忆；新会话不会再注入，需要时可回记忆页清空。",
        "Memory is off, but historical files remain on disk. New sessions will not load them; clear them on the Memory page if needed.",
      ),
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
      <ScreenHeader
        title={pick("诊断", "Diagnostics")}
        onBack={() => router.back()}
        right={
          // 头部右槽刷新：与 ScreenHeader 返回钮同一档玻璃圆钮。
          <PressableScale
            onPress={() => void run()}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={pick("重新诊断", "Re-run diagnostics")}
            hitSlop={8}
            style={[
              styles.headButton,
              { backgroundColor: th.glass, borderColor: th.glassBorder },
              loading ? styles.busy : null,
            ]}
          >
            {loading ? (
              <ActivityIndicator color={th.brand} size="small" />
            ) : (
              <Icon name="refresh" size={16} color={th.ink} />
            )}
          </PressableScale>
        }
      />

      <ScrollView contentContainerStyle={bodyStyle}>
        {/* 2.0.1：页顶只留一句（只读性质）；「cacheRead / input_tokens 口径」是实现细节，删。 */}
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <Text style={[styles.intro, { color: th.inkSub }]}>
            {pick("只读本机数据，不改动会话。", "Read-only local diagnostics; sessions are not modified.")}
          </Text>
        </AppearIn>

        {errorText ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <View style={[styles.banner, { backgroundColor: th.amberSoft, borderColor: th.hairline }]}>
              <Text style={[styles.bannerText, { color: th.amber }]}>{errorText}</Text>
            </View>
          </AppearIn>
        ) : null}

        {warnings.length > 0 ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <View style={[styles.banner, { backgroundColor: th.amberSoft, borderColor: th.hairline }]}>
              <Text style={[styles.bannerTitle, { color: th.amber }]}>
                {pick("需要复查", "Needs attention")}
              </Text>
              {warnings.map((warning) => (
                <Text key={warning} style={[styles.bannerText, { color: th.amber }]}>
                  · {warning}
                </Text>
              ))}
            </View>
          </AppearIn>
        ) : rounds.length > 0 || cache !== null || network.length > 0 ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <View style={[styles.banner, { backgroundColor: th.okSoft, borderColor: th.hairline }]}>
              <Text style={[styles.bannerTitle, { color: th.ok }]}>
                {pick("未发现异常", "All clear")}
              </Text>
              <Text style={[styles.bannerText, { color: th.ok }]}>
                {pick(
                  "记忆开关、缓存与模型链路都有可读数据；继续正常对话即可。",
                  "Memory settings, cache metrics, and model network status all look healthy.",
                )}
              </Text>
            </View>
          </AppearIn>
        ) : (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <View style={[styles.banner, { backgroundColor: th.panel, borderColor: th.hairline }]}>
              <Text style={[styles.bannerTitle, { color: th.inkSub }]}>
                {pick("还没有可诊断的回合", "No turns to diagnose yet")}
              </Text>
              <Text style={[styles.bannerText, { color: th.inkFaint }]}>
                {pick(
                  "发一条消息后，这里会出现用量与网络状态。",
                  "Send a message to see token usage and network status here.",
                )}
              </Text>
            </View>
          </AppearIn>
        )}

        <AppearIn delay={staggerDelay(2, 32, 240)}>
          <SectionCard label={pick("记忆", "Memory")}>
            <View style={styles.cardBody}>
              <View style={styles.kv}>
                <Text style={[styles.kvKey, { color: th.inkFaint }]}>
                  {pick("开关", "Enabled")}
                </Text>
                <Text style={[styles.kvValue, { color: preferences.enabled ? th.ok : th.inkSub }]}>
                  {preferences.enabled ? pick("开启", "On") : pick("关闭", "Off")}
                </Text>
              </View>
              <View style={styles.kv}>
                <Text style={[styles.kvKey, { color: th.inkFaint }]}>
                  {pick("磁盘占用", "Disk usage")}
                </Text>
                <Text style={[styles.kvValue, { color: th.ink }]}>
                  {memoryBytes === null
                    ? "—"
                    : memoryBytes === 0
                      ? pick("暂无数据", "No data")
                      : formatBytes(memoryBytes)}
                </Text>
              </View>
              {memoryEntries.map((entry) => (
                <View key={entry.workspacePath} style={styles.kv}>
                  <Text style={[styles.kvKey, { color: th.inkGhost }]} numberOfLines={1}>
                    {entry.workspacePath}
                  </Text>
                  <Text style={[styles.kvValue, { color: th.inkFaint }]}>{formatBytes(entry.bytes)}</Text>
                </View>
              ))}
              <View style={styles.kv}>
                <Text style={[styles.kvKey, { color: th.inkFaint }]}>
                  {pick("记忆写入", "Memory writes")}
                </Text>
                <Text
                  style={[
                    styles.kvValue,
                    { color: extractionFailed.length > 0 ? th.red : extraction.length > 0 ? th.ok : th.inkFaint },
                  ]}
                >
                  {extraction.length === 0
                    ? pick("本次会话还没有", "None in this session")
                    : pick(
                        `${extraction.length} 次${extractionFailed.length > 0 ? `（失败 ${extractionFailed.length}）` : "，全部成功"}`,
                        `${extraction.length}${extractionFailed.length > 0 ? ` (${extractionFailed.length} failed)` : ", all succeeded"}`,
                      )}
                </Text>
              </View>
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(3, 32, 240)}>
          <SectionCard label={pick("缓存", "Cache")}>
            <View style={styles.cardBody}>
              <View style={styles.kv}>
                <Text style={[styles.kvKey, { color: th.inkFaint }]}>
                  {pick("累计命中率", "Cumulative hit rate")}
                </Text>
                {/* 大号百分比用 title 字阶，色相随命中档位走。 */}
                <Text style={[styles.bigValue, { color: cacheTone }]}>
                  {percent(cumulativeHitRate)}
                </Text>
              </View>
              <Text style={[styles.detail, { color: th.inkFaint }]}>
                {cache
                  ? pick(
                      `${cache.hitRateRequestCount} 轮 · 总输入 ${cumulativeTotalInput}（新输入 ${cache.totalInputTokens}） · 缓存命中 ${cache.totalCacheReadTokens}`,
                      `${cache.hitRateRequestCount} reqs · Total in ${cumulativeTotalInput} (new ${cache.totalInputTokens}) · Cache hit ${cache.totalCacheReadTokens}`,
                    )
                  : pick("暂无数据", "No data")}
              </Text>
              {lastRound ? (
                <Text style={[styles.detail, { color: th.inkFaint }]}>
                  {pick(
                    `最近一轮：总输入 ${roundTotalInputOf(lastRound.usage)} · 输出 ${lastRound.usage.outputTokens} · 缓存读 ${lastRound.usage.cachedInputTokens} · 命中 ${percent(roundHitRateOf(lastRound.usage))}`,
                    `Latest turn: In ${roundTotalInputOf(lastRound.usage)} · Out ${lastRound.usage.outputTokens} · Cache ${lastRound.usage.cachedInputTokens} · Hit ${percent(roundHitRateOf(lastRound.usage))}`,
                  )}
                </Text>
              ) : null}
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(4, 32, 240)}>
          <SectionCard label={pick("逐轮用量", "Per-turn usage")}>
            <View style={styles.cardBody}>
              {rounds.length === 0 ? (
                <Text style={[styles.detail, { color: th.inkFaint }]}>
                  {pick("暂无数据", "No data")}
                </Text>
              ) : (
                rounds
                  .slice(-8)
                  .reverse()
                  .map((round) => (
                    <View key={round.eventKey} style={styles.roundRow}>
                      <Text style={[styles.roundIndex, { color: th.inkFaint }]}>#{round.requestIndex}</Text>
                      <Text style={[styles.roundCell, { color: th.inkSub }]}>
                        {pick(`入 ${roundTotalInputOf(round.usage)}`, `In ${roundTotalInputOf(round.usage)}`)}
                      </Text>
                      <Text style={[styles.roundCell, { color: th.inkSub }]}>
                        {pick(`出 ${round.usage.outputTokens}`, `Out ${round.usage.outputTokens}`)}
                      </Text>
                      <Text style={[styles.roundCell, { color: th.inkSub }]}>
                        {pick(`缓存读 ${round.usage.cachedInputTokens}`, `Cache ${round.usage.cachedInputTokens}`)}
                      </Text>
                      <Text style={[styles.roundRate, { color: th.ink }]}>
                        {percent(roundHitRateOf(round.usage))}
                      </Text>
                    </View>
                  ))
              )}
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(5, 32, 240)}>
          <SectionCard label={pick("模型网络状态", "Model network status")}>
            <View style={styles.cardBody}>
              {network.length === 0 ? (
                <Text style={[styles.detail, { color: th.inkFaint }]}>
                  {pick("暂无数据", "No data")}
                </Text>
              ) : (
                network
                  .slice(-12)
                  .reverse()
                  .map((entry) => {
                    const tone = statusTone(entry.statusType);
                    const color =
                      tone === "bad" ? th.red : tone === "warn" ? th.amber : tone === "ok" ? th.ok : th.inkFaint;
                    return (
                      <View key={entry.eventKey} style={styles.networkRow}>
                        <Text style={[styles.networkStatus, { color }]}>{entry.statusType}</Text>
                        <Text style={[styles.networkMeta, { color: th.inkFaint }]} numberOfLines={1}>
                          {sourceLabel(entry, pick)} · {entry.modelId || entry.providerId} ·{" "}
                          {pick("尝试", "Attempt")} {entry.attempt}/{entry.maxAttempts}
                          {entry.statusCode ? ` · HTTP ${entry.statusCode}` : ""}
                          {entry.durationMs !== undefined ? ` · ${entry.durationMs}ms` : ""}
                          {entry.reason ? ` · ${entry.reason}` : ""}
                        </Text>
                      </View>
                    );
                  })
              )}
            </View>
          </SectionCard>
        </AppearIn>

        <AppearIn delay={staggerDelay(6, 32, 240)}>
          <Text style={[styles.footnote, { color: th.inkGhost }]}>
            {checkedAt
              ? pick(
                  `检查于 ${checkedAt.toLocaleTimeString(locale)}`,
                  `Checked at ${checkedAt.toLocaleTimeString(locale)}`,
                )
              : pick("尚未检查", "Not checked yet")}
          </Text>
        </AppearIn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headButton: {
    width: size.button,
    height: size.button,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { opacity: 0.6 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  intro: { ...text("small") },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
    gap: space(1.5),
  },
  bannerTitle: { ...text("body"), fontWeight: "700" },
  bannerText: { ...text("small") },
  cardBody: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    gap: space(2),
  },
  detail: { ...text("small") },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  kvKey: { flex: 1, ...text("small") },
  kvValue: { ...text("small"), fontWeight: "600" },
  bigValue: { ...text("title"), fontWeight: "700" },
  roundRow: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  roundIndex: { ...text("micro"), width: space(7) },
  roundCell: { ...text("micro"), flex: 1 },
  roundRate: { ...text("micro"), fontWeight: "700", width: space(10), textAlign: "right" },
  networkRow: { gap: space(0.25) },
  networkStatus: { ...text("micro"), fontWeight: "700" },
  networkMeta: { ...text("micro") },
  footnote: { ...text("micro") },
});
