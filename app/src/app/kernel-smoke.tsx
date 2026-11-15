// C0 冒烟页：验证进程内内核（libnibi.so）的加载、启动与会话协议。
// 仅做设备侧事实确认，不是产品界面；Phase C 正式宿主（会话/工具面）另起。
// 入口：深链 nibigo://kernel-smoke。

import { Paths } from "expo-file-system";
import { router } from "expo-router";
import { KernelSessionClient } from "@nibi-go/kernel-session";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  destroyKernelHost,
  kernelHostAbiVersion,
  kernelHostAvailable,
  kernelHostLoadError,
  killKernelForTest,
  onKernelError,
  onKernelLine,
  onKernelRestart,
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
  const clientRef = useRef<KernelSessionClient | null>(null);
  const lineId = useRef(0);

  const append = (kind: Line["kind"], text: string) =>
    setLines((prev) => [...prev.slice(-199), { id: lineId.current++, kind, text }]);

  useEffect(() => {
    const offLine = onKernelLine((line) => {
      console.log("[kernel-frame]", line);
      append("line", line);
    });
    const offError = onKernelError((message) => append("error", message));
    const offRestart = onKernelRestart((event) =>
      append("info", `:kernel 重启：${event.status}（attempt ${event.attempt}）`),
    );
    append("info", "已订阅内核输出；start 后这里会出现协议帧");
    return () => {
      offLine();
      offError();
      offRestart();
      clientRef.current?.close();
      clientRef.current = null;
      destroyKernelHost();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只挂一次
  }, []);

  const makeClient = (): KernelSessionClient => {
    clientRef.current?.close();
    const client = new KernelSessionClient({
      transport: { sendLine: sendKernelLine, onLine: onKernelLine },
    });
    client.onNotification((notification) => {
      const params = notification.params as { kind?: unknown } | undefined;
      const kind = typeof params?.kind === "string" ? ` · ${params.kind}` : "";
      append("info", `通知 ${notification.method}${kind}`);
    });
    clientRef.current = client;
    return client;
  };

  const presses = {
    async start() {
      const ok = await startKernelHost();
      setStarted(ok);
      if (ok) makeClient();
      append("info", `start() → ${ok}`);
    },
    async startMock() {
      // 本机假 Provider（scripts/dev/mock-openai.mjs + adb reverse tcp:9099）。
      const ok = await startKernelHost(
        {
          NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
          NIBI_API_KEY: "mock-key",
          NIBI_MODEL: "mock-model",
        },
        { useService: false },
      );
      setStarted(ok);
      if (ok) makeClient();
      append("info", `start(mock) → ${ok}`);
    },
    async startServiceMock() {
      // D20：内核跑在 :kernel 进程，控制面 Binder、帧流 socketpair。
      const ok = await startKernelHost(
        {
          NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
          NIBI_API_KEY: "mock-key",
          NIBI_MODEL: "mock-model",
        },
        { useService: true },
      );
      setStarted(ok);
      if (ok) makeClient();
      append("info", `start(:kernel service) → ${ok}`);
    },
    killProcess() {
      killKernelForTest();
      append("info", "killKernelForTest()：等待 binder death → 重连");
    },
    stop() {
      const ok = stopKernelHost();
      setStarted(false);
      append("info", `stop() → ${ok}`);
    },
    destroy() {
      clientRef.current?.close();
      clientRef.current = null;
      destroyKernelHost();
      setStarted(false);
      setSessionId(null);
      append("info", "destroy() 已调用");
    },
    async createSession() {
      const client = clientRef.current ?? makeClient();
      const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
      try {
        const result = await client.createSession({
          workspacePath,
          workspaceKey: workspacePath,
        });
        setSessionId(result.sessionId);
        append("info", `session/create → ${result.sessionId}`);
      } catch (error) {
        append("error", `session/create 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async sendPrompt() {
      const client = clientRef.current;
      if (!client?.currentSessionId) {
        append("error", "先建会话");
        return;
      }
      try {
        const result = await client.sendPrompt("你好，用一句话说明你现在跑在哪里。");
        append("info", `session/send → accepted=${String(result.accepted)}`);
      } catch (error) {
        append("error", `session/send 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async readMessages() {
      const client = clientRef.current;
      if (!client?.currentSessionId) {
        append("error", "先建会话");
        return;
      }
      try {
        const messages = await client.readMessages();
        append("info", `session/messages → ${messages.length} 条`);
        for (const message of messages) {
          const text = message.parts
            .map((part) => (typeof part.text === "string" ? part.text : ""))
            .join("")
            .slice(0, 80);
          append("line", `${message.info.role}: ${text}`);
        }
      } catch (error) {
        append("error", `session/messages 失败：${error instanceof Error ? error.message : String(error)}`);
      }
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
        <Row
          label="C ABI 版本"
          value={abi >= 0 ? `v${abi}` : "不可用"}
          tone={abi >= 0 ? th.ink : th.red}
        />
        <Row
          label="内核状态"
          value={started ? "运行中" : "未启动"}
          tone={started ? th.ok : th.inkSub}
        />
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
        <Action
          label="启动（mock 模型）"
          onPress={presses.startMock}
          color={th.violet}
          fg="#fffdf9"
        />
      </View>
      <View style={styles.actions}>
        <Action
          label="读消息（session/messages）"
          onPress={presses.readMessages}
          color={th.amber}
          fg="#fffdf9"
        />
      </View>
      <View style={styles.actions}>
        <Action
          label="启动（:kernel 服务 + mock）"
          onPress={presses.startServiceMock}
          color={th.steel}
          fg="#fffdf9"
        />
        <Action
          label="杀掉 :kernel 进程"
          onPress={presses.killProcess}
          color={th.red}
          fg="#fffdf9"
        />
      </View>

      <ScrollView
        style={[styles.log, { borderColor: th.hairline }]}
        contentContainerStyle={{ padding: 10 }}
      >
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
