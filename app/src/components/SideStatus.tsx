// 会话工具悬浮卡：贴屏幕右侧的圆形占用环 + 展开的会话状态面板。
//
// 收起时是带呼吸动效的上下文占用环；子代理在跑时环上方多一枚会眨眼的瓦片脸。
// 点一下向左展开当前会话状态：子智能体（瓦片脸+状态）、待办进度、上下文窗口
// 用量与缓存命中率。整条状态可以上下拖动；插件状态作为次要行保留。

import { useMemoryPreferences } from "../memory/useMemoryPreferences";
import { hostSlotData } from "../plugins/data";
import type { LoadedPlugin } from "../plugins/store";
import { resolveText, type ViewTone } from "@nibi-go/plugin-contract";
import { AgentFace, type AgentFaceStatus } from "./AgentFace";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, Circle, Path } from "@shopify/react-native-skia";

import { Dot } from "./Icon";
import { pickText, useI18n } from "../i18n";
import { haptic } from "../motion/haptics";
import { motion, radius, space, text, useNibiTheme, type NibiTheme } from "../theme";

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  cacheHitRate: number | null;
  /** 内核 /context 分析器的分项（source + chars）；回答“上下文由什么组成”。 */
  breakdown?: readonly { source: string; chars: number }[];
}

/** 本会话的一个子代理（subagent 行 + Agent 工具行归并，运行中排前）。 */
export interface SessionSubagentState {
  key: string;
  name: string;
  status: AgentFaceStatus;
}

/** 最新一次 TodoWrite 的进度快照。 */
export interface SessionTodoState {
  done: number;
  total: number;
  /** in_progress 那条的 activeForm/正文（没有则缺）。 */
  active?: string;
}

/** 会话工具卡的状态面（index.tsx 从会话行派生）。 */
export interface SessionToolState {
  subagents: readonly SessionSubagentState[];
  todos?: SessionTodoState;
}

/** 子代理状态 → 词与色由调用方按主题取；这里给词。 */
export function subagentStatusLabel(status: AgentFaceStatus): string {
  switch (status) {
    case "running":
      return pickText("进行中", "Running");
    case "completed":
      return pickText("已完成", "Done");
    case "failed":
      return pickText("失败", "Failed");
    case "cancelled":
      return pickText("已停止", "Stopped");
    case "waiting":
      return pickText("等待中", "Waiting");
  }
}

/** 内核分项来源 → 面板里的短名。未知来源不吞掉，按原字符串显示。 */
function breakdownLabel(source: string): string {
  switch (source) {
    case "messages":
      return pickText("消息", "Messages");
    case "system_prompt":
      return pickText("系统提示词", "System");
    case "system_tool_schemas":
      return pickText("内置工具", "Built-in");
    case "mcp_tool_schemas":
      return pickText("MCP 工具", "MCP tools");
    case "skills":
      return pickText("技能", "Skills");
    case "meta_user_context":
      return pickText("记忆/其它", "Memory/Misc");
    default:
      return source;
  }
}

function toneColor(t: NibiTheme, tone: ViewTone | undefined): string {
  switch (tone) {
    case "ok":
      return t.ok;
    case "warn":
      return t.amber;
    case "danger":
      return t.red;
    case "brand":
      return t.brand;
    case "sub":
      return t.inkSub;
    default:
      return t.inkFaint;
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }
  return String(value);
}

/**
 * 弧线数值的平滑过渡：用量变化时在 motion.duration.slow 内补间（缓出），
 * 只在变化跨过一个可见阈值时 setState（约 20fps 上限），不跟交互抢帧预算。
 * Skia 的 Path 不能直接吃插值，所以这里走「按帧重算 path」而不是 Reanimated。
 */
function useAnimatedRatio(target: number): number {
  const clampedTarget = Math.max(0, Math.min(1, target));
  const [value, setValue] = useState(clampedTarget);
  const valueRef = useRef(clampedTarget);
  const fromRef = useRef(clampedTarget);
  const startRef = useRef(0);
  useEffect(() => {
    const from = valueRef.current;
    if (Math.abs(from - clampedTarget) < 0.001) {
      valueRef.current = clampedTarget;
      setValue(clampedTarget);
      return;
    }
    fromRef.current = from;
    startRef.current = -1;
    let raf = 0;
    const ticket = (t: number) => {
      if (startRef.current < 0) startRef.current = t;
      const progress = Math.min(1, (t - startRef.current) / motion.duration.slow);
      // ease-out cubic：快起缓停，和 ring 的呼吸感一致
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = fromRef.current + (clampedTarget - fromRef.current) * eased;
      if (Math.abs(next - valueRef.current) >= 0.004 || progress >= 1) {
        valueRef.current = progress >= 1 ? clampedTarget : next;
        setValue(valueRef.current);
      }
      if (progress < 1) raf = requestAnimationFrame(ticket);
    };
    raf = requestAnimationFrame(ticket);
    return () => cancelAnimationFrame(raf);
  }, [clampedTarget]);
  return value;
}

function ContextRing({
  ratio,
  color,
  track,
}: {
  ratio: number;
  color: string;
  track: string;
}) {
  const clamped = useAnimatedRatio(ratio);
  const path = useMemo(() => {
    if (clamped <= 0) return "";
    if (clamped >= 0.995) return "M 10 1.8 A 8.2 8.2 0 1 1 9.99 1.8";
    const angle = clamped * Math.PI * 2 - Math.PI / 2;
    const x = 10 + 8.2 * Math.cos(angle);
    const y = 10 + 8.2 * Math.sin(angle);
    return `M 10 1.8 A 8.2 8.2 0 ${clamped > 0.5 ? 1 : 0} 1 ${x} ${y}`;
  }, [clamped]);
  return (
    <Canvas style={styles.ring}>
      <Circle cx={10} cy={10} r={8.2} color={track} style="stroke" strokeWidth={2.4} />
      {path ? (
        <Path
          path={path}
          color={color}
          style="stroke"
          strokeWidth={2.4}
          strokeCap="round"
        />
      ) : null}
    </Canvas>
  );
}

function SideStatusImpl({
  plugins,
  usage,
  bottom,
  slotData,
  session,
  paused = false,
}: {
  plugins: readonly LoadedPlugin[];
  usage: ContextUsage | null;
  bottom: number;
  /** 插件主动推的槽数据：serverName → slotId → data（槽里绑定 `data.push.*`）。 */
  slotData?: Record<string, Record<string, unknown>>;
  /** 会话工具卡的状态面（子代理/待办）；缺省时只显示上下文。 */
  session?: SessionToolState;
  /** 侧栏展开时暂停环的呼吸/轮播：它在遮罩后面看不见，却会让模糊层每帧重算。 */
  paused?: boolean;
}) {
  const t = useNibiTheme();
  const { pick } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const strips = plugins.flatMap((plugin) =>
    plugin.parsed.manifest.contributes.strips.map((strip) => ({ plugin, strip })),
  );
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  // 垂直拖拽位移直接走 Animated.Value（translateY），拖动全程零 React 重渲染。
  const dragOffsetY = useRef(new Animated.Value(0)).current;
  const committedOffsetRef = useRef(0);
  const bottomRef = useRef(bottom);
  bottomRef.current = bottom;
  const dragStartRef = useRef(0);
  const breathe = useRef(new Animated.Value(0)).current;
  const expand = useRef(new Animated.Value(0)).current;

  const clampOffset = (offset: number): number => {
    const base = bottomRef.current;
    const minBottom = insets.bottom + 72;
    const maxBottom = Math.max(minBottom, screenHeight - insets.top - 96);
    const targetBottom = Math.max(minBottom, Math.min(maxBottom, base - offset));
    return base - targetBottom;
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 3,
        onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dy) > 3,
        onPanResponderGrant: () => {
          dragStartRef.current = committedOffsetRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const next = clampOffset(dragStartRef.current + gesture.dy);
          dragOffsetY.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          const next = clampOffset(dragStartRef.current + gesture.dy);
          committedOffsetRef.current = next;
          dragOffsetY.setValue(next);
        },
        onPanResponderTerminate: () => {
          dragOffsetY.setValue(committedOffsetRef.current);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // clampOffset 只依赖布局尺寸，随 screenHeight/insets 重建。
    [dragOffsetY, screenHeight, insets.top, insets.bottom],
  );

  useEffect(() => {
    if (paused || strips.length <= 1) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % strips.length);
    }, 5_000);
    return () => clearInterval(timer);
  }, [paused, strips.length]);

  useEffect(() => {
    if (paused) {
      breathe.stopAnimation();
      breathe.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1_300,
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1_300,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, paused]);

  useEffect(() => {
    Animated.spring(expand, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 230,
      mass: 0.6,
    }).start();
  }, [expand, expanded]);

  const { preferences: memoryPreferences } = useMemoryPreferences();
  const ratio =
    usage && usage.maxTokens > 0 ? Math.min(1, usage.usedTokens / usage.maxTokens) : 0;
  const meterColor = ratio >= 0.95 ? t.red : ratio >= 0.8 ? t.amber : t.brand;
  const cache =
    usage?.cacheHitRate === null || usage?.cacheHitRate === undefined
      ? "—"
      : `${Math.round(usage.cacheHitRate * 100)}%`;
  // 分项按字符占比排序，只列前 5 项：面板宽度有限，长尾不值得挤进去。
  const breakdown = useMemo(() => {
    const items = usage?.breakdown ?? [];
    const totalChars = items.reduce((sum, item) => sum + item.chars, 0);
    if (totalChars <= 0) return [];
    return [...items]
      .sort((left, right) => right.chars - left.chars)
      .slice(0, 5)
      .map((item) => ({ ...item, share: item.chars / totalChars }));
  }, [usage?.breakdown]);
  const current = strips[Math.min(index, Math.max(0, strips.length - 1))];
  // 槽推送按 manifest 的 runtime.serverName 匹配（内核只认服务器名）；没有 runtime 时退回插件 id。
  const serverName = current
    ? (current.plugin.parsed.manifest.runtime?.serverName ?? current.plugin.parsed.manifest.id)
    : undefined;
  const pushValue = current && serverName ? slotData?.[serverName]?.[current.strip.id] : undefined;
  // prop 的 data 是 unknown：只有对象才当 `data.push`（数组/标量不往槽里塞）。
  const push =
    typeof pushValue === "object" && pushValue !== null && !Array.isArray(pushValue)
      ? (pushValue as Record<string, unknown>)
      : undefined;
  const pluginText = current
    ? resolveText(
        current.strip.text,
        hostSlotData({
          enabledPlugins: plugins.length,
          plugin: {
            id: current.plugin.parsed.manifest.id,
            name: current.plugin.parsed.manifest.name,
            version: current.plugin.parsed.manifest.version,
          },
          settings: current.plugin.settings,
          push,
        }),
      ).trim()
    : "";
  const runningSubagent = session?.subagents.find((sub) => sub.status === "running");
  const runningCount = session?.subagents.filter((sub) => sub.status === "running").length ?? 0;
  const todoPercent =
    session?.todos && session.todos.total > 0
      ? Math.round((session.todos.done / session.todos.total) * 100)
      : 0;

  const subagentStateColor = (status: AgentFaceStatus): string => {
    switch (status) {
      case "running":
      case "waiting":
        return t.amber;
      case "failed":
        return t.red;
      case "cancelled":
        return t.inkFaint;
      default:
        return t.ok;
    }
  };

  const minBottom = insets.bottom + 72;
  const maxBottom = Math.max(minBottom, screenHeight - insets.top - 96);
  const clampedBottom = Math.max(minBottom, Math.min(maxBottom, bottom));

  return (
    <Animated.View
      style={[
        styles.dock,
        { bottom: clampedBottom, right: insets.right, transform: [{ translateY: dragOffsetY }] },
      ]}
      pointerEvents="auto"
      {...pan.panHandlers}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: t.card,
            borderColor: t.hairlineStrong,
            ...t.elevation.menu,
            opacity: expand,
            transform: [
              { translateX: expand.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
              { scale: expand.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          },
        ]}
        pointerEvents={expanded ? "auto" : "none"}
      >
        <Pressable
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel={pick("收起上下文用量", "Collapse context usage")}
          style={styles.pillBody}
        >
          {session && session.subagents.length > 0 ? (
            <View style={styles.sessionBlockFirst}>
              <View style={styles.pillFoot}>
                <Text style={[styles.pillMeta, { color: t.inkFaint }]}>
                  {pick("子智能体", "Subagents")}
                </Text>
                <Text style={[styles.pillMeta, { color: runningCount > 0 ? t.amber : t.inkFaint }]}>
                  {runningCount > 0
                    ? pick(`${runningCount} 个运行中`, `${runningCount} running`)
                    : pick(`共 ${session.subagents.length} 个`, `${session.subagents.length} total`)}
                </Text>
              </View>
              {session.subagents.map((sub) => (
                <View key={sub.key} style={styles.subagentRow}>
                  <AgentFace name={sub.name} status={sub.status} size={18} badge />
                  <Text style={[styles.subagentName, { color: t.ink }]} numberOfLines={1}>
                    {sub.name}
                  </Text>
                  <Text
                    style={[
                      styles.subagentState,
                      { color: subagentStateColor(sub.status) },
                    ]}
                  >
                    {subagentStatusLabel(sub.status)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {session?.todos ? (
            <View
              style={[
                styles.sessionBlock,
                { borderTopColor: t.hairline },
                session.subagents.length === 0 ? styles.sessionBlockFirst : null,
              ]}
            >
              <View style={styles.pillFoot}>
                <Text style={[styles.pillMeta, { color: t.inkFaint }]}>
                  {pick("待办", "Todos")}
                </Text>
                <Text style={[styles.cacheValue, { color: t.inkSub }]}>
                  {session.todos.done}/{session.todos.total}
                </Text>
              </View>
              <View style={[styles.bar, { backgroundColor: t.surfaceSoft, borderColor: t.hairline }]}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${todoPercent}%`, backgroundColor: t.brand },
                  ]}
                />
              </View>
              {session.todos.active ? (
                <Text style={[styles.todoActive, { color: t.inkSub }]} numberOfLines={1}>
                  {session.todos.active}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.pillHead}>
            <View style={styles.pillTitleRow}>
              <View style={[styles.statusDot, { backgroundColor: meterColor }]} />
              <Text style={[styles.pillTitle, { color: t.ink }]}>{pick("上下文", "Context")}</Text>
            </View>
            <Text style={[styles.pillValue, { color: t.inkSub }]}>
              {usage ? `${formatTokens(usage.usedTokens)} / ${formatTokens(usage.maxTokens)}` : "—"}
            </Text>
          </View>
          <View style={[styles.bar, { backgroundColor: t.surfaceSoft, borderColor: t.hairline }]}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round(ratio * 100)}%`, backgroundColor: meterColor },
              ]}
            />
          </View>
          <View style={styles.pillFoot}>
            <Text style={[styles.pillMeta, { color: t.inkFaint }]}>
              {pick("缓存命中率", "Cache hit")}
            </Text>
            <Text style={[styles.cacheValue, { color: t.steel }]}>{cache}</Text>
          </View>
          <View style={styles.pillFoot}>
            <Text style={[styles.pillMeta, { color: t.inkFaint }]}>{pick("记忆", "Memory")}</Text>
            <Text
              style={[
                styles.pillMeta,
                { color: memoryPreferences.enabled ? t.ok : t.inkFaint },
              ]}
            >
              {memoryPreferences.enabled ? pick("开", "On") : pick("关", "Off")}
            </Text>
          </View>
          {breakdown.length > 0 ? (
            <View style={[styles.breakdown, { borderTopColor: t.hairline }]}>
              {breakdown.map((item) => (
                <View key={item.source} style={styles.breakdownRow}>
                  <Text style={[styles.breakdownLabel, { color: t.inkFaint }]} numberOfLines={1}>
                    {breakdownLabel(item.source)}
                  </Text>
                  <View style={[styles.breakdownTrack, { backgroundColor: t.surfaceSoft }]}>
                    <View
                      style={[
                        styles.breakdownFill,
                        { width: `${Math.round(item.share * 100)}%`, backgroundColor: meterColor },
                      ]}
                    />
                  </View>
                  <Text style={[styles.breakdownValue, { color: t.inkSub }]}>
                    {Math.round(item.share * 100)}%
                  </Text>
                </View>
              ))}
              {/* 本地估算与计费口径的差异压成三个字——整句免责占一行不值得（2.0.1 审查）。 */}
              <Text style={[styles.breakdownNote, { color: t.inkGhost }]}>
                {pick("估算值", "Estimated")}
              </Text>
            </View>
          ) : null}
          {pluginText ? (
            <View style={[styles.pluginRow, { borderTopColor: t.hairline }]}>
              <Dot size={5} color={toneColor(t, current?.strip.tone)} />
              <Text style={[styles.pluginText, { color: t.inkFaint }]} numberOfLines={1}>
                {pluginText}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>

      <View style={styles.dockCol}>
        {/* 子代理在跑时环上方亮一枚会眨眼的瓦片脸——不展开也能看到「有代理在干活」。 */}
        {runningSubagent ? (
          <Pressable
            onPress={() => {
              haptic("tick");
              setExpanded(true);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={pick(
              `子智能体 ${runningSubagent.name} 运行中，点按查看会话状态`,
              `Subagent ${runningSubagent.name} running, tap for session status`,
            )}
            style={styles.faceButton}
          >
            <AgentFace name={runningSubagent.name} status="running" size={24} badge />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            haptic("tick");
            setExpanded((value) => !value);
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? pick("收起会话状态，可上下拖动", "Collapse session status, drag vertically")
              : pick(
                  `上下文已用 ${Math.round(ratio * 100)}%，${runningSubagent ? "有子智能体运行中，" : ""}点按查看会话状态，可上下拖动`,
                  `Context ${Math.round(ratio * 100)}% used${runningSubagent ? ", subagent running" : ""}, tap for session status, drag vertically`,
                )
          }
          style={styles.dotButton}
        >
          <Animated.View
            style={[
              styles.dot,
              {
                backgroundColor: t.card,
                borderColor: t.hairlineStrong,
                ...t.elevation.card,
                opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.74, 1] }),
                transform: [
                  { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }) },
                ],
              },
            ]}
          >
            <ContextRing ratio={ratio} color={meterColor} track={t.hairline} />
            <Text style={[styles.percent, { color: t.inkSub }]}>
              {usage ? `${Math.round(ratio * 100)}` : "—"}
            </Text>
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** 抽屉/面板开合等父级状态变化不该重渲染悬浮卡（Skia 环 + 子代理列表）。 */
export const SideStatus = memo(SideStatusImpl);

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    right: 0,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
  },
  dockCol: { alignItems: "center", gap: space(1) },
  faceButton: { padding: 2 },
  sessionBlock: {
    gap: space(1),
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(1),
    paddingBottom: space(0.5),
  },
  sessionBlockFirst: {
    gap: space(1),
    borderTopWidth: 0,
    paddingTop: 0,
    paddingBottom: space(0.5),
  },
  subagentRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  subagentName: { fontSize: 10.5, fontWeight: "600", flexShrink: 1 },
  subagentState: { fontSize: 10, fontWeight: "600" },
  todoActive: { fontSize: 10 },
  dotButton: { width: 32, height: 48, alignItems: "center", justifyContent: "center" },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: { width: 20, height: 20 },
  percent: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 12,
    textAlign: "center",
    fontSize: 6.5,
    fontWeight: "700",
    lineHeight: 8,
  },
  pill: {
    position: "absolute",
    right: 34,
    top: -28,
    width: 236,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
  },
  pillBody: { padding: space(3), gap: space(1.5) },
  pillHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pillTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  pillTitle: { fontSize: 11.5, fontWeight: "700" },
  pillValue: { fontSize: 10.5, fontWeight: "600" },
  bar: {
    height: 6,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: radius.chip },
  pillFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pillMeta: { fontSize: 10 },
  cacheValue: { fontSize: 11, fontWeight: "700" },
  breakdown: {
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(1.5),
  },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  breakdownLabel: { fontSize: 9.5, width: 52 },
  breakdownTrack: { flex: 1, height: 5, borderRadius: radius.chip, overflow: "hidden" },
  breakdownFill: { height: "100%", borderRadius: radius.chip },
  breakdownValue: { fontSize: 9.5, width: 26, textAlign: "right" },
  breakdownNote: { fontSize: 9, marginTop: 1 },
  pluginRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space(1),
  },
  pluginText: { fontSize: 9.5, flexShrink: 1 },
});