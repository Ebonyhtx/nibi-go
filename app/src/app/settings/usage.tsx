// 使用统计：应用级 token 用量（总览 / 模型占比 / 每日趋势 / 工具调用）。
//
// 数据来自内核 `v4/usage/stats`（会话无关的应用级查询，strict_keys 只认 range/timeZone，
// 所以 client.usageStats 不带 sessionId）；时区不传——内核用设备偏移把用量归到本地日。
// 范围切换即重拉，重进页面（useFocusEffect）也重拉；失败给一行 amber 提示，重进即重试。

import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
  KernelUsageHeatmapDay,
  KernelUsageRange,
  KernelUsageStats,
} from "@nibi-go/kernel-session";

import { SectionCard } from "../../components/ui/SectionCard";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { currentKernelClient } from "../../kernel/kernelRegistry";
import { AppearIn, staggerDelay } from "../../motion/appear";
import { PressableScale } from "../../motion/PressableScale";
import { radius, space, text, useNibiTheme } from "../../theme";

const RANGES: { key: KernelUsageRange; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
];

/** >=1000 显示 12.3k（与 ConversationList 的 formatTokens 同一条口径）。 */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

export default function UsageScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<KernelUsageRange>("all");
  const [stats, setStats] = useState<KernelUsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 范围切换的竞态保护：只认最后一次请求的回应。
  const loadSeq = useRef(0);
  // focus 重拉读 ref：范围切换不该把 focus 回调换掉（会重触发一次重复拉取）。
  const rangeRef = useRef<KernelUsageRange>("all");

  const load = useCallback(async (target: KernelUsageRange) => {
    const client = currentKernelClient();
    if (!client) {
      setError("内核还没就绪：先回首页，再回来看用量。");
      setStats(null);
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const next = await client.usageStats(target);
      if (seq !== loadSeq.current) return;
      setStats(next);
    } catch (cause) {
      if (seq !== loadSeq.current) return;
      setStats(null);
      setError(`用量统计读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(rangeRef.current);
    }, [load]),
  );

  const switchRange = (next: KernelUsageRange) => {
    if (next === rangeRef.current) return;
    rangeRef.current = next;
    setRange(next);
    void load(next);
  };

  // 模型占比：过滤零 token 行，按 totalTokens 降序。
  const models = [...(stats?.models ?? [])]
    .filter((row) => row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens);
  // 每日趋势：热力图的 days 是从起点到今天的升序日历（含零日），取今天往前最多 14 天。
  const trendDays = (stats?.heatmap.weeks ?? [])
    .flatMap((week) => week.days)
    .filter((day): day is KernelUsageHeatmapDay => day !== null)
    .slice(-14);
  const trendMax = Math.max(...trendDays.map((day) => day.totalTokens), 1);

  const summary = stats?.summary;
  const modelRequests = (stats?.models ?? []).reduce((sum, row) => sum + row.requestCount, 0);
  // 内核只回错误率；把请求数乘回去得到错误数（模型请求无错时为 0）。
  const modelErrors =
    summary && modelRequests > 0 ? Math.round(summary.modelErrorRate * modelRequests) : 0;
  const toolErrors = (stats?.tools ?? []).reduce((sum, row) => sum + row.errorCount, 0);
  const errors = modelErrors + toolErrors;
  const toolCalls = summary?.toolCallCount ?? 0;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScreenHeader title="使用统计" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space(6) }]}>
        {/* 范围切换：分段控件外观照设置首页的外观三段（选中段卡底 + 发丝线 + 轻投影）。 */}
        <AppearIn delay={staggerDelay(0, 32, 240)}>
          <View style={[styles.segTrack, { backgroundColor: th.surfaceSoft }]}>
            {RANGES.map((item) => {
              const active = range === item.key;
              return (
                <PressableScale
                  key={item.key}
                  scaleTo={0.96}
                  onPress={() => switchRange(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`范围：${item.label}`}
                  accessibilityState={{ selected: active }}
                  style={styles.segCellOuter}
                >
                  <View
                    style={[
                      styles.segCell,
                      {
                        backgroundColor: active ? th.card : "transparent",
                        borderColor: active ? th.hairline : "transparent",
                      },
                      ...(active ? [th.elevation.card] : []),
                    ]}
                  >
                    <Text style={[styles.segLabel, { color: active ? th.brand : th.inkSub }]}>
                      {item.label}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </View>
        </AppearIn>

        {loading ? (
          <ActivityIndicator color={th.brand} size="small" style={styles.loading} />
        ) : null}

        {error ? (
          <AppearIn delay={staggerDelay(1, 32, 240)}>
            <View style={[styles.banner, { backgroundColor: th.amberSoft, borderColor: th.hairline }]}>
              <Text style={[styles.bannerText, { color: th.amber }]}>{error}</Text>
            </View>
          </AppearIn>
        ) : null}

        {stats ? (
          <>
            <AppearIn delay={staggerDelay(2, 32, 240)}>
              <SectionCard label="总览">
                <View style={styles.cardBody}>
                  <View style={styles.kv}>
                    <Text style={[styles.kvKey, { color: th.inkFaint }]}>总 tokens</Text>
                    <Text style={[styles.bigValue, { color: th.ink }]}>
                      {formatTokens(summary?.totalTokens ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.kv}>
                    <Text style={[styles.kvKey, { color: th.inkFaint }]}>输入</Text>
                    <Text style={[styles.kvValue, { color: th.ink }]}>
                      {formatTokens(summary?.inputTokens ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.kv}>
                    <Text style={[styles.kvKey, { color: th.inkFaint }]}>输出</Text>
                    <Text style={[styles.kvValue, { color: th.ink }]}>
                      {formatTokens(summary?.outputTokens ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.kv}>
                    <Text style={[styles.kvKey, { color: th.inkFaint }]}>缓存读</Text>
                    <Text style={[styles.kvValue, { color: th.ink }]}>
                      {formatTokens(summary?.cacheReadTokens ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.kv}>
                    <Text style={[styles.kvKey, { color: th.inkFaint }]}>模型请求</Text>
                    <Text style={[styles.kvValue, { color: th.ink }]}>{modelRequests}</Text>
                  </View>
                  <View style={styles.kv}>
                    <Text style={[styles.kvKey, { color: th.inkFaint }]}>回合</Text>
                    <Text style={[styles.kvValue, { color: th.ink }]}>{summary?.totalTurns ?? 0}</Text>
                  </View>
                  <View style={styles.kv}>
                    <Text style={[styles.kvKey, { color: th.inkFaint }]}>会话</Text>
                    <Text style={[styles.kvValue, { color: th.ink }]}>{summary?.totalSessions ?? 0}</Text>
                  </View>
                  {errors > 0 ? (
                    <View style={styles.kv}>
                      <Text style={[styles.kvKey, { color: th.inkFaint }]}>错误</Text>
                      <Text style={[styles.kvValue, { color: th.amber }]}>{errors}</Text>
                    </View>
                  ) : null}
                  {toolCalls > 0 ? (
                    <View style={styles.kv}>
                      <Text style={[styles.kvKey, { color: th.inkFaint }]}>工具调用</Text>
                      <Text style={[styles.kvValue, { color: th.ink }]}>{toolCalls}</Text>
                    </View>
                  ) : null}
                </View>
              </SectionCard>
            </AppearIn>

            <AppearIn delay={staggerDelay(3, 32, 240)}>
              <SectionCard label="模型占比">
                <View style={styles.cardBody}>
                  {models.length === 0 ? (
                    <Text style={[styles.detail, { color: th.inkFaint }]}>暂无数据</Text>
                  ) : (
                    models.map((row, index) => (
                      <View key={`${row.modelId ?? "?"}-${index}`} style={styles.barRow}>
                        <View style={styles.barHead}>
                          <Text numberOfLines={1} style={[styles.barLabel, { color: th.inkSub }]}>
                            {row.modelId ?? "未知模型"}
                          </Text>
                          <Text style={[styles.barValue, { color: th.ink }]}>
                            {formatTokens(row.totalTokens)}
                          </Text>
                        </View>
                        <View style={[styles.barTrack, { backgroundColor: th.surfaceSoft }]}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                width: `${Math.round(row.share * 100)}%`,
                                backgroundColor: index % 2 === 0 ? th.brand : th.steel,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </SectionCard>
            </AppearIn>

            <AppearIn delay={staggerDelay(4, 32, 240)}>
              <SectionCard label="每日趋势">
                <View style={styles.cardBody}>
                  {trendDays.length === 0 ? (
                    <Text style={[styles.detail, { color: th.inkFaint }]}>暂无数据</Text>
                  ) : (
                    trendDays.map((day) => (
                      <View key={day.date} style={styles.barRow}>
                        <View style={styles.barHead}>
                          <Text style={[styles.barLabel, { color: th.inkSub }]}>
                            {day.date.slice(5)}
                          </Text>
                          <Text style={[styles.barValue, { color: th.ink }]}>
                            {formatTokens(day.totalTokens)}
                          </Text>
                        </View>
                        <View style={[styles.barTrackThin, { backgroundColor: th.surfaceSoft }]}>
                          <View
                            style={[
                              styles.barFillThin,
                              {
                                width: `${Math.round((day.totalTokens / trendMax) * 100)}%`,
                                backgroundColor: th.steel,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </SectionCard>
            </AppearIn>

            <AppearIn delay={staggerDelay(5, 32, 240)}>
              <SectionCard label="工具调用">
                <View style={styles.cardBody}>
                  {(stats.tools ?? []).length === 0 ? (
                    <Text style={[styles.detail, { color: th.inkFaint }]}>暂无数据</Text>
                  ) : (
                    stats.tools.slice(0, 8).map((tool) => (
                      <View key={tool.toolName} style={styles.kv}>
                        <Text numberOfLines={1} style={[styles.kvKey, { color: th.inkSub }]}>
                          {tool.toolName}
                        </Text>
                        <Text style={[styles.kvValue, { color: th.ink }]}>
                          {tool.callCount}
                          {tool.errorCount > 0 ? ` · 错 ${tool.errorCount}` : ""}
                          {tool.avgDurationMs !== null
                            ? ` · ${Math.round(tool.avgDurationMs)}ms`
                            : ""}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              </SectionCard>
            </AppearIn>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: space(4), paddingTop: space(2), gap: space(3) },
  segTrack: {
    flexDirection: "row",
    gap: space(1),
    padding: space(1),
    borderRadius: radius.control,
  },
  segCellOuter: { flex: 1 },
  segCell: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segLabel: { ...text("small"), fontWeight: "600" },
  loading: { alignSelf: "center" },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    padding: space(3),
    gap: space(1.5),
  },
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
  barRow: { gap: space(1) },
  barHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  barLabel: { flex: 1, ...text("small") },
  barValue: { ...text("small"), fontWeight: "600" },
  barTrack: { height: space(1.5), borderRadius: radius.chip, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: radius.chip },
  barTrackThin: { height: space(1), borderRadius: radius.chip, overflow: "hidden" },
  barFillThin: { height: "100%", borderRadius: radius.chip },
});
