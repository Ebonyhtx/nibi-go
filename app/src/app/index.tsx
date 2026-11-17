// GO 主体首页 = 会话即首页（D2 修订）。版式对齐 dsh-Go home_shell / adaptive_scaffold：
//   compact（手机竖屏 / 任何矮窗）→ 浮动 pill 顶栏 + 滑出抽屉
//   medium（600–840）              → 同 compact，正文限宽居中
//   expanded（≥840）                → 常驻侧栏（或折叠成 rail）+ 居中正文列
// 手机横屏（高 <480）按 compact 处理，但空态文案横向摊开、宠物缩小。
//
// 宠物位置（对齐 dsh-Go）：**永远在输入栏正上方**，不占正文区——有会话时中间
// 是消息流，宠物仍在输入栏上方那一小块，不会跟会话抢地方。
// Phase C：C0 已跑通（进程内内核 + 会话协议），空态从「挂起」改为「就绪，可开始」。
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Alert,
  Keyboard,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConversationList } from "../components/ConversationList";
import { AnnotationComposer, type AnnotationDraft } from "../components/AnnotationComposer";
import { AnnotationManager, type AnnotationItem } from "../components/AnnotationManager";
import { CapsuleStack } from "../components/CapsuleStack";
import { ComposerAttachments } from "../components/ComposerAttachments";
import { ComposerTokens } from "../components/ComposerTokens";
import { GoDrawer, GoRail, GoSidebar } from "../components/GoDrawer";
import { Dot, Icon, type IconName } from "../components/Icon";
import { PetView, type PetStateId } from "../components/PetView";
import { PluginActionSheet, type PluginSheetItem } from "../components/PluginActionSheet";
import { PluginPopup, type PopupAnchor } from "../components/PluginPopup";
import type { PluginActionHandler } from "../components/PluginView";
import { SideStatus } from "../components/SideStatus";
import { PET_STATE } from "../components/petStates";
import { useKernelConversation } from "../kernel/useKernelConversation";
import { resolveAdaptiveLayout } from "../layout/adaptive";
import { runPluginAction, type PluginActionContext } from "../plugins/actions";
import { takePendingInsert } from "../plugins/pendingInsert";
import {
  pluginCapability,
  type LoadedPlugin,
  type PluginCapability,
} from "../plugins/store";
import { composePrompt, type ComposerToken } from "../plugins/tokens";
import {
  buildComposerCatalog,
  capsuleEligible,
  mergeSkillCatalog,
  messageEligible,
  PLUS_GROUPS,
  type ComposerCatalogItem,
  type ComposerGroup,
} from "../composer/catalog";
import {
  pickFiles,
  pickImages,
  toAttachmentRef,
  type ComposerAttachment,
} from "../composer/attachments";
import { useComposerPreferences } from "../composer/useComposerPreferences";
import { usePlugins } from "../plugins/usePlugins";
import type { KernelConversationQuote } from "@nibi-go/kernel-session";
import type { Effect } from "@nibi-go/plugin-contract";
import { radius, space, type as t, useNibiTheme } from "../theme";

interface SheetEntry {
  plugin: LoadedPlugin;
  action: {
    id: string;
    title: string;
    icon?: string;
    effects?: Effect[];
    instruction?: string;
    command?: string;
    prompt?: string;
    skills?: string[];
  };
}


export default function GoHomeScreen() {
  const th = useNibiTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // edge-to-edge 下 adjustResize 不一定会缩小窗口：直接把输入栏抬到键盘上方。
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const layout = resolveAdaptiveLayout({ width, height, sidebarOpen });
  // 首页即会话（D2）：内核会话与消息流直接挂在这页。
  const conversation = useKernelConversation();
  const [draft, setDraft] = useState("");
  // COMPOSE 里的不可编辑 token（插件引用 / 命令 / 技能）。
  const [tokens, setTokens] = useState<ComposerToken[]>([]);
  // 内置插件的槽（工具卡/快捷动作/面板入口）；启停状态在插件中心改。
  const plugins = usePlugins();
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const composerCatalog = useMemo(
    () =>
      buildComposerCatalog(
        plugins.enabled,
        mergeSkillCatalog(conversation.skills, plugins.enabled),
      ),
    [conversation.skills, plugins.enabled],
  );
  const composerPreferences = useComposerPreferences(composerCatalog);
  const capsuleItems = useMemo(() => {
    const ids =
      composerPreferences?.capsules ??
      composerCatalog.filter(capsuleEligible).slice(0, 3).map((item) => item.id);
    return ids
      .map((id) => composerCatalog.find((item) => item.id === id))
      .filter((item): item is ComposerCatalogItem => Boolean(item));
  }, [composerCatalog, composerPreferences]);
  const plusItemsFor = (group: ComposerGroup): ComposerCatalogItem[] => {
    const ids =
      composerPreferences?.plus[group as keyof typeof composerPreferences.plus] ??
      composerCatalog.filter((item) => item.group === group).map((item) => item.id);
    return ids
      .map((id) => composerCatalog.find((item) => item.id === id))
      .filter((item): item is ComposerCatalogItem => Boolean(item));
  };
  const messageMenuItems = useMemo(() => {
    const ids =
      composerPreferences?.messageActions ??
      composerCatalog.filter(messageEligible).map((item) => item.id);
    return ids
      .map((id) => composerCatalog.find((item) => item.id === id))
      .filter((item): item is ComposerCatalogItem => Boolean(item));
  }, [composerCatalog, composerPreferences]);
  const [popup, setPopup] = useState<
    | { kind: "plus"; anchor: PopupAnchor }
    | {
        kind: "message";
        anchor: PopupAnchor;
        messageKey: string;
        message: string;
        messageRole: "user" | "assistant";
        messageId?: string;
      }
    | null
  >(null);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [annotationEditor, setAnnotationEditor] = useState<{
    messageKey: string;
    messageId?: string;
    messageRole: "user" | "assistant";
    fullText: string;
    initialExcerpt?: string;
    editingId?: string;
    comment?: string;
    instruction?: string;
    instructionLabel?: string;
  } | null>(null);
  const [annotationManagerOpen, setAnnotationManagerOpen] = useState(false);
  const canSend =
    conversation.ready &&
    !conversation.sending &&
    (draft.trim().length > 0 ||
      tokens.some((token) => token.kind !== "mode") ||
      attachments.length > 0 ||
      annotations.length > 0);
  const [sessionSheet, setSessionSheet] = useState<{
    title: string;
    items: PluginSheetItem[];
  } | null>(null);
  const plusRef = useRef<ComponentRef<typeof Pressable> | null>(null);

  const pluginContext: PluginActionContext = {
    insertText: (text, mode) => {
      setDraft((current) =>
        mode === "replace" ? text : current.length > 0 ? `${current}\n${text}` : text,
      );
    },
    openPanel: (pluginId, panelId) => {
      router.push({ pathname: "/panel", params: { pluginId, panelId } });
    },
    refresh: () => {
      void plugins.reload();
    },
  };
  const runAction = (
    plugin: LoadedPlugin,
    action: { id: string; effects?: readonly Effect[] },
  ) => {
    runPluginAction(
      plugin,
      { id: action.id, effects: action.effects ? [...action.effects] : [] },
      pluginContext,
    );
  };
  const onPluginAction: PluginActionHandler = (plugin: LoadedPlugin, action) => {
    runAction(plugin, action);
  };
  const sessionActions = useMemo<SheetEntry[]>(
    () =>
      plugins.enabled.flatMap((plugin) =>
        plugin.parsed.manifest.contributes.sessionActions.map((action) => ({ plugin, action })),
      ),
    [plugins.enabled],
  );

  const addToken = (token: ComposerToken) => {
    setTokens((current) => {
      // 命令与模式各只认一个（内核从正文开头展开）；再选就替换。
      if (token.kind === "command" || token.kind === "mode") {
        return [...current.filter((entry) => entry.kind !== token.kind), token];
      }
      if (current.some((entry) => entry.id === token.id)) return current;
      return [...current, token];
    });
  };
  const addPluginToken = (plugin: LoadedPlugin) => {
    addToken({
      id: `plugin:${plugin.parsed.manifest.id}`,
      kind: "plugin",
      pluginId: plugin.parsed.manifest.id,
      pluginName: plugin.parsed.manifest.name,
      label: plugin.parsed.manifest.name,
      value: pluginCapability(plugin).id,
      ...(plugin.parsed.manifest.accent ? { accent: plugin.parsed.manifest.accent } : {}),
      ...(plugin.parsed.manifest.contributes.composerActions[0]?.icon
        ? { icon: plugin.parsed.manifest.contributes.composerActions[0].icon }
        : {}),
    });
  };
  const pluginReferencesForTokens = (
    list: readonly ComposerToken[],
  ): PluginCapability[] => {
    const seen = new Set<string>();
    const references: PluginCapability[] = [];
    for (const token of list) {
      if (token.kind === "skill") continue;
      const plugin = plugins.enabled.find(
        (candidate) => candidate.parsed.manifest.id === token.pluginId,
      );
      if (!plugin) continue;
      const capability = pluginCapability(plugin);
      if (seen.has(capability.id)) continue;
      seen.add(capability.id);
      references.push(capability);
    }
    return references;
  };
  const openPlusMenu = () => {
    plusRef.current?.measureInWindow((x, y, measureWidth, measureHeight) => {
      setPopup({
        kind: "plus",
        anchor: { x, y, width: measureWidth, height: measureHeight },
      });
    });
  };
  const openMessagePopup = (
    messageKey: string,
    message: string,
    anchor: PopupAnchor,
    messageRole: "user" | "assistant",
    messageId?: string,
  ) => {
    setPopup({
      kind: "message",
      anchor,
      messageKey,
      message,
      messageRole,
      ...(messageId ? { messageId } : {}),
    });
  };
  const addAttachments = async (kind: "image" | "file") => {
    try {
      const picked = kind === "image" ? await pickImages() : await pickFiles();
      if (picked.length === 0) return;
      setAttachments((current) => [...current, ...picked]);
    } catch (error) {
      setPopup(null);
      console.warn("[nibigo] 选择附件失败", error);
    }
  };

  const addMessageReference = (
    messageKey: string,
    messageText: string,
    messageRole: "user" | "assistant",
    pluginId: string,
    pluginName: string,
  ) => {
    addToken({
      id: `message:${messageKey}`,
      kind: "message",
      pluginId,
      pluginName,
      label: "这条消息",
      value: messageKey,
      accent: "default",
      icon: "quote",
      messageText,
      messageRole,
    });
  };

  /** 加号/胶囊的统一入口：按 catalog token 插入命令/技能/插件引用/模式，附件走选择器。 */
  const applyCatalogItem = (item: ComposerCatalogItem) => {
    setPopup(null);
    const token = item.token;
    if (token.kind === "attachment") {
      void addAttachments(token.value);
      return;
    }
    if (token.kind === "plugin") {
      const plugin = plugins.enabled.find(
        (candidate) => candidate.parsed.manifest.id === item.pluginId,
      );
      if (plugin) addPluginToken(plugin);
      return;
    }
    const pluginName = item.pluginId
      ? (plugins.enabled.find(
          (candidate) => candidate.parsed.manifest.id === item.pluginId,
        )?.parsed.manifest.name ?? item.detail ?? "NIBI")
      : "NIBI";
    if (token.kind === "mode") {
      void conversation.setMode(token.value).catch((error: unknown) => {
        Alert.alert(
          "切换模式失败",
          error instanceof Error ? error.message : String(error),
        );
      });
      return;
    }
    if (token.kind === "skill") {
      addToken({
        id: `skill:${token.value}`,
        kind: "skill",
        pluginId: item.pluginId ?? "nibi",
        pluginName,
        label: item.title,
        value: token.value,
        accent: item.source === "plugin" ? "default" : "brand",
        icon: "doc",
      });
      return;
    }
    addToken({
      id: `command:${token.value}`,
      kind: "command",
      pluginId: item.pluginId ?? "nibi",
      pluginName,
      label: item.title,
      value: token.value,
      ...(item.accent ? { accent: item.accent } : {}),
      ...(item.icon ? { icon: item.icon } : {}),
    });
  };

  /** 长按消息菜单：先引用消息，再触发命令/技能（不是注释评论）。 */
  const applyMessageCatalogItem = (item: ComposerCatalogItem) => {
    if (popup?.kind !== "message") return;
    setPopup(null);
    const token = item.token;
    const pluginName = item.pluginId
      ? (plugins.enabled.find(
          (candidate) => candidate.parsed.manifest.id === item.pluginId,
        )?.parsed.manifest.name ?? item.detail ?? "插件")
      : "NIBI";
    addMessageReference(
      popup.messageKey,
      popup.message,
      popup.messageRole,
      item.pluginId ?? "nibi",
      pluginName,
    );
    if (token.kind === "command" || token.kind === "skill") {
      addToken({
        id: `${token.kind}:${token.value}`,
        kind: token.kind,
        pluginId: item.pluginId ?? "nibi",
        pluginName,
        label: item.title,
        value: token.value,
        ...(item.accent ? { accent: item.accent } : {}),
        ...(item.icon ? { icon: item.icon } : {}),
      });
    }
  };

  const openSessionSheet = (sessionId: string) => {
    if (sessionActions.length === 0) return;
    const title = conversation.sessions.find((session) => session.sessionId === sessionId)?.title;
    setSessionSheet({
      title: title ? `会话信息 · ${title}` : "会话信息",
      items: sessionActions.map(({ plugin, action }) => ({
        key: `${plugin.parsed.manifest.id}:${action.id}`,
        label: action.title,
        detail: plugin.parsed.manifest.name,
        onPress: () => {
          setSessionSheet(null);
          runAction(plugin, action);
        },
      })),
    });
  };
  const saveAnnotation = ({ excerpt, comment }: AnnotationDraft) => {
    const editor = annotationEditor;
    if (!editor) return;
    if (editor.editingId) {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === editor.editingId
            ? {
                ...annotation,
                messageText: excerpt,
                comment,
                ...(editor.instruction ? { instruction: editor.instruction } : {}),
              }
            : annotation,
        ),
      );
    } else {
      setAnnotations((current) => [
        ...current,
        {
          id: `annotation-${Date.now()}`,
          messageKey: editor.messageKey,
          ...(editor.messageId ? { messageId: editor.messageId } : {}),
          messageRole: editor.messageRole,
          messageText: excerpt,
          fullText: editor.fullText,
          comment,
          ...(editor.instruction ? { instruction: editor.instruction } : {}),
          createdAt: Date.now(),
        },
      ]);
    }
    setAnnotationEditor(null);
  };
  const editAnnotation = (annotation: AnnotationItem) => {
    setAnnotationManagerOpen(false);
    setAnnotationEditor({
      messageKey: annotation.messageKey,
      ...(annotation.messageId ? { messageId: annotation.messageId } : {}),
      messageRole: annotation.messageRole,
      fullText: annotation.fullText || annotation.messageText,
      initialExcerpt: annotation.messageText,
      editingId: annotation.id,
      comment: annotation.comment,
      ...(annotation.instruction ? { instruction: annotation.instruction } : {}),
    });
  };
  const deleteAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  };
  const annotationCountFor = (messageKey: string): number =>
    annotations.filter((annotation) => annotation.messageKey === messageKey).length;
  const sendDraft = () => {
    const prompt = composePrompt(tokens, draft);
    const annotationQuotes: KernelConversationQuote[] = annotations.map((annotation, index) => ({
      text: annotation.messageText,
      kind: "annotation",
      number: index + 1,
      messageKey: annotation.messageKey,
      messageRole: annotation.messageRole,
      senderName: annotation.messageRole === "assistant" ? "NIBI" : "我",
      sentAt: new Date(annotation.createdAt).toISOString(),
      ...(annotation.messageId ? { messageId: annotation.messageId } : {}),
      ...(annotation.comment.trim() ? { comment: annotation.comment.trim() } : {}),
      ...(annotation.instruction ? { instruction: annotation.instruction } : {}),
    }));
    // 消息动作（润色/缩写）= 命令 + 消息引用；不是注释评论。
    const transformQuotes: KernelConversationQuote[] = tokens
      .filter((token) => token.kind === "message" && token.messageText)
      .map((token, index) => ({
        text: token.messageText ?? "",
        kind: "transform",
        number: index + 1,
        messageKey: token.value,
        messageRole: token.messageRole ?? "assistant",
        senderName: token.messageRole === "user" ? "我" : "NIBI",
      }));
    const quotes = [...annotationQuotes, ...transformQuotes];
    if (!prompt && quotes.length === 0 && attachments.length === 0) return;
    const pluginReferences = pluginReferencesForTokens(tokens);
    const modeToken = tokens.find((token) => token.kind === "mode");
    const attachmentRefs = attachments.map(toAttachmentRef);
    setAnnotations([]);
    setTokens([]);
    setAttachments([]);
    setDraft("");
    void conversation.send(prompt, {
      ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
      ...(modeToken?.mode ? { mode: modeToken.mode } : {}),
      ...(quotes.length > 0 ? { conversationQuotes: quotes } : {}),
      ...(pluginReferences.length > 0 ? { pluginReferences } : {}),
    });
  };

  // 面板动作里的“插入草稿”跨页带回首页。
  useFocusEffect(
    useCallback(() => {
      const text = takePendingInsert();
      if (text) {
        setDraft((current) => (current.length > 0 ? `${current}\n${text}` : text));
      }
    }, []),
  );
  // 切换会话时清掉上一轮的注释/弹出层，避免把 A 会话的注释带进 B。
  useEffect(() => {
    setAnnotations([]);
    setTokens([]);
    setAttachments([]);
    setAnnotationEditor(null);
    setAnnotationManagerOpen(false);
    setPopup(null);
  }, [conversation.activeSessionId]);
  const activeTitle =
    conversation.sessions.find((session) => session.sessionId === conversation.activeSessionId)
      ?.title || "新对话";
  // C0 已就绪：空闲时用 idle，不再一律睡着的鸟（内核能跑，但还没接线到本页的活动）。
  // dev 下点宠物可循环九个状态，用来核对切换与过渡（发布构建不生效）。
  const [previewState, setPreviewState] = useState<PetStateId | null>(null);
  const petState = previewState ?? PET_STATE.idle;
  const cyclePetState = () => {
    if (!__DEV__) return;
    const ids = Object.values(PET_STATE);
    const i = ids.indexOf(petState);
    setPreviewState(ids[(i + 1) % ids.length]!);
  };

  // 宠物目标尺寸（dp）；PetView 内部再按设备像素取整数倍微调（像素不糊）。
  // 手机 88 / 横屏 72（省高度）/ 平板 104。
  const petTarget = layout.landscapeCompact ? 72 : layout.windowClass === "compact" ? 88 : 104;
  // 状态点挂在整个屏幕的右缘（不在正文的 16dp 留白里），底部按 COMPOSE 高度让位。
  const composerBottom =
    keyboardHeight > 0 ? keyboardHeight + space(2) : insets.bottom + space(2);
  const statusBottom = composerBottom + 52 + petTarget + space(8);
  const hasSidebar = layout.left === "sidebar";
  const hasRail = layout.left === "rail";
  const inShell = hasSidebar || hasRail;

  // 顶栏 ≡ 键：侧栏 → 折叠；rail → 展开；无栏 → 开抽屉
  const onMenu = () => {
    if (layout.menuAction === "collapse") setSidebarOpen(false);
    else if (layout.menuAction === "expand") setSidebarOpen(true);
    else {
      Keyboard.dismiss();
      setDrawerOpen(true);
    }
  };

  const bodyMax = Math.min(layout.bodyMaxWidth, hasSidebar ? layout.bodyWidth - space(8) : layout.bodyMaxWidth);

  // 宠物可横向拖动（正式功能，不是 dev 手势）：偏移归一化到 -1..1，
  // 跨旋转/换尺寸自动收敛；行程只允许在输入栏范围内，拖不出去。
  const petRange = Math.max(0, (bodyMax - space(8) - petTarget) / 2);
  const [petOffset, setPetOffset] = useState(0);
  const offsetRef = useRef(0);
  const dragStartRef = useRef(0);
  const applyOffset = (v: number) => {
    const clamped = Math.max(-1, Math.min(1, v));
    offsetRef.current = clamped;
    setPetOffset(clamped);
  };
  const petResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
        onPanResponderGrant: () => {
          dragStartRef.current = offsetRef.current;
        },
        onPanResponderMove: (_e, g) => {
          if (petRange <= 0) return;
          applyOffset(dragStartRef.current + g.dx / petRange);
        },
      }),
    [petRange],
  );

  return (
    <View style={styles.root}>
      {/*
        页面底：一条竖向渐变做完「顶部暖光 → 纸面 → 纸底」。
        原来拆成两层全屏图层（暖光 + 底），软件 GPU 上每层都要整屏混合，
        动画时白付两次全屏 blend；合成一层后只混合一次。
      */}
      <LinearGradient
        colors={[th.glowTop, th.bgGradient[0], th.bgGradient[1]]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.shell}>
        {hasSidebar ? (
          <GoSidebar
            petState={petState}
            sessions={conversation.sessions}
            archivedSessions={conversation.archivedSessions}
            activeSessionId={conversation.activeSessionId}
            onOpenSession={(sessionId) => void conversation.openSession(sessionId)}
            onNewSession={() => {
              setDraft("");
              void conversation.newSession();
            }}
            onArchiveSession={(sessionId) => conversation.archiveSession(sessionId)}
            onUnarchiveSession={(sessionId) => conversation.unarchiveSession(sessionId)}
            onDeleteSession={(sessionId) => conversation.deleteSession(sessionId)}
            onDeleteAllArchived={conversation.deleteAllArchived}
            onSessionActions={sessionActions.length > 0 ? openSessionSheet : undefined}
          />
        ) : null}
        {hasRail ? (
          <GoRail
            petState={petState}
            onMenu={() => setSidebarOpen(true)}
            onSearch={() => undefined}
            onSettings={() => router.push("/settings")}
            onPlugins={() => router.push("/plugins")}
          />
        ) : null}

        <View style={[styles.body, { paddingRight: insets.right }]}>
          <View style={[styles.bodyInner, { maxWidth: bodyMax }]}>
            {/*
              顶栏分两组，视觉重心居中：
              左组（身份/导航）= ≡ + 会话 chip；右组（操作）= 模型 chip + 新建对话。
              之前四件全挤在左边、右侧空一大片，重心偏左。
              rail 模式由 rail 自带 ≡，左组只剩会话 chip。
            */}
            <View style={[styles.topbar, { paddingTop: insets.top + space(1) }]}>
              <View style={styles.topLeft}>
                {!hasRail ? (
                  <Pressable
                    style={[styles.fab, { backgroundColor: th.glass, borderColor: th.glassBorder }]}
                    onPress={onMenu}
                    accessibilityRole="button"
                    accessibilityLabel={layout.menuAction === "collapse" ? "折叠对话列表" : "打开对话列表"}
                  >
                    <Icon name="menu" size={17} color={th.ink} />
                  </Pressable>
                ) : null}

                <View style={[styles.chip, { backgroundColor: th.glass, borderColor: th.glassBorder }]}>
                  <View style={styles.chipBody}>
                    <Text style={[styles.chipTitle, { color: th.ink }]} numberOfLines={1}>
                      {activeTitle}
                    </Text>
                    <View style={styles.chipStatus}>
                      <Dot size={6} color={th.inkGhost} ring={th.inkGhost} />
                      <Text style={[styles.chipSub, { color: th.inkFaint }]}>
                        本机 · {conversation.turn === "running" ? "思考中" : conversation.status}
                      </Text>
                    </View>
                  </View>
                  <Icon name="chevron-down" size={13} color={th.inkFaint} />
                </View>
              </View>

              <View style={styles.topRight}>
                <View style={[styles.modelChip, { backgroundColor: th.glass, borderColor: th.glassBorder }]}>
                  <Text style={[styles.modelText, { color: th.inkSub }]}>
                    {conversation.modelLabel}
                  </Text>
                  <Icon name="chevron-down" size={12} color={th.inkGhost} />
                </View>

                <Pressable
                  style={[styles.fab, { backgroundColor: th.glass, borderColor: th.glassBorder }]}
                  accessibilityLabel="新建对话"
                  onPress={() => {
                    setDraft("");
                    void conversation.newSession();
                  }}
                >
                  <Icon name="pen" size={17} color={th.ink} />
                </Pressable>
              </View>
            </View>

            {/* 正文区：有消息就是会话流；没有消息才是空态说明（会话即首页）。 */}
            <View
              style={[
                styles.stage,
                conversation.rows.length > 0 && styles.stageList,
                layout.landscapeCompact && styles.stageLandscape,
              ]}
            >
              {conversation.rows.length > 0 ? (
                <ConversationList
                  rows={conversation.rows}
                  onRespond={conversation.respondInteraction}
                  turnChanges={conversation.turnChanges}
                  onOpenSession={(sessionId) => void conversation.openSession(sessionId)}
                  plugins={plugins.enabled}
                  onPluginAction={onPluginAction}
                  bottomInset={petTarget + (annotations.length > 0 ? space(10) : 0)}
                  onMessageLongPress={openMessagePopup}
                  annotationCountFor={annotationCountFor}
                />
              ) : (
                <View style={[styles.stageText, layout.landscapeCompact && styles.stageTextLandscape]}>
                  <Text style={[styles.stageTitle, { color: th.ink }]}>本机 AGENT 已就绪</Text>
                  <Text style={[styles.stageSub, { color: th.inkSub }]}>
                    内核在本机运行。直接在下方输入，跟它说话、派任务。
                  </Text>
                  <View style={styles.stageChips}>
                    <View style={[styles.badge, { backgroundColor: th.panel }]}>
                      <Text style={[styles.badgeText, { color: th.inkFaint }]}>数据不出机</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: th.steelSoft }]}>
                      <Text style={[styles.badgeText, { color: th.steel }]}>可先连桌面</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* 底部渐隐：键盘抬起时舞台变矮，渐隐会变成明显色块，所以只在键盘收起时显示 */}
              {keyboardHeight === 0 ? (
                <LinearGradient
                  colors={["transparent", th.bgGradient[1]]}
                  locations={[0, 0.88]}
                  style={[styles.bottomFade, { height: petTarget + space(2) }]}
                  pointerEvents="none"
                />
              ) : null}

              {/* 宠物 + 快捷动作浮在会话流底部：不参与列表布局，也不改变 COMPOSE */}
              <View style={styles.petOverlay} pointerEvents="box-none">
                <View style={styles.actionsOverlay} pointerEvents="auto">
                  <CapsuleStack items={capsuleItems} onItem={applyCatalogItem} />
                </View>
                {annotations.length > 0 ? (
                  <View style={{ transform: [{ translateX: petOffset * petRange }] }}>
                    <Pressable
                      onPress={() => setAnnotationManagerOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel={`注释 ${annotations.length}`}
                      style={[
                        styles.annotationBadge,
                        { backgroundColor: th.card, borderColor: th.hairline },
                      ]}
                    >
                      <Icon name="quote" size={12} color={th.brand} />
                      <Text style={[styles.annotationBadgeText, { color: th.brand }]}>
                        注释 {annotations.length}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.petDock,
                    {
                      height: petTarget - space(2),
                      transform: [{ translateX: petOffset * petRange }],
                    },
                  ]}
                >
                  <View
                    style={[styles.petTouch, { width: petTarget, height: petTarget - space(2) }]}
                    {...petResponder.panHandlers}
                  >
                    <Pressable
                      onPress={cyclePetState}
                      accessibilityLabel="桌宠"
                      style={{
                        width: petTarget,
                        height: petTarget - space(2),
                        alignItems: "center",
                      }}
                    >
                      <View pointerEvents="none">
                        <PetView state={petState} targetSize={petTarget} />
                      </View>
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>

            {/* 输入栏：原始单行 pill；插件/命令 token 与草稿同一行，点 × 只移除 token */}
            <View
              style={[
                styles.composer,
                {
                  backgroundColor: th.glass,
                  borderColor: th.glassBorder,
                  marginBottom: keyboardHeight > 0 ? keyboardHeight + space(2) : insets.bottom + space(2),
                },
              ]}
            >
              <Pressable
                ref={plusRef}
                onPress={openPlusMenu}
                style={[styles.plus, { backgroundColor: th.panel }]}
                accessibilityRole="button"
                accessibilityLabel="选择插件"
              >
                <Icon name="plus" size={13} color={th.inkSub} />
              </Pressable>
              <ComposerAttachments
                attachments={attachments}
                onRemove={(id) =>
                  setAttachments((current) => current.filter((attachment) => attachment.id !== id))
                }
              />
              <ComposerTokens
                tokens={tokens}
                onRemove={(id) => setTokens((current) => current.filter((token) => token.id !== id))}
              />
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={tokens.length > 0 ? "继续输入…" : "给 NIBI 发消息…"}
                placeholderTextColor={th.inkFaint}
                style={[styles.composerInput, { color: th.ink }]}
                returnKeyType="send"
                editable={conversation.ready}
                onSubmitEditing={() => {
                  if (canSend) sendDraft();
                }}
              />
              <Pressable
                accessibilityLabel="发送"
                disabled={!canSend}
                onPress={() => {
                  if (canSend) sendDraft();
                }}
                style={[
                  styles.send,
                  {
                    backgroundColor: th.brand,
                    opacity: canSend ? 1 : 0.4,
                  },
                ]}
              >
                <Icon name="arrow-up" size={16} color={th.brandFg} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {!inShell ? (
        <GoDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          petState={petState}
          sessions={conversation.sessions}
          archivedSessions={conversation.archivedSessions}
          activeSessionId={conversation.activeSessionId}
          onOpenSession={(sessionId) => void conversation.openSession(sessionId)}
          onNewSession={() => {
            setDraft("");
            void conversation.newSession();
          }}
          onArchiveSession={(sessionId) => conversation.archiveSession(sessionId)}
          onUnarchiveSession={(sessionId) => conversation.unarchiveSession(sessionId)}
          onDeleteSession={(sessionId) => conversation.deleteSession(sessionId)}
          onDeleteAllArchived={conversation.deleteAllArchived}
            onSessionActions={sessionActions.length > 0 ? openSessionSheet : undefined}
        />
      ) : null}

      <SideStatus plugins={plugins.enabled} bottom={statusBottom} />

      <PluginPopup
        visible={popup?.kind === "plus"}
        anchor={popup?.kind === "plus" ? popup.anchor : null}
        onClose={() => setPopup(null)}
        width={300}
      >
        <ScrollView
          style={styles.plusScroll}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {PLUS_GROUPS.map(({ group, title }) => {
            const items = plusItemsFor(group);
            if (items.length === 0) return null;
            const nibi = items.filter((item) => item.source === "nibi");
            const plugin = items.filter((item) => item.source === "plugin");
            const split =
              group === "plugin-command" || group === "plugin" || group === "skill";
            const row = (item: ComposerCatalogItem) => (
              <Pressable
                key={item.id}
                onPress={() => applyCatalogItem(item)}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                style={({ pressed }) => [
                  styles.menuRow,
                  { borderColor: th.hairline, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View
                  style={[
                    styles.toolIconSmall,
                    {
                      backgroundColor:
                        item.source === "plugin" ? th.steelSoft : th.brandSoft,
                    },
                  ]}
                >
                  <Icon
                    name={(item.icon ?? "puzzle") as IconName}
                    size={15}
                    color={item.source === "plugin" ? th.steel : th.brand}
                  />
                </View>
                <View style={styles.menuText}>
                  <Text style={[styles.menuLabel, { color: th.ink }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[styles.menuDetail, { color: th.inkFaint }]} numberOfLines={1}>
                    {item.detail ?? ""}
                  </Text>
                </View>
                <Icon
                  name={item.group === "attachment" ? "plus" : "chevron-right"}
                  size={13}
                  color={th.inkGhost}
                />
              </Pressable>
            );
            return (
              <View key={group} style={styles.plusSection}>
                <Text style={[styles.plusTitle, { color: th.ink }]}>{title}</Text>
                {(split ? nibi : items).map(row)}
                {split && plugin.length > 0 ? (
                  <>
                    <Text style={[styles.plusSubtitle, { color: th.inkFaint }]}>
                      {group === "skill" ? "插件技能" : "用户插件"}
                    </Text>
                    {plugin.map(row)}
                  </>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
        <Text style={[styles.plusFootnote, { color: th.inkGhost }]}>
          附件只传文件引用；命令/技能只插入 token，由内核展开。设置里可以调整这里的顺序和显示。
        </Text>
      </PluginPopup>

      <PluginPopup
        visible={popup?.kind === "message"}
        anchor={popup?.kind === "message" ? popup.anchor : null}
        onClose={() => setPopup(null)}
        width={240}
      >
        <Text style={[styles.popupTitle, { color: th.ink }]}>消息动作</Text>
        <Pressable
          onPress={() => {
            if (popup?.kind !== "message") return;
            setPopup(null);
            setAnnotationEditor({
              messageKey: popup.messageKey,
              ...(popup.messageId ? { messageId: popup.messageId } : {}),
              messageRole: popup.messageRole,
              fullText: popup.message,
              initialExcerpt: popup.message,
              comment: "",
            });
          }}
          accessibilityRole="button"
          accessibilityLabel="添加注释"
          style={({ pressed }) => [
            styles.menuRow,
            { borderColor: th.hairline, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View style={[styles.toolIconSmall, { backgroundColor: th.brandSoft }]}>
            <Icon name="quote" size={15} color={th.brand} />
          </View>
          <View style={styles.menuText}>
            <Text style={[styles.menuLabel, { color: th.ink }]}>注释</Text>
            <Text style={[styles.menuDetail, { color: th.inkFaint }]}>引用原文并写评论</Text>
          </View>
          <Icon name="chevron-right" size={13} color={th.inkGhost} />
        </Pressable>
        {messageMenuItems.length > 0 ? (
          <View style={[styles.menuDivider, { backgroundColor: th.hairline }]} />
        ) : null}
        {messageMenuItems.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => applyMessageCatalogItem(item)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            style={({ pressed }) => [
              styles.menuRow,
              { borderColor: th.hairline, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View
              style={[
                styles.toolIconSmall,
                { backgroundColor: item.group === "skill" ? th.steelSoft : th.brandSoft },
              ]}
            >
              <Icon
                name={(item.icon ?? "sparkles") as IconName}
                size={15}
                color={item.group === "skill" ? th.steel : th.brand}
              />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuLabel, { color: th.ink }]}>{item.title}</Text>
              <Text style={[styles.menuDetail, { color: th.inkFaint }]} numberOfLines={1}>
                {item.group === "skill"
                  ? "引用这条消息并使用技能"
                  : "引用这条消息执行插件命令"}
              </Text>
            </View>
            <Icon name="chevron-right" size={13} color={th.inkGhost} />
          </Pressable>
        ))}
      </PluginPopup>

      <AnnotationComposer
        visible={annotationEditor !== null}
        fullText={annotationEditor?.fullText ?? ""}
        initialExcerpt={annotationEditor?.initialExcerpt}
        initialComment={annotationEditor?.comment}
        instruction={annotationEditor?.instruction}
        instructionLabel={annotationEditor?.instructionLabel}
        editing={annotationEditor?.editingId !== undefined}
        onCancel={() => setAnnotationEditor(null)}
        onSubmit={saveAnnotation}
      />

      <AnnotationManager
        visible={annotationManagerOpen}
        annotations={annotations}
        onClose={() => setAnnotationManagerOpen(false)}
        onEdit={editAnnotation}
        onDelete={deleteAnnotation}
      />

      <PluginActionSheet
        visible={sessionSheet !== null}
        title={sessionSheet?.title ?? ""}
        items={sessionSheet?.items ?? []}
        onClose={() => setSessionSheet(null)}
      />
    </View>
  );
}

/** 顶栏控件统一高度（圆钮/会话 chip/模型 chip 同高）。 */
const TOPBAR_H = 40;

const styles = StyleSheet.create({
  root: { flex: 1 },
  shell: { flex: 1, flexDirection: "row" },
  body: { flex: 1, alignItems: "center" },
  bodyInner: { flex: 1, width: "100%", paddingHorizontal: space(4) },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingBottom: space(1.5),
  },
  topLeft: { flexDirection: "row", alignItems: "center", gap: space(2), flexShrink: 1 },
  topRight: { flexDirection: "row", alignItems: "center", gap: space(2), marginLeft: "auto" },
  fab: {
    width: TOPBAR_H,
    height: TOPBAR_H,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  // 顶栏四件同一高度（TOPBAR_H），高度一致才像一排控件
  chip: {
    height: TOPBAR_H,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingLeft: space(3.5),
    paddingRight: space(3),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "56%",
  },
  chipBody: { gap: 1 },
  chipTitle: { fontSize: 13.5, fontWeight: "700" },
  chipStatus: { flexDirection: "row", alignItems: "center", gap: 4 },
  chipSub: { fontSize: 10 },
  modelChip: {
    height: TOPBAR_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space(3),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modelText: { fontSize: 11.5, fontWeight: "600" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space(4) },
  stageList: { alignItems: "stretch", justifyContent: "flex-start", paddingHorizontal: 0 },
  stageLandscape: { justifyContent: "flex-start", paddingTop: space(3) },
  stageText: { alignItems: "center", gap: space(2) },
  stageTextLandscape: { alignItems: "center", maxWidth: 460, gap: space(1) },
  stageTitle: { fontSize: t.heading, fontWeight: "700" },
  stageSub: { fontSize: t.small, textAlign: "center", lineHeight: 20 },
  stageChips: { flexDirection: "row", gap: space(2), marginTop: space(1) },
  badge: { paddingHorizontal: space(3), paddingVertical: 4, borderRadius: radius.chip },
  badgeText: { fontSize: 11, fontWeight: "600" },
  startCta: {
    marginTop: space(3),
    borderRadius: radius.control,
    paddingHorizontal: space(6),
    paddingVertical: space(3),
    alignSelf: "center",
  },
  startCtaText: { fontSize: 14, fontWeight: "700" },
  // 宠物 + 胶囊浮在会话流底部：绝对定位，列表高度不再为它们让位，消息可以滚到输入栏上方。
  petOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  actionsOverlay: {
    position: "absolute",
    left: space(4),
    bottom: space(2.5),
    width: 112,
  },
  bottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  popupTitle: {
    fontSize: 12.5,
    fontWeight: "700",
    paddingHorizontal: space(2),
    paddingBottom: space(1.5),
  },
  toolIconSmall: {
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
    minHeight: 44,
  },
  menuText: { flex: 1, gap: 1 },
  menuLabel: { fontSize: 12.5, fontWeight: "600" },
  menuDetail: { fontSize: 10 },
  menuDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  plusScroll: { height: 430 },
  plusSection: { paddingBottom: space(1.5) },
  plusTitle: {
    fontSize: 10.5,
    fontWeight: "700",
    paddingHorizontal: space(2),
    paddingTop: space(1.5),
    paddingBottom: 2,
  },
  plusSubtitle: {
    fontSize: 9.5,
    fontWeight: "600",
    paddingHorizontal: space(2),
    paddingTop: space(1.5),
    paddingBottom: 1,
  },
  plusFootnote: {
    fontSize: 9.5,
    lineHeight: 13,
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
  // PetView 的方形画布底部有透明留白/飞行云海；裁到输入栏上沿，避免云海盖住 COMPOSE。
  petDock: { alignItems: "center", overflow: "hidden" },
  petTouch: { alignItems: "center", justifyContent: "center" },
  annotationBadge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(2.5),
    paddingVertical: 4,
    marginBottom: space(1),
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  annotationBadgeText: { fontSize: 10.5, fontWeight: "700" },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingLeft: space(2),
    paddingRight: space(1.5),
    paddingVertical: space(1.5),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.09,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  plus: { width: 32, height: 32, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
  composerInput: { flex: 1, fontSize: 14, paddingVertical: space(1) },
  send: { width: 38, height: 38, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
});
