// 会话消息流（首页正文区）。行模型对齐 dsh-Go 的 ChatRow：
//   用户 = 右侧品牌软色气泡；
//   助手 = 白卡（推理折叠 + 正文 + 流式光标 + 模型标签）；
//   工具 = 一行式卡片（名称 + 状态 + 参数摘要）。
// 只渲染 @nibi-go/kernel-session 的行模型，不碰协议。
import type { ChatFileChange, ChatRow } from "@nibi-go/kernel-session";
import { type ComponentRef, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { radius, space, useNibiTheme } from "../theme";
import { InteractionCard, type InteractionResponder } from "./InteractionCards";

export function ConversationList({
  rows,
  onRespond,
  turnChanges,
}: {
  rows: readonly ChatRow[];
  onRespond: InteractionResponder;
  /** 轮末改动卡：键是 turn 行的 key（`turn<rowId>`），值是这一轮的文件改动。 */
  turnChanges: Readonly<Record<string, readonly ChatFileChange[]>>;
}) {
  const th = useNibiTheme();
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);
  // 只有用户本来就在底部时才自动跟随；往上翻历史时不抢滚动。
  const stickToBottom = useRef(true);

  return (
    <ScrollView
      ref={ref}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        stickToBottom.current =
          contentOffset.y + layoutMeasurement.height >= contentSize.height - 32;
      }}
      scrollEventThrottle={16}
      onContentSizeChange={() => {
        if (stickToBottom.current) ref.current?.scrollToEnd({ animated: false });
      }}
    >
      {rows.map((row) => {
        if (row.kind === "pending") {
          return (
            <View key={row.key} style={[styles.row, { alignItems: "flex-end" }]}>
              <View
                style={[
                  styles.bubble,
                  { backgroundColor: th.brandSoft, borderColor: "transparent", opacity: 0.55 },
                ]}
              >
                <Text style={[styles.text, { color: th.ink }]}>{row.text}</Text>
                <Text style={[styles.pendingHint, { color: th.inkFaint }]}>发送中…</Text>
              </View>
            </View>
          );
        }

        if (row.kind === "user") {
          return (
            <View key={row.key} style={[styles.row, { alignItems: "flex-end" }]}>
              <View style={[styles.bubble, { backgroundColor: th.brandSoft, borderColor: "transparent" }]}>
                <Text style={[styles.text, { color: th.ink }]} selectable>
                  {row.text}
                </Text>
              </View>
            </View>
          );
        }

        if (row.kind === "tool") {
          const tone =
            row.status === "error"
              ? th.red
              : row.status === "success"
                ? th.ok
                : row.status === "cancelled"
                  ? th.inkFaint
                  : th.amber;
          return (
            <View
              key={row.key}
              style={[styles.tool, { backgroundColor: th.card, borderColor: th.hairline }]}
            >
              <View style={styles.toolHead}>
                <Text style={[styles.toolName, { color: th.ink }]} numberOfLines={1}>
                  {row.name || "tool"}
                </Text>
                <Text style={[styles.toolStatus, { color: tone }]}>{row.status}</Text>
              </View>
              {row.detail ? (
                <Text style={[styles.toolDetail, { color: th.inkFaint }]} numberOfLines={2}>
                  {row.detail}
                </Text>
              ) : null}
              {row.output ? (
                <Text
                  style={[styles.toolOutput, { color: row.status === "error" ? th.red : th.inkFaint }]}
                  numberOfLines={3}
                >
                  {row.output}
                </Text>
              ) : null}
              {row.error ? (
                <Text style={[styles.toolDetail, { color: th.red }]} numberOfLines={3}>
                  {row.error}
                </Text>
              ) : null}
            </View>
          );
        }

        if (row.kind === "toolGroup") {
          const tone = row.running ? th.amber : th.inkFaint;
          return (
            <View
              key={row.key}
              style={[styles.tool, { backgroundColor: th.card, borderColor: th.hairline }]}
            >
              <View style={styles.toolHead}>
                <Text style={[styles.toolName, { color: th.ink }]}>
                  {row.tools.length} 次工具调用
                </Text>
                <Text style={[styles.toolStatus, { color: tone }]}>
                  {row.running ? "进行中" : "已完成"}
                </Text>
              </View>
              <Text style={[styles.toolDetail, { color: th.inkFaint }]} numberOfLines={2}>
                {row.tools
                  .slice(0, 4)
                  .map((tool) => tool.name || "tool")
                  .join(" · ")}
                {row.tools.length > 4 ? " …" : ""}
              </Text>
            </View>
          );
        }

        if (row.kind === "turn") {
          const parts: string[] = [];
          if (row.durationMs !== undefined) parts.push(`用时 ${formatDuration(row.durationMs)}`);
          if (row.toolCalls > 0) parts.push(`${row.toolCalls} 次工具`);
          if (row.tokens !== undefined) parts.push(`${formatTokens(row.tokens)} tokens`);
          if (row.files) {
            parts.push(
              row.files.reverted
                ? `${row.files.files} 个文件（已撤销）`
                : `${row.files.files} 个文件 +${row.files.additions} −${row.files.deletions}`,
            );
          }
          const ok = row.state === "completedSuccess";
          const files = turnChanges[row.key] ?? [];
          return (
            <View key={row.key} style={styles.turnBlock}>
              <Text style={[styles.turn, { color: ok ? th.inkFaint : th.red }]}>
                {ok ? "✓ 已完成" : row.state === "failed" ? "✕ 失败" : "已中断"}
                {parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}
              </Text>
              {files.length > 0 ? <ChangeCard files={files} /> : null}
            </View>
          );
        }

        if (row.kind === "approval" || row.kind === "question") {
          return <InteractionCard key={row.key} row={row} onRespond={onRespond} />;
        }

        if (row.kind === "notice") {
          return (
            <Text
              key={row.key}
              style={[
                styles.notice,
                { color: row.tone === "warning" ? th.amber : th.inkFaint },
              ]}
            >
              {row.text}
            </Text>
          );
        }

        // assistant
        return (
          <View key={row.key} style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={[styles.bubble, { backgroundColor: th.card, borderColor: th.hairline }]}>
              {row.model ? (
                <Text style={[styles.model, { color: th.inkGhost }]}>{row.model}</Text>
              ) : null}
              {row.reasoning.length > 0 ? (
                <View style={[styles.reasoning, { borderLeftColor: th.hairline }]}>
                  <Text style={[styles.reasoningText, { color: th.inkFaint }]} numberOfLines={4}>
                    {row.reasoning}
                  </Text>
                </View>
              ) : null}
              {row.text.length > 0 || !row.streaming ? (
                <Text style={[styles.text, { color: th.ink }]} selectable>
                  {row.text || "…"}
                </Text>
              ) : null}
              {row.streaming ? (
                <Text style={[styles.streaming, { color: th.brand }]}>
                  {row.text.length > 0 ? "▍" : "生成中…"}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** 轮末改动卡（dsh-Go ChangeCard 的信息面）：改了哪些文件、各自 +/−。 */
function ChangeCard({ files }: { files: readonly ChatFileChange[] }) {
  const th = useNibiTheme();
  const added = files.reduce((sum, file) => sum + file.additions, 0);
  const removed = files.reduce((sum, file) => sum + file.deletions, 0);
  const shown = files.slice(0, 4);
  return (
    <View style={[styles.changes, { backgroundColor: th.card, borderColor: th.hairline }]}>
      <View style={styles.toolHead}>
        <Text style={[styles.toolName, { color: th.ink }]}>改动了 {files.length} 个文件</Text>
        <Text style={[styles.toolStatus, { color: th.inkFaint }]}>
          +{added} −{removed}
        </Text>
      </View>
      {shown.map((file) => (
        <View key={file.path} style={styles.fileRow}>
          <Text style={[styles.fileName, { color: th.ink }]} numberOfLines={1}>
            {baseName(file.path)}
          </Text>
          <Text style={[styles.fileDir, { color: th.inkGhost }]} numberOfLines={1}>
            {dirName(file.path)}
          </Text>
          <Text style={[styles.fileStat, { color: th.inkFaint }]}>
            {file.additions > 0 ? `+${file.additions}` : ""}
            {file.additions > 0 && file.deletions > 0 ? " " : ""}
            {file.deletions > 0 ? `−${file.deletions}` : ""}
          </Text>
        </View>
      ))}
      {files.length > shown.length ? (
        <Text style={[styles.fileMore, { color: th.inkFaint }]}>
          还有 {files.length - shown.length} 个文件
        </Text>
      ) : null}
    </View>
  );
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function dirName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingVertical: space(2), gap: space(3) },
  row: { width: "100%" },
  bubble: {
    maxWidth: "86%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: 4,
  },
  model: { fontSize: 10 },
  text: { fontSize: 14, lineHeight: 20 },
  reasoning: {
    borderLeftWidth: 2,
    paddingLeft: space(2),
    marginBottom: 2,
  },
  reasoningText: { fontSize: 12, lineHeight: 17 },
  streaming: { fontSize: 14, fontWeight: "700" },
  pendingHint: { fontSize: 10 },
  turn: { fontSize: 11, textAlign: "center" },
  turnBlock: { gap: space(2) },
  notice: { fontSize: 11.5, textAlign: "center", paddingHorizontal: space(2) },
  tool: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: 3,
  },
  toolHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  toolName: { flex: 1, fontSize: 12.5, fontWeight: "700" },
  toolStatus: { fontSize: 10.5, fontWeight: "600" },
  toolDetail: { fontSize: 11.5, lineHeight: 16 },
  toolOutput: { fontFamily: "monospace", fontSize: 11, lineHeight: 15 },
  changes: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: space(1),
  },
  fileRow: { flexDirection: "row", alignItems: "baseline", gap: space(2) },
  fileName: { fontSize: 12.5, fontWeight: "600", flexShrink: 0, maxWidth: "48%" },
  fileDir: { flex: 1, fontSize: 11 },
  fileStat: { fontSize: 11.5, fontWeight: "600" },
  fileMore: { fontSize: 11, marginTop: 2 },
});
