// 会话消息流（首页正文区）。行模型对齐 dsh-Go 的 ChatRow：
//   用户 = 右侧品牌软色气泡；
//   助手 = 白卡（推理折叠 + 正文 + 流式光标 + 模型标签）；
//   工具 = 一行式卡片（名称 + 状态 + 参数摘要）。
// 只渲染 @nibi-go/kernel-session 的行模型，不碰协议。
import type { ChatFileChange, ChatRow } from "@nibi-go/kernel-session";
import { resolveText, resolveView } from "@nibi-go/plugin-contract";
import type { AttachmentRef, ConversationSelectionText } from "@nibi-go/shared-extract";
import { type ComponentRef, type ReactNode, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { hostSlotData, toolSlotData } from "../plugins/data";
import type { LoadedPlugin } from "../plugins/store";
import { parseComposerText, type ComposerDisplayToken } from "../plugins/tokens";
import { radius, space, useNibiTheme } from "../theme";
import { Icon } from "./Icon";
import { InteractionCard, type InteractionResponder } from "./InteractionCards";
import {
  matchPluginToolCard,
  PluginToolCard,
  type PluginActionHandler,
} from "./PluginView";
import type { PopupAnchor } from "./PluginPopup";


/** 用户行携带的图片/文件附件：只显示文件名，不把内容展开到气泡。 */
function MessageAttachments({ attachments }: { attachments: readonly AttachmentRef[] }) {
  const th = useNibiTheme();
  if (attachments.length === 0) return null;
  return (
    <View style={styles.messageTokens}>
      {attachments.map((attachment) => {
        const image = attachment.mime.startsWith("image/");
        return (
          <View
            key={`${attachment.ref}:${attachment.fileName}`}
            style={[styles.messageToken, { backgroundColor: th.steelSoft }]}
          >
            <Icon name={image ? "image" : "doc"} size={10} color={th.steel} />
            <Text style={[styles.messageTokenText, { color: th.steel }]} numberOfLines={1}>
              {attachment.fileName}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** 用户行里的插件/命令 token：只画名字，不把提示词展开到气泡。 */
function MessageTokens({
  tokens,
  plugins,
}: {
  tokens: readonly ComposerDisplayToken[];
  plugins?: readonly LoadedPlugin[];
}) {
  const th = useNibiTheme();
  if (tokens.length === 0) return null;
  return (
    <View style={styles.messageTokens}>
      {tokens.map((token, index) => {
        const plugin = token.pluginId
          ? plugins?.find((candidate) => candidate.parsed.manifest.id === token.pluginId)
          : undefined;
        const accent = plugin?.parsed.manifest.accent;
        const fg =
          accent === "ok" ? th.ok : accent === "warn" ? th.amber : th.brand;
        const bg =
          accent === "ok" ? th.okSoft : accent === "warn" ? th.amberSoft : th.brandSoft;
        return (
          <View
            key={`${token.kind}:${token.value ?? token.label}:${index}`}
            style={[styles.messageToken, { backgroundColor: bg }]}
          >
            <Icon
              name={
                token.kind === "command"
                  ? "sparkles"
                  : token.kind === "skill"
                    ? "doc"
                    : "puzzle"
              }
              size={10}
              color={fg}
            />
            <Text style={[styles.messageTokenText, { color: fg }]} numberOfLines={1}>
              {token.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** 用户气泡里的注释引用卡：编号 + 选中的一小段原文 + 评论/指令。 */
function AnnotationQuoteCards({
  quotes,
  plugins,
}: {
  quotes: readonly ConversationSelectionText[];
  plugins?: readonly LoadedPlugin[];
}) {
  const th = useNibiTheme();
  const annotations = quotes.filter(
    (quote) => quote.kind === "annotation" || quote.kind === "transform",
  );
  if (annotations.length === 0) return null;
  return (
    <View style={styles.quoteList}>
      {annotations.map((quote, index) => {
        const isTransform = quote.kind === "transform";
        const parsed = parseComposerText(quote.text, plugins ?? []);
        const excerpt =
          [parsed.tokens.map((token) => token.label).join(" "), parsed.body]
            .filter(Boolean)
            .join(" ")
            .trim() || quote.text.trim();
        return (
          <View
            key={`${quote.messageKey ?? "quote"}:${quote.number ?? index + 1}:${quote.text.slice(0, 8)}`}
            style={[styles.quoteCard, { backgroundColor: th.card, borderColor: th.hairline }]}
          >
            <View
              style={[
                styles.quoteNumber,
                { backgroundColor: isTransform ? th.steelSoft : th.brandSoft },
              ]}
            >
              <Text
                style={[styles.quoteNumberText, { color: isTransform ? th.steel : th.brand }]}
              >
                {quote.number ?? index + 1}
              </Text>
            </View>
            <View style={styles.quoteBody}>
              <Text style={[styles.quoteExcerpt, { color: th.inkSub }]} numberOfLines={2}>
                {excerpt}
              </Text>
              {isTransform ? (
                <Text style={[styles.quoteNote, { color: th.steel }]} numberOfLines={1}>
                  改写引用
                </Text>
              ) : quote.instruction ? (
                <Text style={[styles.quoteNote, { color: th.brand }]} numberOfLines={1}>
                  指令：{quote.instruction}
                </Text>
              ) : quote.comment?.trim() ? (
                <Text style={[styles.quoteNote, { color: th.ink }]} numberOfLines={2}>
                  {quote.comment.trim()}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function ConversationList({
  rows,
  onRespond,
  turnChanges,
  onOpenSession,
  plugins,
  onPluginAction,
  bottomInset = 0,
  onMessageLongPress,
  annotationCountFor,
}: {
  rows: readonly ChatRow[];
  onRespond: InteractionResponder;
  /** 轮末改动卡：键是 turn 行的 key（`turn<rowId>`），值是这一轮的文件改动。 */
  turnChanges: Readonly<Record<string, readonly ChatFileChange[]>>;
  /** 子智能体卡的下钻入口（子会话 id）。 */
  onOpenSession?: (sessionId: string) => void;
  /** 已启用的内置插件（工具卡匹配）。 */
  plugins?: readonly LoadedPlugin[];
  onPluginAction?: PluginActionHandler;
  /** 底部浮层（宠物/插件胶囊）占的高度：列表多留这段，最后一条能滚到浮层上方。 */
  bottomInset?: number;
  /** 消息长按：有内置注释/插件 message.actions 时由首页打开动作气泡。 */
  onMessageLongPress?: (
    messageKey: string,
    message: string,
    anchor: PopupAnchor,
    messageRole: "user" | "assistant",
  ) => void;
  /** 这条消息当前还有多少条未发送注释（已发送的从行上的引用里统计）。 */
  annotationCountFor?: (messageKey: string) => number;
}) {
  const th = useNibiTheme();
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);
  // 只有用户本来就在底部时才自动跟随；往上翻历史时不抢滚动。
  const stickToBottom = useRef(true);

  // 已发送注释的标记从行上的 conversationQuotes 派生：刷新/换设备后仍然在。
  const sentAnnotationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row.kind !== "user" && row.kind !== "pending") continue;
      for (const quote of row.conversationQuotes ?? []) {
        if (quote.kind !== "annotation" || !quote.messageKey) continue;
        counts[quote.messageKey] = (counts[quote.messageKey] ?? 0) + 1;
      }
    }
    return counts;
  }, [rows]);

  /**
   * 工具行 → 插件卡（没有匹配/插件停用时 undefined，调用方退回普通工具行）。
   * 折叠后的过程行也用它，保证回合结束后工具卡不会消失。
   */
  const renderPluginTool = (row: Extract<ChatRow, { kind: "tool" }>): ReactNode => {
    const match = plugins && onPluginAction ? matchPluginToolCard(plugins, row) : undefined;
    if (!match || !plugins || !onPluginAction) return undefined;
    const host = hostSlotData({
      enabledPlugins: plugins.length,
      plugin: {
        id: match.plugin.parsed.manifest.id,
        name: match.plugin.parsed.manifest.name,
        version: match.plugin.parsed.manifest.version,
      },
    });
    const data = toolSlotData({
      host,
      name: row.display?.toolName ?? row.name,
      server: row.display?.serverName,
      status: row.status,
      structuredContent: row.display?.ui?.structuredContent,
      widgetMeta: row.display?.ui?.widgetMeta,
      text: row.output,
      error: row.error,
    });
    return (
      <PluginToolCard
        key={row.key}
        plugin={match.plugin}
        card={match.card}
        node={resolveView(match.card.view, data)}
        onAction={onPluginAction}
      />
    );
  };

  return (
    <ScrollView
      ref={ref}
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        bottomInset > 0 ? { paddingBottom: space(2) + bottomInset } : null,
      ]}
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
      onLayout={() => {
        // 键盘/旋转改变可视高度时也贴底，避免最后一条被输入栏或宠物切一半。
        if (stickToBottom.current) ref.current?.scrollToEnd({ animated: false });
      }}
    >
      {rows.map((row) => {
        if (row.kind === "pending") {
          const parsed = parseComposerText(row.text, plugins ?? []);
          return (
            <View key={row.key} style={[styles.row, { alignItems: "flex-end" }]}>
              <View
                style={[
                  styles.bubble,
                  { backgroundColor: th.brandSoft, borderColor: "transparent", opacity: 0.55 },
                ]}
              >
                <MessageAttachments attachments={row.attachments ?? []} />
                <AnnotationQuoteCards quotes={row.conversationQuotes ?? []} plugins={plugins} />
                <MessageTokens tokens={parsed.tokens} plugins={plugins} />
                {parsed.body.length > 0 ? (
                  <Text style={[styles.text, { color: th.ink }]}>{parsed.body}</Text>
                ) : null}
                <Text style={[styles.pendingHint, { color: th.inkFaint }]}>发送中…</Text>
              </View>
            </View>
          );
        }

        if (row.kind === "user") {
          const parsed = parseComposerText(row.text, plugins ?? []);
          const annotationCount =
            (sentAnnotationCounts[row.key] ?? 0) + (annotationCountFor?.(row.key) ?? 0);
          const hasQuotes = (row.conversationQuotes ?? []).some(
            (quote) => quote.kind === "annotation" || quote.kind === "transform",
          );
          // 注释引用的是用户看到的内容（插件名/命令名 + 正文），不是内核命令标签。
          const displayText = [
            parsed.tokens.map((token) => token.label).join(" "),
            parsed.body,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();
          return (
            <View key={row.key} style={[styles.row, { alignItems: "flex-end" }]}>
              <Pressable
                onLongPress={
                  onMessageLongPress
                    ? (event) =>
                        onMessageLongPress(
                          row.key,
                          displayText || row.text,
                          {
                            x: event.nativeEvent.pageX,
                            y: event.nativeEvent.pageY,
                            width: 1,
                            height: 1,
                          },
                          "user",
                        )
                    : undefined
                }
                delayLongPress={350}
                accessibilityRole="button"
                accessibilityLabel="用户消息，长按添加注释"
                style={[
                  styles.bubble,
                  hasQuotes && styles.bubbleWide,
                  { backgroundColor: th.brandSoft, borderColor: "transparent" },
                ]}
              >
                <MessageAttachments attachments={row.attachments ?? []} />
                <AnnotationQuoteCards quotes={row.conversationQuotes ?? []} plugins={plugins} />
                <MessageTokens tokens={parsed.tokens} plugins={plugins} />
                {parsed.body.length > 0 ? (
                  <Text style={[styles.text, { color: th.ink }]}>
                    {parsed.body}
                  </Text>
                ) : null}
              </Pressable>
              {annotationCount > 0 ? (
                <View style={styles.annotationMark}>
                  <Icon name="quote" size={10} color={th.brand} />
                  <Text style={[styles.annotationMarkText, { color: th.brand }]}>
                    {annotationCount} 条注释
                  </Text>
                </View>
              ) : null}
            </View>
          );
        }

        if (row.kind === "tool") {
          // 插件工具卡：MCP 工具的 display 命中某个已启用插件的 toolCard。
          // 没有匹配/插件停用就退回普通工具行（降级为纯文本，不影响会话）。
          const pluginCard = renderPluginTool(row);
          if (pluginCard) return pluginCard;
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
          // 折叠后工具数已在过程摘要行里，脚注不再重复。
          if (!row.folded && row.toolCalls > 0) parts.push(`${row.toolCalls} 次工具`);
          if (row.tokens !== undefined) parts.push(`${formatTokens(row.tokens)} tokens`);
          if (row.files) {
            parts.push(
              row.files.reverted
                ? `${row.files.files} 个文件（已撤销）`
                : `${row.files.files} 个文件 +${row.files.additions} −${row.files.deletions}`,
            );
          }
          const ok = row.state === "completedSuccess";
          const stateLabel = row.folded ? "" : ok ? "✓ 已完成" : row.state === "failed" ? "✕ 失败" : "已中断";
          const files = turnChanges[row.key] ?? [];
          const note = plugins
            ? plugins
                .flatMap((plugin) =>
                  plugin.parsed.manifest.contributes.turnNotes
                    .map((entry) =>
                      resolveText(
                        entry.text,
                        hostSlotData({
                          enabledPlugins: plugins.length,
                          plugin: {
                            id: plugin.parsed.manifest.id,
                            name: plugin.parsed.manifest.name,
                            version: plugin.parsed.manifest.version,
                          },
                        }),
                      ).trim(),
                    )
                    .filter(Boolean),
                )
                .join(" · ")
            : "";
          return (
            <View key={row.key} style={styles.turnBlock}>
              <Text style={[styles.turn, { color: ok ? th.inkFaint : th.red }]}>
                {stateLabel}
                {stateLabel && parts.length > 0 ? " · " : ""}
                {parts.join(" · ")}
              </Text>
              {files.length > 0 ? <ChangeCard files={files} /> : null}
              {note ? (
                <Text style={[styles.turnNote, { color: th.inkFaint }]} numberOfLines={2}>
                  {note}
                </Text>
              ) : null}
            </View>
          );
        }

        if (row.kind === "subagent") {
          const tone =
            row.status === "failed"
              ? th.red
              : row.status === "running"
                ? th.amber
                : row.status === "cancelled"
                  ? th.inkFaint
                  : th.ok;
          const showFoot = row.backgrounded || (row.childSessionId && onOpenSession);
          return (
            <View
              key={row.key}
              style={[styles.subagent, { backgroundColor: th.card, borderColor: th.hairline }]}
            >
              <View style={styles.toolHead}>
                <Text style={[styles.toolName, { color: th.ink }]} numberOfLines={1}>
                  子智能体 · {row.subagentType}
                </Text>
                <Text style={[styles.toolStatus, { color: tone }]}>{row.status}</Text>
              </View>
              {row.summary ? (
                <Text style={[styles.toolDetail, { color: th.inkSub }]} numberOfLines={3}>
                  {row.summary}
                </Text>
              ) : null}
              {showFoot ? (
                <View style={styles.subagentFoot}>
                  <Text style={[styles.subagentMeta, { color: th.inkFaint }]}>
                    {row.backgrounded ? "后台运行" : ""}
                  </Text>
                  {row.childSessionId && onOpenSession ? (
                    <Pressable
                      onPress={() => onOpenSession(row.childSessionId as string)}
                      accessibilityRole="button"
                      accessibilityLabel="查看子会话"
                      hitSlop={6}
                    >
                      <Text style={[styles.subagentLink, { color: th.steel }]}>查看子会话 ›</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        }

        if (row.kind === "process") {
          return <TurnProcessCard key={row.key} row={row} renderTool={renderPluginTool} />;
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
        const annotationCount =
          (sentAnnotationCounts[row.key] ?? 0) + (annotationCountFor?.(row.key) ?? 0);
        return (
          <View key={row.key} style={[styles.row, { alignItems: "flex-start" }]}>
            <Pressable
              onLongPress={
                onMessageLongPress
                  ? (event) =>
                      onMessageLongPress(
                        row.key,
                        row.text,
                        {
                          x: event.nativeEvent.pageX,
                          y: event.nativeEvent.pageY,
                          width: 1,
                          height: 1,
                        },
                        "assistant",
                      )
                  : undefined
              }
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel="助手消息，长按打开动作"
              style={[styles.bubble, { backgroundColor: th.card, borderColor: th.hairline }]}
            >
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
              {row.text.length > 0 ? (
                <Text style={[styles.text, { color: th.ink }]}>
                  {row.text}
                </Text>
              ) : row.reasoning.length === 0 && !row.streaming ? (
                <Text style={[styles.text, { color: th.ink }]}>…</Text>
              ) : null}
              {row.streaming ? (
                <Text style={[styles.streaming, { color: th.brand }]}>
                  {row.text.length > 0 ? "▍" : "生成中…"}
                </Text>
              ) : null}
            </Pressable>
            {annotationCount > 0 ? (
              <View style={styles.annotationMark}>
                <Icon name="quote" size={10} color={th.brand} />
                <Text style={[styles.annotationMarkText, { color: th.brand }]}>
                  已注释 {annotationCount}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/** 一轮的过程摘要（dsh-Go TurnProcess）：默认收起，点开列出思考/工具/中间消息。 */
function TurnProcessCard({
  row,
  renderTool,
}: {
  row: Extract<ChatRow, { kind: "process" }>;
  renderTool?: (row: Extract<ChatRow, { kind: "tool" }>) => ReactNode;
}) {
  const th = useNibiTheme();
  const [open, setOpen] = useState(false);
  const parts = ["✓ 已完成"];
  if (row.toolCalls > 0) parts.push(`${row.toolCalls} 次工具`);
  if (row.messages > 0) parts.push(`${row.messages} 条消息`);
  const label = parts.join(" · ");
  return (
    <View style={styles.process}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        style={styles.processHeader}
      >
        <Text style={[styles.processTitle, { color: th.inkSub }]}>{label}</Text>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={th.inkFaint} />
      </Pressable>
      {open ? (
        <View style={[styles.processBody, { borderLeftColor: th.hairline }]}>
          {row.rows.map((child) => (
            <ProcessChild key={child.key} row={child} renderTool={renderTool} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 折叠里的行：思考、工具行、中间消息；只读，不带交互。 */
function ProcessChild({
  row,
  renderTool,
}: {
  row: ChatRow;
  renderTool?: (row: Extract<ChatRow, { kind: "tool" }>) => ReactNode;
}) {
  const th = useNibiTheme();
  if (row.kind === "assistant") {
    return (
      <View style={styles.processBlock}>
        {row.reasoning.length > 0 ? (
          <Text style={[styles.processReasoning, { color: th.inkFaint }]}>{row.reasoning}</Text>
        ) : null}
        {row.text.length > 0 ? (
          <Text style={[styles.processText, { color: th.inkSub }]}>{row.text}</Text>
        ) : null}
      </View>
    );
  }
  if (row.kind === "tool") {
    const pluginCard = renderTool?.(row);
    if (pluginCard) return pluginCard;
    return (
      <View style={styles.processBlock}>
        <Text
          style={[styles.processTool, { color: row.status === "error" ? th.red : th.inkFaint }]}
        >
          {row.name || "tool"} · {row.status}
          {row.detail ? ` · ${row.detail}` : ""}
        </Text>
        {row.output ? (
          <Text
            style={[styles.processTool, { color: row.status === "error" ? th.red : th.inkSub }]}
            numberOfLines={6}
          >
            {row.output}
          </Text>
        ) : null}
      </View>
    );
  }
  if (row.kind === "toolGroup") {
    return (
      <Text style={[styles.processTool, { color: th.inkFaint }]}>
        {row.tools.length} 次工具 · {row.tools.slice(0, 4).map((tool) => tool.name || "tool").join(" · ")}
        {row.tools.length > 4 ? " …" : ""}
      </Text>
    );
  }
  if (row.kind === "subagent") {
    return (
      <Text style={[styles.processTool, { color: th.inkFaint }]}>
        子智能体 · {row.subagentType} · {row.status}
        {row.summary ? ` · ${row.summary}` : ""}
      </Text>
    );
  }
  if (row.kind === "notice") {
    return <Text style={[styles.processTool, { color: th.inkFaint }]}>{row.text}</Text>;
  }
  return null;
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
  // 带注释卡片的用户气泡必须给足宽度：卡片的内容是 flex:1，收缩宽度会把正文挤成 0。
  bubbleWide: { width: "86%" },
  model: { fontSize: 10 },
  messageTokens: { flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" },
  messageToken: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 2,
    maxWidth: 160,
  },
  messageTokenText: { fontSize: 10.5, fontWeight: "700", flexShrink: 1 },
  quoteList: { gap: 4, marginBottom: 2 },
  quoteCard: {
    width: "100%",
    flexDirection: "row",
    gap: space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    padding: space(1.5),
  },
  quoteNumber: {
    width: 18,
    height: 18,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  quoteNumberText: { fontSize: 9.5, fontWeight: "700" },
  quoteBody: { flex: 1, minWidth: 0, gap: 1 },
  quoteExcerpt: { fontSize: 11, lineHeight: 15 },
  quoteNote: { fontSize: 10.5, lineHeight: 14 },
  annotationMark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
    marginLeft: space(1),
  },
  annotationMarkText: { fontSize: 10, fontWeight: "600" },
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
  turnNote: { fontSize: 10.5, textAlign: "center" },
  turnBlock: { gap: space(2) },
  process: { gap: 2 },
  processHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    minHeight: 32,
  },
  processTitle: { fontSize: 11.5, fontWeight: "600" },
  processBody: {
    borderLeftWidth: 2,
    paddingLeft: space(3),
    marginLeft: space(1),
    paddingVertical: space(1),
    gap: space(2),
  },
  processBlock: { gap: 2 },
  processReasoning: { fontSize: 11.5, lineHeight: 16 },
  processText: { fontSize: 12.5, lineHeight: 18 },
  processTool: { fontSize: 11, lineHeight: 16 },
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
  subagent: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: 4,
  },
  subagentFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  subagentMeta: { fontSize: 10.5 },
  subagentLink: { fontSize: 11.5, fontWeight: "600" },
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
