// 会话消息流（首页正文区）。行模型对齐 dsh-Go 的 ChatRow：
//   用户 = 右侧品牌软色气泡；
//   助手 = 思考折叠块（在气泡上方）+ 白卡正文 + 流式光标 + 模型标签；
//   工具 = 可折叠的一行摘要（名称 + 状态词 + 目标），展开才是输入/输出。
// 只渲染 @nibi-go/kernel-session 的行模型，不碰协议。
import type { ChatFileChange, ChatRow } from "@nibi-go/kernel-session";
import { resolveText, resolveView } from "@nibi-go/plugin-contract";
import type { AttachmentRef, ConversationSelectionText } from "@nibi-go/shared-extract";
import {
  type ComponentRef,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppearIn } from "../motion/appear";
import { easingStandard } from "../motion/easing";
import { PressableScale } from "../motion/PressableScale";
import { hostSlotData, toolSlotData } from "../plugins/data";
import { collectTurnPushes } from "../plugins/push";
import type { LoadedPlugin } from "../plugins/store";
import { parseComposerText, type ComposerDisplayToken } from "../plugins/tokens";
import { usePhoneApprovalOverlay } from "../phone/approval";
import { motion, radius, size, space, text, type NibiTheme, useNibiTheme } from "../theme";
import { AgentFace, type AgentFaceStatus } from "./AgentFace";
import { Disclosure } from "./Disclosure";
import { Icon } from "./Icon";
import { InteractionCard, type InteractionResponder } from "./InteractionCards";
import {
  matchPluginToolCard,
  PluginToolCard,
  type PluginActionHandler,
} from "./PluginView";
import type { PopupAnchor } from "./PluginPopup";

/** 消息正文：按 `` `行内代码` `` 切段，代码段给等宽字 + 井底色——
 * 之前反引号原样露在正文里（2.0.1 审查 P0）。不引 markdown 库，只处理这一种最常见的标记。 */
function BodyText({ text, color }: { text: string; color: string }) {
  const th = useNibiTheme();
  const parts = text.split(/(`[^`\n]+`)/g);
  if (parts.length === 1) {
    return <Text style={[styles.text, { color }]}>{text}</Text>;
  }
  return (
    <Text style={[styles.text, { color }]}>
      {parts.map((part, index) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <Text key={index} style={[styles.inlineCode, { backgroundColor: th.surfaceSoft, color: th.ink }]}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/** 流式光标：▍按 motion.base 节奏呼吸（1→0.15→1），色取品牌橙——直播态专属的 ≤5% 强调。
 * 体量极小且只在流式/发送中挂载，约定不做 reduced-motion 分支（桌面同款也是常动）。
 * outside：还没有正文气泡时单独挂在思考块下（样式同 bubble 内，多个 marginTop）。 */
function StreamingCursor({ variant = "body" }: { variant?: "body" | "small" | "outside" }) {
  const th = useNibiTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.15,
          duration: motion.duration.base,
          easing: easingStandard,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: motion.duration.base,
          easing: easingStandard,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  const style =
    variant === "small"
      ? styles.streamingSmall
      : variant === "outside"
        ? styles.streamingOutside
        : styles.streaming;
  return <Animated.Text style={[style, { color: th.brand, opacity }]}>▍</Animated.Text>;
}


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

/** 行的数值身份：rowId 优先（user/turn 行带），其余从 key 尾部取数——内核的 r12/t34/turn56
 * 尾数都是单调 id，可以跨行种比大小；取不出数字的（审批/提问的字符串 id）当 null，不参与判定。 */
function rowNumericId(row: ChatRow): number | null {
  if ("rowId" in row && typeof row.rowId === "number") return row.rowId;
  const match = /(\d+)$/.exec(row.key);
  return match ? Number(match[1]) : null;
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
  showReasoning = true,
  showTools = true,
  autoCollapseThinking = true,
  autoCollapseTools = true,
  onRetryTurn,
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
  /** 是否显示助手思考块（默认显示；关掉后气泡只剩正文）。 */
  showReasoning?: boolean;
  /** 是否显示工具行（默认显示；false 时工具/工具组行整行不渲染）。 */
  showTools?: boolean;
  /** 流式期间自动展开思考、结束后自动收起（默认 true）；用户手动切换后以其选择为准。 */
  autoCollapseThinking?: boolean;
  /** 工具行/工具组默认收起（默认 true）；false 时默认展开。 */
  autoCollapseTools?: boolean;
  /** 失败/中断回合的「重试」入口（内核 retryTurn 重发最后一轮，target 取自轮头行）。 */
  onRetryTurn?: (target: { rowId: number; entityId: string }) => void;
}) {
  const th = useNibiTheme();
  const { isOverlayApproval } = usePhoneApprovalOverlay(rows, onRespond);
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);
  // 只有用户本来就在底部时才自动跟随；往上翻历史时不抢滚动。
  const stickToBottom = useRef(true);
  // 折叠态的展开/收起只存本地：键是稳定行 id，手动切换后不再被自动策略覆盖。
  const toggles = useRef(new Map<string, boolean>());
  const [, setToggleTick] = useState(0);
  const isOpen = (id: string, fallback: boolean) => toggles.current.get(id) ?? fallback;
  const toggleOpen = (id: string, fallback: boolean) => {
    toggles.current.set(id, !(toggles.current.get(id) ?? fallback));
    setToggleTick((value) => value + 1);
  };

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

  // 插件随工具结果推到槽的数据（`_meta.nibiGo.push`）：按轮收集，turn.note 用 `data.push.*` 绑定。
  const turnPushes = useMemo(() => collectTurnPushes(rows), [rows]);

  // 仍在后台运行的子代理 → 触发它的 Agent/Task 工具行 key 集合。
  // 工具行本身早就 success（spawn 完即返回），但后台代理还在干活——
  // 这时工具行的脸与状态词必须继续显示「运行中」，不能落成「已完成」。
  const agentRunningTools = useMemo(() => {
    const keys = new Set<string>();
    const visit = (list: readonly ChatRow[]) => {
      for (const row of list) {
        if (row.kind === "subagent") {
          const running = row.status === "running" || (!row.status && row.backgrounded);
          if (running && row.parentToolCallId) keys.add(`t${row.parentToolCallId}`);
        } else if (row.kind === "process") {
          visit(row.rows);
        } else if (row.kind === "toolGroup") {
          visit(row.tools);
        }
      }
    };
    visit(rows);
    return keys;
  }, [rows]);

  // 模型名只标「变更回合」：与上一条助手行的 model 不同才显示一次。
  // 单模型会话不再每个气泡重复顶栏已有的信息（2.0.1 审查）。
  const modelChangeKeys = useMemo(() => {
    const keys = new Set<string>();
    let last: string | undefined;
    for (const row of rows) {
      if (row.kind !== "assistant" || row.text.trim().length === 0) continue;
      if (row.model && row.model !== last) keys.add(row.key);
      last = row.model ?? last;
    }
    return keys;
  }, [rows]);

  // 新行入场判定（纸上鸟 2.0）：只给「增量到达」的行播淡入，历史恢复/换会话整批直出。
  // 判据：行数值身份大于已见最大 rowId 才算新行；一次渲染冒出超过 2 条新 id 视为整批回填
  // （快照回填/换会话的特征——正常增量一轮最多同时到 2 行：回显 + 轮脚注）。
  // maxSeenRowIdRef 渲染期读、effect 里抬：本帧先按上一帧的最大值判，渲染完再更新。
  const maxSeenRowIdRef = useRef<number | null>(null);
  // 入场过的 key 保持包裹（sticky）：中途摘掉 AppearIn 会把子树整个重挂，
  // 思考块计时器/滚动位全丢；key 消失（fold/换会话）时再清出。
  const enterKeysRef = useRef<Set<string>>(new Set());
  const enterKeys = useMemo(() => {
    const keys = new Set<string>();
    // pending 与流式中的助手行是本地直播事件，无条件入场（历史恢复里不存在这两种行）。
    for (const row of rows) {
      if (row.kind === "pending" || (row.kind === "assistant" && row.streaming)) {
        keys.add(row.key);
      }
    }
    const max = maxSeenRowIdRef.current;
    if (max !== null) {
      const fresh: string[] = [];
      for (const row of rows) {
        const id = rowNumericId(row);
        if (id !== null && id > max) fresh.push(row.key);
      }
      if (fresh.length > 0 && fresh.length <= 2) {
        for (const key of fresh) keys.add(key);
      }
    }
    // 渲染期写 ref 是幂等的：同一输入两次渲染结果一致，判定只依赖 effect 提交后的 max。
    const enter = new Set(keys);
    for (const key of [...enterKeysRef.current]) {
      if (rows.some((row) => row.key === key)) enter.add(key);
      else enterKeysRef.current.delete(key);
    }
    for (const key of enter) enterKeysRef.current.add(key);
    return enter;
  }, [rows]);
  useEffect(() => {
    let max = maxSeenRowIdRef.current;
    for (const row of rows) {
      const id = rowNumericId(row);
      if (id !== null && (max === null || id > max)) max = id;
    }
    maxSeenRowIdRef.current = max;
  }, [rows]);

  // 新行入场包装：命中判定的行套 AppearIn（淡入 + 6pt 上移，播一次），其余直出不套壳。
  const withEnter = (key: string, node: ReactNode): ReactNode =>
    enterKeys.has(key) ? (
      <AppearIn key={key} distance={6}>
        {node}
      </AppearIn>
    ) : (
      node
    );

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
      settings: match.plugin.settings,
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
      nestedScrollEnabled
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
          return withEnter(
            row.key,
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
                  <BodyText text={parsed.body} color={th.ink} />
                ) : null}
                {/* 发送中的乐观气泡也带同款光标：和助手流式共用一套「正在直播」的语言。 */}
                <View style={styles.pendingHintRow}>
                  <StreamingCursor variant="small" />
                  <Text style={[styles.pendingHint, { color: th.inkFaint }]}>发送中…</Text>
                </View>
              </View>
            </View>,
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
          return withEnter(
            row.key,
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
                  <BodyText text={parsed.body} color={th.ink} />
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
            </View>,
          );
        }

        if (row.kind === "tool") {
          // 插件工具卡：MCP 工具的 display 命中某个已启用插件的 toolCard。
          // 没有匹配/插件停用就退回普通工具行（降级为纯文本，不影响会话）。
          if (!showTools) return null;
          const pluginCard = renderPluginTool(row);
          if (pluginCard) return withEnter(row.key, pluginCard);
          return withEnter(
            row.key,
            <ToolRowView
              key={row.key}
              row={row}
              open={isOpen(row.key, !autoCollapseTools)}
              onToggle={() => toggleOpen(row.key, !autoCollapseTools)}
              agentRunning={agentRunningTools.has(row.key)}
            />,
          );
        }

        if (row.kind === "toolGroup") {
          if (!showTools) return null;
          const open = isOpen(row.key, !autoCollapseTools);
          // 组头 tone 与工具行同一套语义（toolTone）：跑动=amber、完成=ok。
          const tone = toolTone(th, row.running ? "running" : "success");
          return withEnter(
            row.key,
            <View key={row.key} style={styles.toolRow}>
              <Disclosure
                icon={<Icon name="sliders" size={12} color={tone} />}
                title={
                  <Text style={[styles.toolRowName, { color: th.ink }]} numberOfLines={1}>
                    {row.tools.length} 次工具调用
                  </Text>
                }
                subtitle={
                  <Text style={[styles.toolRowMeta, { color: tone }]} numberOfLines={1}>
                    {row.running ? "进行中" : "已完成"}
                  </Text>
                }
                open={open}
                onToggle={() => toggleOpen(row.key, !autoCollapseTools)}
                rail
              >
                {row.tools.map((tool) => (
                  <ToolRowView
                    key={tool.key}
                    row={tool}
                    open={isOpen(tool.key, !autoCollapseTools)}
                    onToggle={() => toggleOpen(tool.key, !autoCollapseTools)}
                    agentRunning={agentRunningTools.has(tool.key)}
                  />
                ))}
              </Disclosure>
            </View>,
          );
        }

        if (row.kind === "turn") {
          // 2.0.1 减法：成功回合不再写「✓ 已完成 / 用时」——回复出现即已完成，耗时是调试数据；
          // 只有失败/中断需要显式标注（配「重试」）。tokens/工具数/文件改动是有用增量，保留。
          const parts: string[] = [];
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
          const stateLabel = row.folded ? "" : ok ? "" : row.state === "failed" ? "✕ 失败" : "已中断";
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
                          settings: plugin.settings,
                          // 推送按 MCP 服务器名收（display.ui.pluginId 是服务器名），槽按 manifest id 找。
                          push: turnPushes
                            .get(row.key)
                            ?.get(
                              plugin.parsed.manifest.runtime?.serverName ??
                                plugin.parsed.manifest.id,
                            ),
                        }),
                      ).trim(),
                    )
                    .filter(Boolean),
                )
                .join(" · ")
            : "";
          return withEnter(
            row.key,
            <View key={row.key} style={styles.turnBlock}>
              {stateLabel || parts.length > 0 ? (
                <View style={styles.turnHeadRow}>
                  <Text style={[styles.turn, { color: ok ? th.inkFaint : th.red }]}>
                    {stateLabel}
                    {stateLabel && parts.length > 0 ? " · " : ""}
                    {parts.join(" · ")}
                  </Text>
                </View>
              ) : null}
              {/* 失败/中断的回合给一个重试入口：内核 retryTurn 会截到这一轮的用户输入前重发。 */}
              {!ok && onRetryTurn && row.entityId ? (
                <PressableScale
                  onPress={() => onRetryTurn({ rowId: row.rowId, entityId: row.entityId! })}
                  scaleTo={0.94}
                  accessibilityRole="button"
                  accessibilityLabel="重试这一轮"
                  style={[styles.retry, { backgroundColor: th.panel, borderColor: th.hairline }]}
                >
                  <Icon name="refresh" size={11} color={th.inkSub} />
                  <Text style={[styles.retryText, { color: th.inkSub }]}>重试</Text>
                </PressableScale>
              ) : null}
              {files.length > 0 ? <ChangeCard files={files} /> : null}
              {note ? (
                <Text style={[styles.turnNote, { color: th.inkFaint }]} numberOfLines={2}>
                  {note}
                </Text>
              ) : null}
            </View>,
          );
        }

        if (row.kind === "subagent") {
          // 后台行可能没带 status（旧日志）：backgrounded 且无状态按运行中处理。
          const running = row.status === "running" || (!row.status && row.backgrounded);
          const tone = running
            ? th.amber
            : row.status === "failed"
              ? th.red
              : row.status === "cancelled"
                ? th.inkFaint
                : th.ok;
          // 瓦片脸的表情随状态走（对齐桌面 WorkflowAgentFace 的状态表情）；徽标补一眼可辨的完成/失败。
          const faceStatus: AgentFaceStatus = running
            ? "running"
            : row.status === "failed"
              ? "failed"
              : row.status === "cancelled"
                ? "cancelled"
                : "completed";
          const statusLabel = running
            ? row.backgrounded
              ? "后台运行中"
              : "进行中"
            : row.status === "failed"
              ? "失败"
              : row.status === "cancelled"
                ? "已停止"
                : "已完成";
          const showFoot = row.backgrounded || (row.childSessionId && onOpenSession);
          return withEnter(
            row.key,
            <View
              key={row.key}
              style={[styles.subagent, { backgroundColor: th.card, borderColor: th.hairline }]}
            >
              <View style={styles.subagentHead}>
                <AgentFace name={row.subagentType} status={faceStatus} size={22} badge />
                <View style={styles.subagentTitleCol}>
                  <Text style={[styles.toolName, { color: th.ink }]} numberOfLines={1}>
                    子智能体 · {row.subagentType}
                  </Text>
                  <Text style={[styles.subagentStatus, { color: tone }]}>{statusLabel}</Text>
                </View>
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
            </View>,
          );
        }

        if (row.kind === "process") {
          // 过程卡里的思考/工具也走顶层同一套折叠件，并尊重 showReasoning/showTools。
          return withEnter(
            row.key,
            <TurnProcessCard
              key={row.key}
              row={row}
              renderTool={renderPluginTool}
              isOpen={isOpen}
              toggleOpen={toggleOpen}
              showReasoning={showReasoning}
              showTools={showTools}
              autoCollapseThinking={autoCollapseThinking}
              autoCollapseTools={autoCollapseTools}
              agentRunningTools={agentRunningTools}
            />,
          );
        }

        if (row.kind === "approval" || row.kind === "question") {
          // 手机工具审批已转到悬浮卡（不抢前台）；没有悬浮权限时仍走应用内卡片。
          if (row.kind === "approval" && isOverlayApproval(row)) return null;
          return withEnter(
            row.key,
            <InteractionCard key={row.key} row={row} onRespond={onRespond} />,
          );
        }

        if (row.kind === "notice") {
          return withEnter(
            row.key,
            <Text
              key={row.key}
              style={[
                styles.notice,
                { color: row.tone === "warning" ? th.amber : th.inkFaint },
              ]}
            >
              {row.text}
            </Text>,
          );
        }

        // assistant：思考单独成块放在气泡上方，气泡里只有正文。
        const annotationCount =
          (sentAnnotationCounts[row.key] ?? 0) + (annotationCountFor?.(row.key) ?? 0);
        const hasText = row.text.length > 0;
        const showThinking = showReasoning && row.reasoning.trim().length > 0;
        // 自动策略只给默认值；用户手动切换过的行以 Map 里的记录为准。
        const thinkingId = `${row.key}:thinking`;
        const thinkingDefault = autoCollapseThinking ? row.streaming : true;
        const thinkingOpen = isOpen(thinkingId, thinkingDefault);
        return withEnter(
          row.key,
          <View
            key={row.key}
            style={[styles.row, styles.assistantRow, { alignItems: "flex-start" }]}
          >
            {showThinking ? (
              <View
                style={[
                  styles.thinkingChip,
                  { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                ]}
              >
                <ThinkingDisclosure
                  reasoning={row.reasoning}
                  streaming={row.streaming}
                  open={thinkingOpen}
                  onToggle={() => toggleOpen(thinkingId, thinkingDefault)}
                />
              </View>
            ) : null}
            {hasText ? (
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
                {row.model && modelChangeKeys.has(row.key) ? (
                  <Text style={[styles.model, { color: th.inkGhost }]}>{row.model}</Text>
                ) : null}
                <BodyText text={row.text} color={th.ink} />
                {row.streaming ? <StreamingCursor /> : null}
              </Pressable>
            ) : row.streaming ? (
              // 只有思考、还没出正文：气泡不渲染，光标单独跟着思考块。
              <StreamingCursor variant="outside" />
            ) : showThinking ? null : (
              <BodyText text={"…"} color={th.ink} />
            )}
            {annotationCount > 0 ? (
              <View style={styles.annotationMark}>
                <Icon name="quote" size={10} color={th.brand} />
                <Text style={[styles.annotationMarkText, { color: th.brand }]}>
                  已注释 {annotationCount}
                </Text>
              </View>
            ) : null}
          </View>,
        );
      })}
    </ScrollView>
  );
}

/** 单个工具行：折叠只有一行（图标 + 名称 + 状态词 + 目标），展开才是原有详情。 */
function ToolRowView({
  row,
  open,
  onToggle,
  agentRunning = false,
}: {
  row: Extract<ChatRow, { kind: "tool" }>;
  open: boolean;
  onToggle: () => void;
  /** 触发的子代理仍在后台跑（工具行本身已 success）：脸保持运行态，状态词显示后台运行中。 */
  agentRunning?: boolean;
}) {
  const th = useNibiTheme();
  const tone = agentRunning ? th.amber : toolTone(th, row.status);
  const target = toolTarget(row);
  const hasDetail = Boolean(row.detail || row.output || row.error);
  // Agent 工具行 = 消息流里的子代理脸（桌面 WorkflowAgentFace 同源：名字散列九色
  // 机身 + 状态表情 + 眨眼）。名字从参数摘要里提 subagent_type，提不出按 "Agent"。
  const isAgentTool = row.name === "Agent";
  const faceName =
    isAgentTool && row.detail
      ? /"subagent_type"\s*:\s*"([^"]+)"/u.exec(row.detail)?.[1] ?? "Agent"
      : row.name;
  const faceStatus: AgentFaceStatus = isAgentTool && agentRunning
    ? "running"
    : row.status === "failed" || row.status === "error"
      ? "failed"
      : row.status === "cancelled"
        ? "cancelled"
        : row.status === "running" || row.status === "inputStreaming" || row.status === "pendingApproval"
          ? "running"
          : "completed";
  const statusWord = isAgentTool && agentRunning ? "后台运行中" : toolStatusLabel(row.status);
  return (
    <View style={styles.toolRow}>
      <Disclosure
        icon={
          isAgentTool ? (
            <AgentFace name={faceName} status={faceStatus} size={18} badge />
          ) : (
            <Icon name="sliders" size={12} color={toolTone(th, row.status)} />
          )
        }
        title={
          <Text style={[styles.toolRowName, { color: th.ink }]} numberOfLines={1}>
            {row.name || "tool"}
          </Text>
        }
        subtitle={
          <Text style={[styles.toolRowMeta, { color: th.inkFaint }]} numberOfLines={1}>
            <Text style={{ color: tone }}>{statusWord}</Text>
            {target ? ` · ${target}` : ""}
          </Text>
        }
        open={open}
        onToggle={onToggle}
        rail
      >
        {hasDetail ? (
          <>
            {row.detail ? (
              <Text style={[styles.toolDetail, { color: th.inkFaint }]}>{row.detail}</Text>
            ) : null}
            {row.output ? (
              // 输出正文收进内嵌井（surfaceSoft + xs 圆角）：和卡片正文拉开一档「机器输出」的质感。
              <View style={[styles.toolOutputWell, { backgroundColor: th.surfaceSoft }]}>
                <Text
                  style={[
                    styles.toolOutput,
                    { color: row.status === "error" ? th.red : th.inkFaint },
                  ]}
                >
                  {row.output}
                </Text>
              </View>
            ) : null}
            {row.error ? (
              <Text style={[styles.toolDetail, { color: th.red }]}>{row.error}</Text>
            ) : null}
          </>
        ) : null}
      </Disclosure>
    </View>
  );
}

/** 工具状态 → 词；未知状态原样显示，不吞信息。 */
function toolStatusLabel(status: string): string {
  switch (status) {
    case "running":
    case "inputStreaming":
    case "pendingApproval":
      return "进行中";
    case "success":
      return "已完成";
    case "error":
      return "失败";
    case "cancelled":
      return "已停止";
    default:
      return status;
  }
}

function toolTone(th: NibiTheme, status: string): string {
  if (status === "error") return th.red;
  if (status === "success") return th.ok;
  if (status === "cancelled") return th.inkFaint;
  return th.amber;
}

/** 折叠行里的目标摘要：参数压成一行，只留前 ~40 字。 */
function toolTarget(row: Extract<ChatRow, { kind: "tool" }>): string {
  const raw = row.detail?.replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
}

/** 思考块：折叠一行（标签 / 耗时 / 流式尾部预览），展开是纯文本滚动区。 */
function ThinkingDisclosure({
  reasoning,
  streaming,
  open,
  onToggle,
}: {
  reasoning: string;
  streaming: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const th = useNibiTheme();
  // 只有看着它流完的思考才记耗时；历史行不知道时长就只显示“思考”。
  const startedAt = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (streaming) {
      if (startedAt.current === null) startedAt.current = Date.now();
    } else if (startedAt.current !== null) {
      setSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
      startedAt.current = null;
    }
  }, [streaming]);
  const title = seconds === undefined ? "思考" : `思考 · 持续 ${seconds} 秒`;
  const preview = streaming ? reasoningTail(reasoning) : "";
  return (
    <Disclosure
      icon={<Icon name="sparkles" size={12} color={th.inkFaint} />}
      title={
        <Text style={[styles.thinkingTitle, { color: th.inkSub }]} numberOfLines={1}>
          {streaming ? "正在思考" : title}
        </Text>
      }
      subtitle={
        preview ? (
          <Text
            style={[styles.thinkingPreview, { color: th.inkGhost }]}
            numberOfLines={1}
            ellipsizeMode="head"
          >
            {preview}
          </Text>
        ) : undefined
      }
      open={open}
      onToggle={onToggle}
      rail
    >
      <ThinkingBody text={reasoning} streaming={streaming} />
    </Disclosure>
  );
}

/** 思考正文：普通文本、限高内滚；流式时贴底，用户往上翻后不再抢滚动。 */
function ThinkingBody({ text, streaming }: { text: string; streaming: boolean }) {
  const th = useNibiTheme();
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const stickToBottom = useRef(true);
  return (
    <ScrollView
      ref={ref}
      style={styles.thinkingScroll}
      contentContainerStyle={styles.thinkingContent}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        stickToBottom.current =
          contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
      }}
      onContentSizeChange={() => {
        if (streaming && stickToBottom.current) {
          ref.current?.scrollToEnd({ animated: false });
        }
      }}
    >
      <Text style={[styles.thinkingText, { color: th.inkSub }]}>{text}</Text>
    </ScrollView>
  );
}

/** 推理的最后一行非空内容（流式预览看最新尾巴）。 */
function reasoningTail(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) <= 32) end -= 1;
  const lineStart = text.lastIndexOf("\n", end - 1) + 1;
  return text.slice(lineStart, end).trim();
}

/**
 * 一轮的过程摘要（dsh-Go TurnProcess）：默认收起，点开列出思考/工具/中间消息。
 * 卡内的思考块/工具行与顶层同一套折叠件，显隐也跟随会话级的 showReasoning/showTools。
 */
function TurnProcessCard({
  row,
  renderTool,
  isOpen,
  toggleOpen,
  showReasoning,
  showTools,
  autoCollapseThinking,
  autoCollapseTools,
  agentRunningTools,
}: {
  row: Extract<ChatRow, { kind: "process" }>;
  renderTool?: (row: Extract<ChatRow, { kind: "tool" }>) => ReactNode;
  /** 展开态与顶层共用一张 Map：卡内手动展开/收起的行同样被记住。 */
  isOpen: (id: string, fallback: boolean) => boolean;
  toggleOpen: (id: string, fallback: boolean) => void;
  /** 会话级开关同样作用于卡内：思考块 / 工具行按需隐藏。 */
  showReasoning: boolean;
  showTools: boolean;
  autoCollapseThinking: boolean;
  autoCollapseTools: boolean;
  /** 仍在后台跑的子代理对应的工具行 key（TurnProcessCard 传给子工具行）。 */
  agentRunningTools?: Set<string>;
}) {
  const th = useNibiTheme();
  const [open, setOpen] = useState(false);
  const parts = ["✓ 已完成"];
  if (row.toolCalls > 0) parts.push(`${row.toolCalls} 次工具`);
  if (row.messages > 0) parts.push(`${row.messages} 条消息`);
  const label = parts.join(" · ");
  // 先按会话级开关过滤子行：showReasoning 管思考块（正文消息保留），
  // showTools 管工具/工具组；其余子行（子智能体/通知）不受影响。
  const visible = row.rows.filter((child) => {
    if (child.kind === "assistant") {
      const hasReasoning = showReasoning && child.reasoning.trim().length > 0;
      return hasReasoning || child.text.length > 0;
    }
    if (child.kind === "tool" || child.kind === "toolGroup") return showTools;
    return true;
  });
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
      {open && visible.length > 0 ? (
        <View style={[styles.processBody, { borderLeftColor: th.hairline }]}>
          {visible.map((child) => (
            <ProcessChild
              key={child.key}
              row={child}
              renderTool={renderTool}
              isOpen={isOpen}
              toggleOpen={toggleOpen}
              autoCollapseThinking={autoCollapseThinking}
              autoCollapseTools={autoCollapseTools}
              agentRunningTools={agentRunningTools}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 折叠里的行：思考块/工具行与顶层同一套折叠件，中间消息/子智能体/通知保持纯文本。 */
function ProcessChild({
  row,
  renderTool,
  isOpen,
  toggleOpen,
  autoCollapseThinking,
  autoCollapseTools,
  agentRunningTools,
}: {
  row: ChatRow;
  renderTool?: (row: Extract<ChatRow, { kind: "tool" }>) => ReactNode;
  isOpen: (id: string, fallback: boolean) => boolean;
  toggleOpen: (id: string, fallback: boolean) => void;
  autoCollapseThinking: boolean;
  autoCollapseTools: boolean;
  agentRunningTools?: Set<string>;
}) {
  const th = useNibiTheme();
  if (row.kind === "assistant") {
    // 思考与顶层思考块同款（ThinkingDisclosure + chip 外壳）；中间正文仍用 processText。
    const thinkingDefault = autoCollapseThinking ? row.streaming : true;
    return (
      <View style={styles.processBlock}>
        {row.reasoning.trim().length > 0 ? (
          <View
            style={[styles.thinkingChip, { backgroundColor: th.card, borderColor: th.hairline }]}
          >
            <ThinkingDisclosure
              reasoning={row.reasoning}
              streaming={row.streaming}
              open={isOpen(row.key, thinkingDefault)}
              onToggle={() => toggleOpen(row.key, thinkingDefault)}
            />
          </View>
        ) : null}
        {row.text.length > 0 ? (
          <Text style={[styles.processText, { color: th.inkSub }]}>{row.text}</Text>
        ) : null}
      </View>
    );
  }
  if (row.kind === "tool") {
    // 插件卡优先（回合结束后工具卡不消失），否则退回与顶层一致的可折叠工具行。
    const pluginCard = renderTool?.(row);
    if (pluginCard) return pluginCard;
    return (
      <ToolRowView
        row={row}
        open={isOpen(row.key, !autoCollapseTools)}
        onToggle={() => toggleOpen(row.key, !autoCollapseTools)}
        agentRunning={agentRunningTools?.has(row.key) ?? false}
      />
    );
  }
  if (row.kind === "toolGroup") {
    // 组内每个工具各给一行可折叠摘要，与顶层工具组的展开体一致。
    return (
      <View style={styles.processBlock}>
        {row.tools.map((tool) => (
          <ToolRowView
            key={tool.key}
            row={tool}
            open={isOpen(tool.key, !autoCollapseTools)}
            onToggle={() => toggleOpen(tool.key, !autoCollapseTools)}
            agentRunning={agentRunningTools?.has(tool.key) ?? false}
          />
        ))}
      </View>
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

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

// 字阶取整规则：≤11.5 收到 micro(11)，12–12.5 收到 small(12.5)，14 收到 body——
// 行高一律用 text() 配对值，不再手写 lineHeight（原 15/17 与配对值一致，其余差 1px 非刻意）。
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
  model: { ...text("micro") },
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
  messageTokenText: { ...text("micro"), fontWeight: "700", flexShrink: 1 },
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
  quoteNumberText: { ...text("micro"), fontWeight: "700" },
  quoteBody: { flex: 1, minWidth: 0, gap: 1 },
  quoteExcerpt: { ...text("micro") },
  quoteNote: { ...text("micro") },
  annotationMark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
    marginLeft: space(1),
  },
  annotationMarkText: { ...text("micro"), fontWeight: "600" },
  text: { ...text("body") },
  inlineCode: {
    fontFamily: "monospace",
    ...text("small"),
  },
  streaming: { ...text("body"), fontWeight: "700" },
  streamingSmall: { ...text("micro"), fontWeight: "700" },
  streamingOutside: { ...text("body"), fontWeight: "700", marginTop: 2 },
  pendingHint: { ...text("micro") },
  pendingHintRow: { flexDirection: "row", alignItems: "center", gap: space(1) },
  assistantRow: { gap: space(1.5) },
  // 思考块与气泡同列宽：折叠行能稳定做 head 省略，展开的滚动区也有确定宽度。
  // 底色用 surfaceSoft 与正文卡（card）拉开一档——之前同色相邻黏成一列灰块（2.0.1 审查）。
  thinkingChip: {
    width: "86%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(2.5),
    paddingVertical: 2,
  },
  thinkingTitle: { ...text("micro"), fontWeight: "600" },
  thinkingPreview: { ...text("micro") },
  thinkingScroll: { maxHeight: 240 },
  thinkingContent: { paddingRight: space(1), paddingBottom: space(1) },
  thinkingText: { ...text("small") },
  toolRow: { paddingVertical: 1 },
  toolRowName: { ...text("small"), fontWeight: "600" },
  toolRowMeta: { ...text("micro") },
  turn: { ...text("micro"), textAlign: "center" },
  turnHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    flexWrap: "wrap",
  },
  retry: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
    marginTop: 2,
  },
  retryText: { ...text("micro"), fontWeight: "600" },
  turnNote: { ...text("micro"), textAlign: "center" },
  turnBlock: { gap: space(2) },
  process: { gap: 2 },
  processHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    minHeight: size.chipLg,
  },
  processTitle: { ...text("micro"), fontWeight: "600" },
  processBody: {
    borderLeftWidth: 2,
    paddingLeft: space(3),
    marginLeft: space(1),
    paddingVertical: space(1),
    gap: space(2),
  },
  processBlock: { gap: 2 },
  processText: { ...text("small") },
  processTool: { ...text("micro") },
  notice: { ...text("micro"), textAlign: "center", paddingHorizontal: space(2) },
  toolHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  toolName: { flex: 1, ...text("small"), fontWeight: "700" },
  toolStatus: { ...text("micro"), fontWeight: "600" },
  toolDetail: { ...text("micro") },
  // 工具输出井：内嵌面 + xs 圆角 + 等宽字，「机器输出」与正文拉开一档。
  toolOutputWell: {
    borderRadius: radius.xs,
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
  },
  toolOutput: { fontFamily: "monospace", ...text("micro") },
  subagentHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
  },
  subagent: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: 4,
  },
  subagentTitleCol: { flex: 1, minWidth: 0, gap: 1 },
  subagentStatus: { ...text("micro"), fontWeight: "600" },
  subagentFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  subagentMeta: { ...text("micro") },
  subagentLink: { ...text("micro"), fontWeight: "600" },
  changes: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: space(1),
  },
  fileRow: { flexDirection: "row", alignItems: "baseline", gap: space(2) },
  fileName: { ...text("small"), fontWeight: "600", flexShrink: 0, maxWidth: "48%" },
  fileDir: { flex: 1, ...text("micro") },
  fileStat: { ...text("micro"), fontWeight: "600" },
  fileMore: { ...text("micro"), marginTop: 2 },
});
