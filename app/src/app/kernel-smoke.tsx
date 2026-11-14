// C0 冒烟页：验证进程内内核（libnibi.so）能否加载、报 ABI、start/stop。
// 仅做设备侧事实确认，不是产品界面；Phase C 正式宿主（会话/工具面）另起。
// 入口：深链 nibigo://kernel-smoke。

import { Paths } from "expo-file-system";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  destroyKernelHost,
  kernelHostAbiVersion,
  kernelHostAvailable,
  kernelHostLoadError,
  onKernelError,
  onKernelLine,
  sendKernelLine,
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const requestId = useRef(1);

  useEffect(() => {
    let nextId = 0;
    const append = (kind: Line["kind"], text: string) =>
      setLines((prev) => [...prev.slice(-199), { id: nextId++, kind, text }]);
    const offLine = onKernelLine((line) => {
      // dev 冒烟页：整帧打到 Metro 日志，便于看完整协议（屏幕只显示最后 200 行）。
      console.log("[kernel-frame]", line);
      append("line", line);
      try {
        const frame = JSON.parse(line) as {
          id?: unknown;
          method?: unknown;
          result?: { session?: { sessionId?: unknown } };
        };
        const createdId = frame.result?.session?.sessionId;
        if (typeof createdId === "string") setSessionId(createdId);
        // 内核 → 宿主的请求：建会话时它会问运行期偏好（nibiSessionRuntimePreferencesResultSchema）。
        // 这里回最小可用集合；正式宿主（C1）按设置页与模型配置填全。
        if (
          typeof frame.id === "string" &&
          frame.method === "session/requestRuntimePreferences"
        ) {
          const reply = {
            id: frame.id,
            result: { nativeSearchEnhancementsEnabled: false },
          };
          const ok = sendKernelLine(JSON.stringify(reply));
          append("info", `reply ${frame.id} runtimePreferences → ${ok}`);
        }
      } catch {
        // 非 JSON 行（少见）按纯文本显示即可。
      }
    });
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
    createSession() {
      // nibiWorkspaceRefSchema = { workspacePath, workspaceKey }（见 @nibi/shared nibi-protocol）。
      const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
      const id = requestId.current++;
      const frame = {
        id,
        method: "session/create",
        params: { workspace: { workspacePath, workspaceKey: workspacePath } },
      };
      const ok = sendKernelLine(JSON.stringify(frame));
      setLines((prev) => [
        ...prev,
        {
          id: prev.length,
          kind: "info",
          text: `send #${id} session/create → ${ok}\n${JSON.stringify(frame)}`,
        },
      ]);
    },
    sendPrompt() {
      if (!sessionId) {
        setLines((prev) => [...prev, { id: prev.length, kind: "error", text: "先建会话" }]);
        return;
      }
      const id = requestId.current++;
      const frame = {
        id,
        method: "session/send",
        params: { sessionId, content: "你好，用一句话说明你现在跑在哪里。" },
      };
      const ok = sendKernelLine(JSON.stringify(frame));
      setLines((prev) => [
        ...prev,
        {
          id: prev.length,
          kind: "info",
          text: `send #${id} session/send → ${ok}\n${JSON.stringify(frame)}`,
        },
      ]);
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
        <Row
          label="会话"
          value={sessionId ? `${sessionId.slice(0, 8)}…` : "未创建"}
          tone={sessionId ? th.ok : th.inkSub}
        />
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
      <View style={styles.actions}>
        <Action
          label="建会话（session/create）"
          onPress={presses.createSession}
          color={th.steel}
          fg="#fffdf9"
        />
      </View>
      <View style={styles.actions}>
        <Action
          label="发提示（session/send）"
          onPress={presses.sendPrompt}
          color={th.ok}
          fg="#fffdf9"
        />
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
