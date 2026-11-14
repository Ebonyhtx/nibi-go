// C0/C1 的最小本机会话屏：进程内内核 + kernel-session 的行模型。
// dev 冒烟用：内核未启动时按 mock 模型启动（scripts/dev/mock-openai.mjs）；
// 产品路径（真实 Provider/登录）接上后把 env 注入去掉即可。
// 入口：深链 nibigo://go-chat

import { Paths } from "expo-file-system";
import { router } from "expo-router";
import {
  ConversationController,
  KernelSessionClient,
  type ConversationRow,
  type TurnState,
} from "@nibi-go/kernel-session";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  kernelHostAvailable,
  onKernelLine,
  sendKernelLine,
  startKernelHost,
} from "nibi-kernel-host";

import { useNibiTheme } from "../theme";

const DEV_MOCK_ENV = {
  NIBI_MODEL_BASE_URL: "http://127.0.0.1:9099/v1",
  NIBI_API_KEY: "mock-key",
  NIBI_MODEL: "mock-model",
};

export default function GoChatScreen() {
  const th = useNibiTheme();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<readonly ConversationRow[]>([]);
  const [turn, setTurn] = useState<TurnState>("idle");
  const [status, setStatus] = useState("初始化…");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const clientRef = useRef<KernelSessionClient | null>(null);
  const controllerRef = useRef<ConversationController | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const started = await startKernelHost(__DEV__ ? DEV_MOCK_ENV : undefined);
        if (cancelled) return;
        if (!started && !kernelHostAvailable()) {
          setStatus("内核不可用");
          return;
        }
        const client = new KernelSessionClient({
          transport: { sendLine: sendKernelLine, onLine: onKernelLine },
        });
        clientRef.current = client;
        const workspacePath = Paths.document.uri.replace(/^file:\/\//u, "");
        await client.createSession({ workspacePath, workspaceKey: workspacePath });
        if (cancelled) return;

        const controller = new ConversationController(client);
        controllerRef.current = controller;
        controller.subscribe(() => {
          setRows([...controller.rows]);
          setTurn(controller.turn);
        });
        await controller.refresh();
        if (!cancelled) setStatus("就绪");
      } catch (error) {
        if (!cancelled) {
          setStatus(`失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
      controllerRef.current?.dispose();
      controllerRef.current = null;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  const send = async () => {
    const text = input.trim();
    const client = clientRef.current;
    if (!text || !client || sending) return;
    setSending(true);
    setInput("");
    try {
      await client.sendPrompt(text);
      await controllerRef.current?.refresh();
    } catch (error) {
      setStatus(`发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: th.bg, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: th.steel }]}>‹ 返回</Text>
        </Pressable>
        <Text style={[styles.title, { color: th.ink }]}>本机会话</Text>
        <Text style={[styles.status, { color: turn === "running" ? th.brand : th.inkFaint }]}>
          {turn === "running" ? "思考中…" : status}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {rows.length === 0 ? (
          <Text style={[styles.empty, { color: th.inkFaint }]}>说点什么，内核在本机运行。</Text>
        ) : null}
        {rows.map((row) => (
          <Row key={`${row.kind}:${row.id}`} row={row} />
        ))}
      </ScrollView>

      <View style={[styles.composer, { backgroundColor: th.card, borderColor: th.hairline }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="给本机 AGENT 发消息"
          placeholderTextColor={th.inkGhost}
          style={[styles.input, { color: th.ink }]}
          multiline
          submitBehavior="submit"
          onSubmitEditing={() => void send()}
        />
        <Pressable
          onPress={() => void send()}
          disabled={sending || input.trim().length === 0}
          style={[
            styles.send,
            {
              backgroundColor: sending || input.trim().length === 0 ? th.panel : th.brand,
            },
          ]}
        >
          <Text
            style={{
              color: sending || input.trim().length === 0 ? th.inkFaint : th.brandFg,
              fontWeight: "700",
            }}
          >
            发送
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({ row }: { row: ConversationRow }) {
  const th = useNibiTheme();
  if (row.kind === "system") {
    return <Text style={[styles.system, { color: th.inkFaint }]}>{row.text}</Text>;
  }
  const isUser = row.kind === "user";
  return (
    <View style={[styles.row, { alignItems: isUser ? "flex-end" : "flex-start" }]}>
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: th.brandSoft, borderColor: "transparent" }
            : { backgroundColor: th.card, borderColor: th.hairline },
        ]}
      >
        {row.kind === "assistant" && row.model ? (
          <Text style={[styles.model, { color: th.inkGhost }]}>
            {row.model.providerId} · {row.model.modelId}
          </Text>
        ) : null}
        <Text style={[styles.text, { color: th.ink }]} selectable>
          {row.text || "…"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  back: { fontSize: 15, fontWeight: "600", width: 56 },
  title: { fontSize: 16, fontWeight: "700" },
  status: { fontSize: 12, width: 72, textAlign: "right" },
  scroll: { flex: 1 },
  scrollContent: { paddingVertical: 12, gap: 10 },
  empty: { fontSize: 13, textAlign: "center", marginTop: 40 },
  row: { width: "100%" },
  bubble: {
    maxWidth: "86%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 4,
  },
  model: { fontSize: 10 },
  text: { fontSize: 14, lineHeight: 20 },
  system: { fontSize: 12, textAlign: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  input: { flex: 1, fontSize: 14, maxHeight: 96, paddingTop: 4, paddingBottom: 4 },
  send: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
});
