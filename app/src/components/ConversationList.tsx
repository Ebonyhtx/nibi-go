// 会话消息流（首页正文区）。行模型对齐 dsh-Go 的 ChatRow：
//   用户 = 右侧品牌软色气泡；
//   助手 = 思考折叠块（在气泡上方）+ 白卡正文 + 流式光标 + 模型标签；
//   工具 = 可折叠的一行摘要（名称 + 状态词 + 目标），展开才是输入/输出。
// 只渲染 @nibi-go/kernel-session 的行模型，不碰协议。
import type { ChatFileChange, ChatRow } from "@nibi-go/kernel-session";
import { resolveText, resolveView } from "@nibi-go/plugin-contract";
import type { AttachmentRef, ConversationSelectionText } from "@nibi-go/shared-extract";
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
} from "@shopify/flash-list";
import {
  memo,
  type ComponentRef,
  type ReactNode,
  useCallback,
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

import { pickText, useI18n } from "../i18n";
import { AppearIn } from "../motion/appear";
import { easingStandard } from "../motion/easing";
import { haptic } from "../motion/haptics";
import { PressableScale } from "../motion/PressableScale";
import { hostSlotData, toolSlotData } from "../plugins/data";
import { collectTurnPushes } from "../plugins/push";
import type { LoadedPlugin } from "../plugins/store";
import { parseComposerText, type ComposerDisplayToken } from "../plugins/tokens";
import { usePhoneApprovalOverlay } from "../phone/approval";
import { motion, radius, size, space, text, type NibiTheme, useNibiTheme } from "../theme";
import { AgentFace, type AgentFaceStatus } from "./AgentFace";
import { Disclosure } from "./Disclosure";
import { Icon, type IconName } from "./Icon";
import {
  friendlyToolIcon,
  friendlyToolName,
  friendlyToolTarget,
} from "../conversation/toolLabels";
import { InteractionCard, type InteractionResponder } from "./InteractionCards";
import {
  matchPluginToolCard,
  PluginToolCard,
  type PluginActionHandler,
} from "./PluginView";
import {
  ArtifactCard,
  MessageMarkdown,
  PendingArtifactCard,
  hasMarkdownSyntax,
  splitPendingArtifact,
  splitVisualArtifacts,
} from "./MessageMarkdown";
import type { PopupAnchor } from "./PluginPopup";

/** 消息正文：按 `` `行内代码` `` 切段，代码段给等宽字 + 井底色——
 * 之前反引号原样露在正文里（2.0.1 审查 P0）。memo：历史气泡 text 不变时跳过 split。 */
const BodyText = memo(function BodyText({ text, color }: { text: string; color: string }) {
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
});

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
  const { pick } = useI18n();
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
                  {pick("改写引用", "Rewrite quote")}
                </Text>
              ) : (
                <>
                  {quote.instruction ? (
                    <Text style={[styles.quoteNote, { color: th.brand }]} numberOfLines={1}>
                      {pick("指令：", "Action: ")}
                      {quote.instruction}
                    </Text>
                  ) : null}
                  {quote.comment?.trim() ? (
                    <Text style={[styles.quoteNote, { color: th.ink }]} numberOfLines={2}>
                      {quote.comment.trim()}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 气泡下方统一的注释标记胶囊：区分已发与待发，点击直达注释管理或新增注释。 */
function AnnotationMarkPill({
  draftCount,
  sentCount,
  onPress,
}: {
  draftCount: number;
  sentCount: number;
  onPress?: () => void;
}) {
  const th = useNibiTheme();
  const { pick } = useI18n();
  if (draftCount <= 0 && sentCount <= 0) return null;
  const label =
    draftCount > 0 && sentCount > 0
      ? pick(`已注释 ${sentCount} · 待发 ${draftCount}`, `${sentCount} annotated · ${draftCount} draft`)
      : draftCount > 0
        ? pick(`待发注释 ${draftCount}`, `${draftCount} draft note${draftCount > 1 ? "s" : ""}`)
        : pick(`已注释 ${sentCount}`, `${sentCount} annotated`);
  const highlighted = draftCount > 0;
  return (
    <PressableScale
      scaleTo={0.95}
      onPress={() => {
        haptic("tap");
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.annotationMark,
        {
          backgroundColor: highlighted ? th.brandSoft : th.surfaceSoft,
          borderColor: highlighted ? th.brand : th.hairline,
        },
      ]}
    >
      <Icon name="quote" size={10} color={highlighted ? th.brand : th.inkSub} />
      <Text
        style={[
          styles.annotationMarkText,
          { color: highlighted ? th.brand : th.inkSub },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/** 行的数值身份：rowId 优先（user/turn 行带），其余从 key 尾部取数——内核的 r12/t34/turn56
 * 尾数都是单调 id，可以跨行种比大小；取不出数字的（审批/提问的字符串 id）当 null，不参与判定。 */
function rowNumericId(row: ChatRow): number | null {
  if ("rowId" in row && typeof row.rowId === "number") return row.rowId;
  const match = /(\d+)$/.exec(row.key);
  return match ? Number(match[1]) : null;
}

function ConversationListImpl({
  rows,
  onRespond,
  turnChanges,
  onOpenSession,
  plugins,
  onPluginAction,
  bottomInset = 0,
  onMessageLongPress,
  draftAnnotationCounts,
  onAnnotationMarkPress,
  scrollToMessage = null,
  showReasoning = true,
  showTools = true,
  autoCollapseThinking = true,
  autoCollapseTools = true,
  onRetryTurn,
  onAtBottomChange,
  jumpSignal = 0,
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
    messageId?: string,
  ) => void;
  /** 每条消息当前待发送的注释条数映射（作为显式 prop 透传，避免 memo 读到旧 ref）。 */
  draftAnnotationCounts?: Readonly<Record<string, number>>;
  /** 点击消息下方注释徽标：有待发注释时打开按此消息筛选的管理抽屉，否则新增注释。 */
  onAnnotationMarkPress?: (
    messageKey: string,
    hasDraft: boolean,
    messageText: string,
    messageRole: "user" | "assistant",
    messageId?: string,
  ) => void;
  /** 从注释管理器定位回对应消息的触发信号。 */
  scrollToMessage?: { key: string; seq: number } | null;
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
  /** 是否停在最新消息（父级「回到底部」浮钮的显隐依据）。 */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** 递增信号：父级浮钮点击后让列表跳到底部。 */
  jumpSignal?: number;
}) {
  const th = useNibiTheme();
  const { locale } = useI18n();
  const { isOverlayApproval } = usePhoneApprovalOverlay(rows, onRespond);
  const ref = useRef<FlashListRef<ChatRow> | null>(null);
  // 只有用户本来就在底部时才自动跟随；往上翻历史时不抢滚动。
  const stickToBottom = useRef(true);
  // 折叠态的展开/收起只存本地：键是稳定行 id，手动切换后不再被自动策略覆盖。
  const toggles = useRef(new Map<string, boolean>());
  const [toggleTick, setToggleTick] = useState(0);
  const isOpen = useCallback(
    (id: string, fallback: boolean) => toggles.current.get(id) ?? fallback,
    [],
  );
  const toggleOpen = useCallback((id: string, fallback: boolean) => {
    toggles.current.set(id, !(toggles.current.get(id) ?? fallback));
    setToggleTick((value) => value + 1);
  }, []);

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
    // pending、流式助手、实时审批/提问卡都是直播事件，无条件优雅入场。
    for (const row of rows) {
      if (
        row.kind === "pending" ||
        row.kind === "approval" ||
        row.kind === "question" ||
        (row.kind === "assistant" && row.streaming)
      ) {
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
    // 用一次建好的 key 集合做 O(n) 清理（原来是每个 sticky key 都 rows.some → O(n²)，
    // 长会话流式时会随历史长度平方增长）。
    const rowKeys = new Set<string>();
    for (const row of rows) rowKeys.add(row.key);
    const enter = new Set(keys);
    for (const key of [...enterKeysRef.current]) {
      if (rowKeys.has(key)) enter.add(key);
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

  /**
   * 工具行 → 插件卡（没有匹配/插件停用时 undefined，调用方退回普通工具行）。
   * 折叠后的过程行也用它，保证回合结束后工具卡不会消失。
   */
  const renderPluginTool = useCallback(
    (row: Extract<ChatRow, { kind: "tool" }>): ReactNode => {
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
    },
    [plugins, onPluginAction],
  );

  // 「回到底部」状态机：带滞回（离开 >80px、回到 <24px）与 ref 守卫，
  // 避免临界抖动和每帧重复 setState；并且只在流式/新行到达/回合刚落定时自动贴底，
  // 手动点开思考或工具详情不再把列表强拽回底部。
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const isUserDraggingRef = useRef(false);
  const hasStreamingRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const prevRowCountRef = useRef(rows.length);
  const prevFirstKeyRef = useRef<string | undefined>(rows[0]?.key);
  const prevLastKeyRef = useRef<string | undefined>(rows[rows.length - 1]?.key);
  const pendingAutoScrollRef = useRef(rows.length > 0);
  const autoScrollUntilRef = useRef(0);
  const updateAtBottom = useCallback((next: boolean) => {
    if (next === atBottomRef.current) return;
    atBottomRef.current = next;
    setAtBottom(next);
  }, []);
  const nowStreaming = rows.some(
    (row) => row.kind === "pending" || (row.kind === "assistant" && row.streaming),
  );
  // 流式结束（true -> false）瞬间：思考块自动收起、中间过程折叠进 ProcessGroup、
  // 正文从 BodyText 切到 MessageMarkdown 并追加 turn 脚注——这几个布局高度重算在
  // 随后 ~450ms 内陆续触发 onContentSizeChange，必须保持自动贴底窗口。
  if (wasStreamingRef.current && !nowStreaming) {
    pendingAutoScrollRef.current = true;
    autoScrollUntilRef.current = Date.now() + 500;
  }
  wasStreamingRef.current = nowStreaming;
  hasStreamingRef.current = nowStreaming;
  // 换会话（首行身份变化或列表清空）时重置贴底状态与增量入场游标。
  if (rows[0]?.key !== prevFirstKeyRef.current) {
    prevFirstKeyRef.current = rows[0]?.key;
    prevLastKeyRef.current = rows[rows.length - 1]?.key;
    maxSeenRowIdRef.current = null;
    stickToBottom.current = true;
    pendingAutoScrollRef.current = rows.length > 0;
    autoScrollUntilRef.current = Date.now() + 500;
    updateAtBottom(true);
  }
  const currentLastKey = rows[rows.length - 1]?.key;
  if (rows.length !== prevRowCountRef.current || currentLastKey !== prevLastKeyRef.current) {
    pendingAutoScrollRef.current = true;
    autoScrollUntilRef.current = Date.now() + 450;
    prevRowCountRef.current = rows.length;
    prevLastKeyRef.current = currentLastKey;
  }
  useEffect(() => {
    if (!stickToBottom.current || isUserDraggingRef.current || rows.length === 0) return;
    if (hasStreamingRef.current || pendingAutoScrollRef.current || Date.now() < autoScrollUntilRef.current) {
      ref.current?.scrollToEnd({ animated: false });
      const timer = setTimeout(() => {
        if (stickToBottom.current && !isUserDraggingRef.current && rows.length > 0) {
          ref.current?.scrollToEnd({ animated: false });
        }
      }, 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [rows.length, currentLastKey, nowStreaming]);
  useEffect(() => {
    onAtBottomChange?.(atBottom);
  }, [atBottom, onAtBottomChange]);
  // 父级浮钮点击后通过信号触发跳底（组件内部维持滚动引用）。
  const jumpSignalRef = useRef(jumpSignal);
  useEffect(() => {
    if (jumpSignal === jumpSignalRef.current) return;
    jumpSignalRef.current = jumpSignal;
    stickToBottom.current = true;
    updateAtBottom(true);
    ref.current?.scrollToEnd({ animated: true });
  }, [jumpSignal, updateAtBottom]);

  // 注释管理器点击「定位原消息」：滚到对应行并松开贴底跟随。
  const scrollTargetSeqRef = useRef(0);
  useEffect(() => {
    if (!scrollToMessage || scrollToMessage.seq === scrollTargetSeqRef.current) return;
    scrollTargetSeqRef.current = scrollToMessage.seq;
    const index = rows.findIndex((entry) => entry.key === scrollToMessage.key);
    if (index < 0) return;
    stickToBottom.current = false;
    updateAtBottom(false);
    try {
      ref.current?.scrollToIndex({ index, animated: true, viewPosition: 0.35 });
    } catch {
      // FlashList 尚未测量完该偏移时静默降级
    }
  }, [rows, scrollToMessage, updateAtBottom]);

  const keyExtractor = useCallback((row: ChatRow) => row.key, []);
  const getItemType = useCallback((row: ChatRow) => row.kind, []);

  const extraData = useMemo(
    () => ({
      agentRunningTools,
      showReasoning,
      showTools,
      autoCollapseThinking,
      autoCollapseTools,
      plugins,
      turnChanges,
      turnPushes,
      sentAnnotationCounts,
      draftAnnotationCounts,
      modelChangeKeys,
      enterKeys,
      toggleTick,
      th,
      locale,
    }),
    [
      agentRunningTools,
      showReasoning,
      showTools,
      autoCollapseThinking,
      autoCollapseTools,
      plugins,
      turnChanges,
      turnPushes,
      sentAnnotationCounts,
      draftAnnotationCounts,
      modelChangeKeys,
      enterKeys,
      toggleTick,
      th,
      locale,
    ],
  );

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<ChatRow>) => (
      <ConversationRowItem
        row={row}
        enter={enterKeys.has(row.key)}
        modelChanged={modelChangeKeys.has(row.key)}
        sentAnnotationCount={sentAnnotationCounts[row.key] ?? 0}
        draftAnnotationCount={draftAnnotationCounts?.[row.key] ?? 0}
        turnFiles={row.kind === "turn" ? (turnChanges[row.key] ?? EMPTY_FILES) : EMPTY_FILES}
        turnPushMap={row.kind === "turn" ? turnPushes.get(row.key) : undefined}
        overlayApproval={row.kind === "approval" && isOverlayApproval(row)}
        agentRunningTools={agentRunningTools}
        showReasoning={showReasoning}
        showTools={showTools}
        autoCollapseThinking={autoCollapseThinking}
        autoCollapseTools={autoCollapseTools}
        plugins={plugins}
        onRespond={onRespond}
        onOpenSession={onOpenSession}
        onMessageLongPress={onMessageLongPress}
        onAnnotationMarkPress={onAnnotationMarkPress}
        onRetryTurn={onRetryTurn}
        isOpen={isOpen}
        toggleOpen={toggleOpen}
        renderPluginTool={renderPluginTool}
      />
    ),
    [
      enterKeys,
      modelChangeKeys,
      sentAnnotationCounts,
      draftAnnotationCounts,
      turnChanges,
      turnPushes,
      isOverlayApproval,
      agentRunningTools,
      showReasoning,
      showTools,
      autoCollapseThinking,
      autoCollapseTools,
      plugins,
      onRespond,
      onOpenSession,
      onMessageLongPress,
      onAnnotationMarkPress,
      onRetryTurn,
      isOpen,
      toggleOpen,
      renderPluginTool,
    ],
  );

  const listFooter = useMemo(
    () => <View style={{ height: bottomInset > 0 ? space(2) + bottomInset : space(3.5) }} />,
    [bottomInset],
  );
  // 禁用 FlashList v2 默认开启的 maintainVisibleContentPosition：
  // 它的 applyOffsetCorrection 会锚定首屏顶部或上次惯性滚动停止时的第一条可见项（firstVisibleItemKey），
  // 导致回合结束折叠过程行/追加 turn 脚注（data 变化）时把滚动条强行拉回旧消息甚至列表最顶部。
  const mvcpConfig = useMemo(() => ({ disabled: true }), []);

  return (
    <View style={styles.scrollWrap}>
      <FlashList<ChatRow>
        ref={ref}
        style={styles.scroll}
        data={rows}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        drawDistance={600}
        maintainVisibleContentPosition={mvcpConfig}
        renderItem={renderItem}
        extraData={extraData}
        ItemSeparatorComponent={RowSeparator}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={listFooter}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        onScrollBeginDrag={() => {
          isUserDraggingRef.current = true;
        }}
        onScrollEndDrag={() => {
          isUserDraggingRef.current = false;
        }}
        onMomentumScrollEnd={() => {
          isUserDraggingRef.current = false;
        }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const distanceFromBottom =
            contentSize.height - (contentOffset.y + layoutMeasurement.height);
          const next = atBottomRef.current
            ? distanceFromBottom <= 80
            : distanceFromBottom <= 24;
          // 仅在用户主动滑动或接近底部时更新 stickToBottom，防止展开折叠块或回合折叠误断贴底。
          if (isUserDraggingRef.current || next) {
            stickToBottom.current = next;
            updateAtBottom(next);
          }
        }}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (
            stickToBottom.current &&
            !isUserDraggingRef.current &&
            (hasStreamingRef.current ||
              pendingAutoScrollRef.current ||
              Date.now() < autoScrollUntilRef.current)
          ) {
            pendingAutoScrollRef.current = false;
            ref.current?.scrollToEnd({ animated: false });
          }
        }}
        onLoad={() => {
          if (stickToBottom.current && rows.length > 0) {
            ref.current?.scrollToEnd({ animated: false });
          }
        }}
        onLayout={() => {
          // 键盘/旋转改变可视高度时也贴底，避免最后一条被输入栏或宠物切一半。
          if (stickToBottom.current && !isUserDraggingRef.current) {
            ref.current?.scrollToEnd({ animated: false });
          }
        }}
      />
    </View>
  );
}

const EMPTY_FILES: readonly ChatFileChange[] = [];

const ListHeader = memo(function ListHeader() {
  return <View style={styles.listHeader} />;
});

const RowSeparator = memo(function RowSeparator() {
  return <View style={styles.rowSeparator} />;
});

/** 单行消息渲染项：承接 FlashList 虚拟化行渲染与纸上鸟 2.0 精致气泡层级。 */
function ConversationRowItem({
  row,
  enter,
  modelChanged,
  sentAnnotationCount,
  draftAnnotationCount,
  turnFiles,
  turnPushMap,
  overlayApproval,
  agentRunningTools,
  showReasoning,
  showTools,
  autoCollapseThinking,
  autoCollapseTools,
  plugins,
  onRespond,
  onOpenSession,
  onMessageLongPress,
  onAnnotationMarkPress,
  onRetryTurn,
  isOpen,
  toggleOpen,
  renderPluginTool,
}: {
  row: ChatRow;
  enter: boolean;
  modelChanged: boolean;
  sentAnnotationCount: number;
  draftAnnotationCount: number;
  turnFiles: readonly ChatFileChange[];
  turnPushMap?: ReadonlyMap<string, Record<string, unknown>>;
  overlayApproval: boolean;
  agentRunningTools: Set<string>;
  showReasoning: boolean;
  showTools: boolean;
  autoCollapseThinking: boolean;
  autoCollapseTools: boolean;
  plugins?: readonly LoadedPlugin[];
  onRespond: InteractionResponder;
  onOpenSession?: (sessionId: string) => void;
  onMessageLongPress?: (
    messageKey: string,
    message: string,
    anchor: PopupAnchor,
    messageRole: "user" | "assistant",
    messageId?: string,
  ) => void;
  onAnnotationMarkPress?: (
    messageKey: string,
    hasDraft: boolean,
    messageText: string,
    messageRole: "user" | "assistant",
    messageId?: string,
  ) => void;
  onRetryTurn?: (target: { rowId: number; entityId: string }) => void;
  isOpen: (id: string, fallback: boolean) => boolean;
  toggleOpen: (id: string, fallback: boolean) => void;
  renderPluginTool: (row: Extract<ChatRow, { kind: "tool" }>) => ReactNode;
}) {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const wrapEnter = (node: ReactNode): ReactNode =>
    enter ? <AppearIn distance={6}>{node}</AppearIn> : node;

  if (row.kind === "pending") {
    const parsed = parseComposerText(row.text, plugins ?? []);
    return wrapEnter(
      <View style={[styles.row, { alignItems: "flex-end" }]}>
        <View
          style={[
            styles.bubble,
            styles.bubbleUser,
            { backgroundColor: th.brandSoft, borderColor: th.hairlineStrong, opacity: 0.65 },
          ]}
        >
          <MessageAttachments attachments={row.attachments ?? []} />
          <AnnotationQuoteCards quotes={row.conversationQuotes ?? []} plugins={plugins} />
          <MessageTokens tokens={parsed.tokens} plugins={plugins} />
          {parsed.body.length > 0 ? <BodyText text={parsed.body} color={th.ink} /> : null}
          {/* 发送中的乐观气泡也带同款光标：和助手流式共用一套「正在直播」的语言。 */}
          <View style={styles.pendingHintRow}>
            <StreamingCursor variant="small" />
            <Text style={[styles.pendingHint, { color: th.inkFaint }]}>
              {pick("发送中…", "Sending…")}
            </Text>
          </View>
        </View>
      </View>,
    );
  }

  if (row.kind === "user") {
    const parsed = parseComposerText(row.text, plugins ?? []);
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
    return wrapEnter(
      <View style={[styles.row, { alignItems: "flex-end" }]}>
        <Pressable
          onLongPress={
            onMessageLongPress
              ? (event) => {
                  haptic("longPress");
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
                    row.entityId,
                  );
                }
              : undefined
          }
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityLabel={pick("用户消息，长按添加注释", "User message, long press to annotate")}
          style={({ pressed }) => [
            styles.bubble,
            styles.bubbleUser,
            hasQuotes && styles.bubbleWide,
            { backgroundColor: th.brandSoft, borderColor: th.brand },
            pressed ? { opacity: 0.88 } : null,
          ]}
        >
          <MessageAttachments attachments={row.attachments ?? []} />
          <AnnotationQuoteCards quotes={row.conversationQuotes ?? []} plugins={plugins} />
          <MessageTokens tokens={parsed.tokens} plugins={plugins} />
          {parsed.body.length > 0 ? <BodyText text={parsed.body} color={th.ink} /> : null}
        </Pressable>
        <AnnotationMarkPill
          draftCount={draftAnnotationCount}
          sentCount={sentAnnotationCount}
          onPress={
            onAnnotationMarkPress
              ? () =>
                  onAnnotationMarkPress(
                    row.key,
                    draftAnnotationCount > 0,
                    displayText || row.text,
                    "user",
                    row.entityId,
                  )
              : undefined
          }
        />
      </View>,
    );
  }

  if (row.kind === "tool") {
    // 插件工具卡：MCP 工具的 display 命中某个已启用插件的 toolCard。
    // 没有匹配/插件停用就退回普通工具行（降级为纯文本，不影响会话）。
    if (!showTools) return null;
    const pluginCard = renderPluginTool(row);
    if (pluginCard) return wrapEnter(pluginCard);
    return wrapEnter(
      <ToolRowView
        row={row}
        open={isOpen(row.key, !autoCollapseTools)}
        onToggle={() => toggleOpen(row.key, !autoCollapseTools)}
        agentRunning={agentRunningTools.has(row.key)}
      />,
    );
  }

  if (row.kind === "toolGroup") {
    if (!showTools) return null;
    return wrapEnter(
      <ToolGroupView
        row={row}
        isOpen={isOpen}
        toggleOpen={toggleOpen}
        autoCollapseTools={autoCollapseTools}
        agentRunningTools={agentRunningTools}
      />,
    );
  }

  if (row.kind === "turn") {
    return wrapEnter(
      <TurnFooterView
        row={row}
        files={turnFiles}
        plugins={plugins}
        turnPushMap={turnPushMap}
        onRetryTurn={onRetryTurn}
      />,
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
        ? pick("后台运行中", "Running in background")
        : pick("进行中", "Running")
      : row.status === "failed"
        ? pick("失败", "Failed")
        : row.status === "cancelled"
          ? pick("已停止", "Stopped")
          : pick("已完成", "Done");
    const showFoot = row.backgrounded || (row.childSessionId && onOpenSession);
    return wrapEnter(
      <View
        style={[styles.subagent, { backgroundColor: th.card, borderColor: th.hairline }]}
      >
        <View style={styles.subagentHead}>
          <AgentFace name={row.subagentType} status={faceStatus} size={22} badge />
          <View style={styles.subagentTitleCol}>
            <Text style={[styles.toolName, { color: th.ink }]} numberOfLines={1}>
              {pick("子智能体", "Subagent")} · {row.subagentType}
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
              {row.backgrounded ? pick("后台运行", "Background") : ""}
            </Text>
            {row.childSessionId && onOpenSession ? (
              <Pressable
                onPress={() => onOpenSession(row.childSessionId as string)}
                accessibilityRole="button"
                accessibilityLabel={pick("查看子会话", "View sub-session")}
                hitSlop={6}
              >
                <Text style={[styles.subagentLink, { color: th.steel }]}>
                  {pick("查看子会话 ›", "View sub-session ›")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>,
    );
  }

  if (row.kind === "process") {
    // 过程卡里的思考/工具也走顶层同一套折叠件，并尊重 showReasoning/showTools。
    return wrapEnter(
      <ProcessGroupView
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
    if (overlayApproval) return null;
    return wrapEnter(<InteractionCard row={row} onRespond={onRespond} />);
  }

  if (row.kind === "notice") {
    return wrapEnter(
      <Text
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
  const hasText = row.text.length > 0;
  const showThinking = showReasoning && row.reasoning.trim().length > 0;
  // 自动策略只给默认值；用户手动切换过的行以 Map 里的记录为准。
  const thinkingId = `${row.key}:thinking`;
  const thinkingDefault = autoCollapseThinking ? row.streaming : true;
  const thinkingOpen = isOpen(thinkingId, thinkingDefault);
  return wrapEnter(
    <View style={[styles.row, styles.assistantRow, { alignItems: "flex-start" }]}>
      {showThinking ? (
        <View
          style={[
            thinkingOpen || row.streaming ? styles.thinkingChip : styles.thinkingPill,
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
      {hasText && row.streaming ? (
        (() => {
          // 流式中若已出现 markdown 结构或 html/svg 围栏，提前用平铺宽容器（bubbleFlat）
          // 承接，落定后宽度与字号完全连续，不再从 86% 白卡突然跳成 100% 平铺；
          // 未闭合的 html/svg 围栏先收成占位卡，不再摊出几百行源码再瞬间塌缩。
          const streamingMd = hasMarkdownSyntax(row.text);
          const pendingArt = streamingMd ? splitPendingArtifact(row.text) : null;
          const visibleText = pendingArt ? pendingArt.prefix : row.text;
          return (
            <View style={streamingMd ? styles.bubbleFlat : undefined}>
              <Pressable
                onLongPress={
                  onMessageLongPress
                    ? (event) => {
                        haptic("longPress");
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
                        );
                      }
                    : undefined
                }
                delayLongPress={350}
                accessibilityRole="button"
                accessibilityLabel={pick("助手消息，长按打开动作", "Assistant message, long press for actions")}
                style={({ pressed }) => [
                  streamingMd
                    ? null
                    : [
                        styles.bubble,
                        styles.bubbleAssistant,
                        { backgroundColor: th.card, borderColor: th.hairline },
                        th.elevation.card,
                      ],
                  pressed ? { opacity: 0.88 } : null,
                ]}
              >
                {row.model && modelChanged ? (
                  <Text style={[styles.model, { color: th.inkGhost }]}>{row.model}</Text>
                ) : null}
                {visibleText.length > 0 ? <BodyText text={visibleText} color={th.ink} /> : null}
                {!pendingArt?.pendingLang ? <StreamingCursor /> : null}
              </Pressable>
              {pendingArt?.pendingLang ? (
                <PendingArtifactCard
                  lang={pendingArt.pendingLang}
                  lines={pendingArt.pendingLines}
                />
              ) : null}
            </View>
          );
        })()
      ) : hasText && hasMarkdownSyntax(row.text) ? (
        // 落定的富排版：平铺（桌面客户端消息流同款），按围栏切片——工件卡
        // 渲染在长按 Pressable 之外（嵌套 Pressable 会被外层吞掉触摸）。
        <View style={styles.bubbleFlat}>
          {row.model && modelChanged ? (
            <Text style={[styles.model, { color: th.inkGhost }]}>{row.model}</Text>
          ) : null}
          {(() => {
            const split = splitVisualArtifacts(row.text);
            return split.segments.map((segment, index) =>
              segment.kind === "artifact" ? (
                <ArtifactCard
                  key={`a${segment.value}`}
                  artifact={split.artifacts[Number(segment.value)]!}
                />
              ) : (
                <Pressable
                  key={`m${index}`}
                  onLongPress={
                    onMessageLongPress
                      ? (event) => {
                          haptic("longPress");
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
                          );
                        }
                      : undefined
                  }
                  delayLongPress={350}
                  accessibilityRole="button"
                  accessibilityLabel={pick("助手消息，长按打开动作", "Assistant message, long press for actions")}
                  style={({ pressed }) => (pressed ? { opacity: 0.88 } : null)}
                >
                  <MessageMarkdown text={segment.value} />
                </Pressable>
              ),
            );
          })()}
        </View>
      ) : hasText ? (
        <Pressable
          onLongPress={
            onMessageLongPress
              ? (event) => {
                  haptic("longPress");
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
                  );
                }
              : undefined
          }
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityLabel={pick("助手消息，长按打开动作", "Assistant message, long press for actions")}
          style={({ pressed }) => [
            styles.bubble,
            styles.bubbleAssistant,
            { backgroundColor: th.card, borderColor: th.hairline },
            th.elevation.card,
            pressed ? { opacity: 0.88 } : null,
          ]}
        >
          {row.model && modelChanged ? (
            <Text style={[styles.model, { color: th.inkGhost }]}>{row.model}</Text>
          ) : null}
          <BodyText text={row.text} color={th.ink} />
        </Pressable>
      ) : row.streaming ? (
        // 只有思考、还没出正文：气泡不渲染，光标单独跟着思考块。
        <StreamingCursor variant="outside" />
      ) : showThinking ? null : (
        <BodyText text={"…"} color={th.ink} />
      )}
      <AnnotationMarkPill
        draftCount={draftAnnotationCount}
        sentCount={sentAnnotationCount}
        onPress={
          onAnnotationMarkPress && hasText
            ? () =>
                onAnnotationMarkPress(
                  row.key,
                  draftAnnotationCount > 0,
                  row.text,
                  "assistant",
                )
            : undefined
        }
      />
    </View>,
  );
}

/** 抽屉开合、键盘高度、贴底状态等父级状态变化不该重渲染整条消息流：
 *  props 全部不变时直接跳过（流式增量的重渲染由 rows 变化正常触发）。 */
export const ConversationList = memo(ConversationListImpl);

/** 工具调用组：折叠头做成精致内嵌胶囊卡 + 步骤计数徽标，展开列出组内工具行。 */
function ToolGroupView({
  row,
  isOpen,
  toggleOpen,
  autoCollapseTools,
  agentRunningTools,
}: {
  row: Extract<ChatRow, { kind: "toolGroup" }>;
  isOpen: (id: string, fallback: boolean) => boolean;
  toggleOpen: (id: string, fallback: boolean) => void;
  autoCollapseTools: boolean;
  agentRunningTools: Set<string>;
}) {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const open = isOpen(row.key, !autoCollapseTools);
  const tone = toolTone(th, row.running ? "running" : "success");
  const badgeBg = row.running ? th.amberSoft : th.okSoft;
  return (
    <View
      style={[
        styles.toolGroupCard,
        { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
      ]}
    >
      <Disclosure
        icon={
          <View style={[styles.toolIconBadge, { backgroundColor: badgeBg }]}>
            <Icon name="wrench" size={12} color={tone} />
          </View>
        }
        title={
          <View style={styles.groupTitleRow}>
            <Text style={[styles.toolRowName, { color: th.ink }]} numberOfLines={1}>
              {pick("工具调用", "Tool calls")}
            </Text>
            <View
              style={[
                styles.stepCountBadge,
                { backgroundColor: th.card, borderColor: th.hairline },
              ]}
            >
              <Text style={[styles.stepCountText, { color: th.inkSub }]}>
                {pick(
                  `${row.tools.length} 步`,
                  `${row.tools.length} ${row.tools.length === 1 ? "step" : "steps"}`,
                )}
              </Text>
            </View>
          </View>
        }
        subtitle={
          <Text style={[styles.toolRowMeta, { color: tone }]} numberOfLines={1}>
            {row.running ? pick("进行中", "Running") : pick("已完成", "Done")}
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
    </View>
  );
}

/** 轮末脚注（TurnFooterView）：收敛成功/中断/失败状态与重试入口，保持画面干净利落。 */
function TurnFooterView({
  row,
  files,
  plugins,
  turnPushMap,
  onRetryTurn,
}: {
  row: Extract<ChatRow, { kind: "turn" }>;
  files: readonly ChatFileChange[];
  plugins?: readonly LoadedPlugin[];
  turnPushMap?: ReadonlyMap<string, Record<string, unknown>>;
  onRetryTurn?: (target: { rowId: number; entityId: string }) => void;
}) {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const parts: string[] = [];
  if (!row.folded && row.toolCalls > 0) {
    parts.push(
      pick(`${row.toolCalls} 次工具`, `${row.toolCalls} ${row.toolCalls === 1 ? "tool" : "tools"}`),
    );
  }
  if (row.tokens !== undefined) parts.push(`${formatTokens(row.tokens)} tokens`);
  if (row.files) {
    parts.push(
      row.files.reverted
        ? pick(
            `${row.files.files} 个文件（已撤销）`,
            `${row.files.files} ${row.files.files === 1 ? "file" : "files"} (reverted)`,
          )
        : pick(
            `${row.files.files} 个文件 +${row.files.additions} −${row.files.deletions}`,
            `${row.files.files} ${row.files.files === 1 ? "file" : "files"} +${row.files.additions} −${row.files.deletions}`,
          ),
    );
  }
  const ok = row.state === "completedSuccess";
  const stateLabel = row.folded
    ? ""
    : ok
      ? ""
      : row.state === "failed"
        ? pick("回合失败", "Turn failed")
        : pick("已中断", "Interrupted");
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
                  push: turnPushMap?.get(
                    plugin.parsed.manifest.runtime?.serverName ?? plugin.parsed.manifest.id,
                  ),
                }),
              ).trim(),
            )
            .filter(Boolean),
        )
        .join(" · ")
    : "";
  const canRetry = Boolean(!ok && onRetryTurn && row.entityId);
  return (
    <View style={styles.turnBlock}>
      {stateLabel || parts.length > 0 || canRetry ? (
        <View style={styles.turnHeadRow}>
          {stateLabel ? (
            <View
              style={[
                styles.turnStateBadge,
                {
                  backgroundColor: row.state === "failed" ? th.redSoft : th.surfaceSoft,
                  borderColor: row.state === "failed" ? th.red : th.hairline,
                },
              ]}
            >
              <Icon
                name={row.state === "failed" ? "alert" : "info"}
                size={10}
                color={row.state === "failed" ? th.red : th.inkSub}
              />
              <Text
                style={[
                  styles.turnStateText,
                  { color: row.state === "failed" ? th.red : th.inkSub },
                ]}
              >
                {stateLabel}
              </Text>
            </View>
          ) : null}
          {parts.length > 0 ? (
            <Text style={[styles.turn, { color: th.inkFaint }]}>{parts.join(" · ")}</Text>
          ) : null}
          {canRetry ? (
            <PressableScale
              onPress={() => onRetryTurn!({ rowId: row.rowId, entityId: row.entityId! })}
              scaleTo={0.94}
              accessibilityRole="button"
              accessibilityLabel={pick("重试这一轮", "Retry this turn")}
              style={[
                styles.retry,
                { backgroundColor: th.card, borderColor: th.hairlineStrong },
              ]}
            >
              <Icon name="refresh" size={11} color={th.ink} />
              <Text style={[styles.retryText, { color: th.ink }]}>{pick("重试", "Retry")}</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {files.length > 0 ? <ChangeCard files={files} /> : null}
      {note ? (
        <Text style={[styles.turnNote, { color: th.inkFaint }]} numberOfLines={2}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** 单个工具行：折叠只有一行（22x22 图标徽标 + 名称 + 状态指示 + 目标），展开才是原有详情。 */
const ToolRowView = memo(function ToolRowView({
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
  const { pick } = useI18n();
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
  const statusWord =
    isAgentTool && agentRunning
      ? pick("后台运行中", "Running in background")
      : toolStatusLabel(row.status);
  return (
    <View style={styles.toolRow}>
      <Disclosure
        icon={
          isAgentTool ? (
            <AgentFace name={faceName} status={faceStatus} size={20} badge />
          ) : (
            <View
              style={[
                styles.toolIconBadge,
                { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
              ]}
            >
              <Icon name={toolIcon(row.name, row.detail)} size={12} color={tone} />
            </View>
          )
        }
        title={
          <Text style={[styles.toolRowName, { color: th.ink }]} numberOfLines={1}>
            {friendlyToolName(row.name, row.detail)}
          </Text>
        }
        subtitle={
          <View style={styles.toolSubtitleRow}>
            <View style={[styles.toolStatusDot, { backgroundColor: tone }]} />
            <Text style={[styles.toolRowMeta, { color: th.inkFaint }]} numberOfLines={1}>
              <Text style={{ color: tone, fontWeight: "600" }}>{statusWord}</Text>
              {target ? ` · ${target}` : ""}
            </Text>
          </View>
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
              <View
                style={[
                  styles.toolOutputWell,
                  { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                ]}
              >
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
});

function toolIcon(name: string, detail?: string): IconName {
  return friendlyToolIcon(name, detail);
}

/** 工具状态 → 词；未知状态原样显示，不吞信息。 */
function toolStatusLabel(status: string): string {
  switch (status) {
    case "running":
    case "inputStreaming":
    case "pendingApproval":
      return pickText("进行中", "Running");
    case "success":
      return pickText("已完成", "Done");
    case "error":
      return pickText("失败", "Failed");
    case "cancelled":
      return pickText("已停止", "Stopped");
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

/**
 * 折叠行里的目标摘要：按工具挑人能读的参数（命令/文件名/应用名/手机操作对象/URL），
 * 不再把裸 JSON 或工程细节摆进消息流。
 */
function toolTarget(row: Extract<ChatRow, { kind: "tool" }>): string {
  return friendlyToolTarget(row.name, row.detail, row.todos?.length);
}

/** 思考块：折叠一行（标签 / 耗时 / 流式尾部预览），展开是纯文本滚动区。 */
const ThinkingDisclosure = memo(function ThinkingDisclosure({
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
  const { pick } = useI18n();
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
  const title =
    seconds === undefined
      ? pick("思考", "Thinking")
      : pick(`思考 · 持续 ${seconds} 秒`, `Thought for ${seconds}s`);
  const preview = streaming ? reasoningTail(reasoning) : "";
  return (
    <Disclosure
      icon={<Icon name="sparkles" size={12} color={th.inkFaint} />}
      title={
        <Text style={[styles.thinkingTitle, { color: th.inkSub }]} numberOfLines={1}>
          {streaming ? pick("正在思考", "Thinking…") : title}
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
      compact={!open && !streaming}
    >
      <ThinkingBody text={reasoning} streaming={streaming} />
    </Disclosure>
  );
});

/** 思考正文：引用轨样式（左侧竖线 + 弱色文字），限高内滚；流式时贴底。 */
function ThinkingBody({ text, streaming }: { text: string; streaming: boolean }) {
  const th = useNibiTheme();
  const ref = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const stickToBottom = useRef(true);
  return (
    <View style={styles.thinkingWell}>
      <View style={[styles.thinkingRail, { backgroundColor: th.brandSoft }]} />
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
        <Text style={[styles.thinkingText, { color: th.inkFaint }]}>{text}</Text>
      </ScrollView>
    </View>
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
 * 一轮的过程摘要（dsh-Go TurnProcess / ProcessGroupView）：默认收起，点开列出思考/工具/中间消息。
 * 折叠头做成精致胶囊卡 + 左侧完成状态徽标 + 步骤计数胶囊，与 NIBI 桌面端过程行对齐。
 * 卡内的思考块/工具行与顶层同一套折叠件，显隐也跟随会话级的 showReasoning/showTools。
 */
function ProcessGroupView({
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
  /** 仍在后台跑的子代理对应的工具行 key（ProcessGroupView 传给子工具行）。 */
  agentRunningTools?: Set<string>;
}) {
  const th = useNibiTheme();
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  const metaParts: string[] = [];
  if (row.toolCalls > 0) {
    metaParts.push(
      pick(`${row.toolCalls} 次工具`, `${row.toolCalls} ${row.toolCalls === 1 ? "tool" : "tools"}`),
    );
  }
  if (row.messages > 0) {
    metaParts.push(
      pick(
        `${row.messages} 条消息`,
        `${row.messages} ${row.messages === 1 ? "message" : "messages"}`,
      ),
    );
  }
  const metaLabel = metaParts.join(" · ");
  const totalSteps = row.toolCalls + row.messages;
  const a11yLabel = metaLabel
    ? pick(`已完成 · ${metaLabel}`, `Completed · ${metaLabel}`)
    : pick("已完成过程", "Completed process");
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
        onPress={() => {
          haptic("tick");
          setOpen((value) => !value);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [
          styles.processHeader,
          { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
          pressed ? { opacity: 0.72 } : null,
        ]}
      >
        <View style={[styles.processAccentBar, { backgroundColor: th.ok }]} />
        <View style={[styles.toolIconBadge, { backgroundColor: th.okSoft }]}>
          <Icon name="check" size={11} color={th.ok} />
        </View>
        <Text style={[styles.processTitle, { color: th.ink }]}>{pick("执行过程", "Process")}</Text>
        {metaLabel ? (
          <Text style={[styles.processMeta, { color: th.inkSub }]} numberOfLines={1}>
            {metaLabel}
          </Text>
        ) : null}
        {totalSteps > 0 ? (
          <View
            style={[
              styles.stepCountBadge,
              { backgroundColor: th.card, borderColor: th.hairline },
            ]}
          >
            <Text style={[styles.stepCountText, { color: th.inkSub }]}>
              {pick(`${totalSteps} 步`, `${totalSteps} ${totalSteps === 1 ? "step" : "steps"}`)}
            </Text>
          </View>
        ) : null}
        <View style={styles.processChevron}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={th.inkFaint} />
        </View>
      </Pressable>
      {open && visible.length > 0 ? (
        <View style={[styles.processBody, { borderLeftColor: th.hairlineStrong }]}>
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
  const { pick } = useI18n();
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
        {pick("子智能体", "Subagent")} · {row.subagentType} · {row.status}
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
  const { pick } = useI18n();
  const added = files.reduce((sum, file) => sum + file.additions, 0);
  const removed = files.reduce((sum, file) => sum + file.deletions, 0);
  const shown = files.slice(0, 4);
  return (
    <View style={[styles.changes, { backgroundColor: th.card, borderColor: th.hairline }]}>
      <View style={styles.toolHead}>
        <Text style={[styles.toolName, { color: th.ink }]}>
          {pick(
            `改动了 ${files.length} 个文件`,
            `Changed ${files.length} ${files.length === 1 ? "file" : "files"}`,
          )}
        </Text>
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
          {pick(
            `还有 ${files.length - shown.length} 个文件`,
            `${files.length - shown.length} more ${files.length - shown.length === 1 ? "file" : "files"}`,
          )}
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
  scrollWrap: { flex: 1 },
  scroll: { flex: 1 },
  listHeader: { height: space(2) },
  rowSeparator: { height: space(2.5) },
  row: { width: "100%" },
  bubble: {
    maxWidth: "86%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    gap: 4,
  },
  // 用户气泡：右下角收敛为 xs 形成对话角，配品牌细边与充足内边距。
  bubbleUser: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    borderBottomRightRadius: radius.xs,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  // 助手短消息白卡：左上角收敛为 xs 与上方思考块自然衔接，带轻投影抬升层级。
  bubbleAssistant: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    borderTopLeftRadius: radius.xs,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  // 富排版消息的平铺容器：与思考块同列宽（assistantRow 已对齐），不套卡。
  // 必须 stretch——自动宽容器里 flex:1 的子列会塌成 0（工件卡标题消失的根因）。
  bubbleFlat: { alignSelf: "stretch", paddingVertical: space(1), gap: space(1.5) },
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
    gap: 4,
    marginTop: space(1.5),
    paddingHorizontal: space(2),
    paddingVertical: 3,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
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
    paddingHorizontal: space(3),
    paddingVertical: space(1),
  },
  thinkingPill: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: 1,
  },
  thinkingTitle: { ...text("micro"), fontWeight: "600" },
  thinkingPreview: { ...text("micro") },
  thinkingWell: { flexDirection: "row" },
  thinkingRail: { width: 2, borderRadius: 1, marginRight: space(1.5), marginBottom: space(1) },
  thinkingScroll: { flex: 1, maxHeight: 240 },
  thinkingContent: { paddingRight: space(1), paddingBottom: space(1) },
  thinkingText: { ...text("small"), lineHeight: 19 },
  toolRow: { paddingVertical: 2 },
  toolIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  toolRowName: { ...text("small"), fontWeight: "600" },
  toolSubtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
  },
  toolStatusDot: {
    width: 5,
    height: 5,
    borderRadius: radius.chip,
  },
  toolRowMeta: { ...text("micro"), flexShrink: 1 },
  toolGroupCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  groupTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  stepCountBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(1.5),
    paddingVertical: 1,
  },
  stepCountText: { ...text("micro"), fontWeight: "600" },
  turn: { ...text("micro"), textAlign: "center" },
  turnHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    flexWrap: "wrap",
  },
  turnStateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 2,
  },
  turnStateText: { ...text("micro"), fontWeight: "600" },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
  },
  retryText: { ...text("micro"), fontWeight: "600" },
  turnNote: { ...text("micro"), textAlign: "center" },
  turnBlock: { gap: space(1.5), paddingVertical: space(0.5) },
  process: { gap: space(1) },
  processHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    minHeight: size.chipLg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  processAccentBar: {
    width: 2.5,
    height: 14,
    borderRadius: 2,
  },
  processTitle: { ...text("small"), fontWeight: "600" },
  processMeta: { ...text("micro"), flexShrink: 1 },
  processChevron: { marginLeft: "auto" },
  processBody: {
    borderLeftWidth: 2,
    paddingLeft: space(3),
    marginLeft: space(2),
    paddingVertical: space(1),
    gap: space(2),
  },
  processBlock: { gap: 4 },
  processText: { ...text("small") },
  processTool: { ...text("micro") },
  notice: { ...text("micro"), textAlign: "center", paddingHorizontal: space(2) },
  toolHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  toolName: { flex: 1, ...text("small"), fontWeight: "700" },
  toolStatus: { ...text("micro"), fontWeight: "600" },
  toolDetail: { ...text("micro") },
  // 工具输出井：内嵌面 + xs 圆角 + 等宽字，「机器输出」与正文拉开一档。
  toolOutputWell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xs,
    paddingHorizontal: space(2.5),
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
