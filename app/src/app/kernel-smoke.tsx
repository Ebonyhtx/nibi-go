// C0 冒烟页：验证进程内内核（libnibi.so）能否加载、报 ABI、start/stop。
// 仅做设备侧事实确认，不是产品界面；Phase C 正式宿主（会话/工具面）另起。
// 入口：深链 nibigo://kernel-smoke。

import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  destroyKernelHost,
  kernelHostAbiVersion,
  kernelHostAvailable,
  kernelHostLoadError,
  onKernelError,
  onKernelLine,
  startKernelHost,
  stopKernelHost,
} from "nibi-kernel-host";

import { useNibiTheme } from "../theme";

type Line = { id: number; kind: "line" | "error" | "info"; text: string };

export default function KernelSmokeScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [available] = useState(() => kernelHostAvailable());
  const [abi] = useState(() => kernelHostAbiVersion());
  const [loadError] = useState(() => kernelHostLoadError());
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    let nextId = 0;
    const append = (kind: Line["kind"], text: string) =>
      setLines((prev) => [...prev.slice(-199), { id: nextId++, kind, text }]);
    const offLine = onKernelLine((line) => append("line", line));
    const offError = onKernelError((message) => append("error", message));
    append("info", "已订阅内核输出；start 后这里会出现协议帧");
    return () => {
      offLine();
      offError();
      destroyKernelHost();
    };
  }, []);

  const presses = {
    async start() {
      const ok = await startKernelHost();
      setStarted(ok);
      setLines((prev) => [...prev, { id: prev.length, kind: "info", text: `start() → ${ok}` }]);
    },
    stop() {
      const ok = stopKernelHost();
      setStarted(false);
      setLines((prev) => [...prev, { id: prev.length, kind: "info", text: `stop() → ${ok}` }]);
    },
    destroy() {
      destroyKernelHost();
      setStarted(false);
      setLines((prev) => [...prev, { id: prev.length, kind: "info", text: "destroy() 已调用" }]);
    },
  };

  return (
    <View style={[styles.root, { backgroundColor: th.bg, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: th.steel }]}>‹ 返回</Text>
        </Pressable>
        <Text style={[styles.title, { color: th.ink }]}>内核冒烟</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={[styles.card, { backgroundColor: th.card, borderColor: th.hairline }]}>
        <Row label="模块可用" value={available ? "是" : "否"} tone={available ? th.ok : th.red} />
        <Row label="C ABI 版本" value={abi >= 0 ? `v${abi}` : "不可用"} tone={abi >= 0 ? th.ink : th.red} />
        <Row label="内核状态" value={started ? "运行中" : "未启动"} tone={started ? th.ok : th.inkSub} />
        {loadError ? (
          <Text style={[styles.error, { color: th.red }]} selectable>
            加载失败：{loadError}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Action label="启动" onPress={presses.start} color={th.brand} fg={th.brandFg} />
        <Action label="停止" onPress={presses.stop} color={th.panel} fg={th.ink} />
        <Action label="释放" onPress={presses.destroy} color={th.panel} fg={th.ink} />
      </View>

      <ScrollView style={[styles.log, { borderColor: th.hairline }]} contentContainerStyle={{ padding: 10 }}>
        {lines.map((line) => (
          <Text
            key={line.id}
            selectable
            style={[
              styles.line,
              {
                color:
                  line.kind === "error" ? th.red : line.kind === "info" ? th.inkFaint : th.inkSub,
              },
            ]}
          >
            {line.text}
          </Text>
        ))}
        {lines.length === 0 ? (
          <Text style={[styles.line, { color: th.inkFaint }]}>（暂无输出）</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: tone }]}>{value}</Text>
    </View>
  );
}

function Action({
  label,
  onPress,
  color,
  fg,
}: {
  label: string;
  onPress: () => void;
  color: string;
  fg: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.action, { backgroundColor: color }]}>
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { fontSize: 15, fontWeight: "600", width: 48 },
  title: { fontSize: 16, fontWeight: "700" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { fontSize: 13, opacity: 0.6 },
  rowValue: { fontSize: 13, fontWeight: "600" },
  error: { fontSize: 12, marginTop: 4 },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  actionText: { fontSize: 14, fontWeight: "700" },
  log: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginBottom: 12 },
  line: { fontSize: 11, fontFamily: "monospace", marginBottom: 2 },
});
