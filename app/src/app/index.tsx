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
  Animated,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Paths } from "expo-file-system";

import { documentRootOf } from "../kernel/workspace";

import { ConversationList } from "../components/ConversationList";
import { AnnotationComposer, type AnnotationDraft } from "../components/AnnotationComposer";
import { AnnotationManager, type AnnotationItem } from "../components/AnnotationManager";
import { CapsuleStack } from "../components/CapsuleStack";
import { ComposerAttachments } from "../components/ComposerAttachments";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PillButton } from "../components/ui/PillButton";
import { ModelPickerSheet, type ModelChoice } from "../components/ModelPickerSheet";
import { thinkingLevelLabel } from "../components/ThinkingRail";
import { ComposerTokens } from "../components/ComposerTokens";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { BlurTargetView } from "expo-blur";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { haptic } from "../motion/haptics";
import { rubberBandProgress, SIDE_SPRING_CONFIG } from "../motion/sidePhysics";
import { GoDrawer, GoRail, GoSidebar } from "../components/GoDrawer";
import { SideBackdrop } from "../components/SideBackdrop";
import { Dot, Icon, type IconName } from "../components/Icon";
import {
  PET_BASELINE,
  PET_CELL,
  petDisplaySize,
  PetView,
  type PetStateId,
} from "../components/PetView";
import {
  derivePetState,
  nextDevPreviewState,
  type RecentTurnOutcome,
} from "../components/petMachine";
import { PluginActionSheet, type PluginSheetItem } from "../components/PluginActionSheet";
import { MessageActionsSheet } from "../components/MessageActionsSheet";
import { PluginPopup, type PopupAnchor } from "../components/PluginPopup";
import type { PluginActionHandler } from "../components/PluginView";
import { SideStatus, type SessionTodoState } from "../components/SideStatus";
import { WorkspacePanel, type WorkspaceSubagent } from "../components/WorkspacePanel";
import { NewChatSheet } from "../components/NewChatSheet";
import type { AgentFaceStatus } from "../components/AgentFace";
import type { ChatRow } from "@nibi-go/kernel-session";
import { PET_STATE } from "../components/petStates";
import { PressableScale } from "../motion/PressableScale";
import { AppearIn } from "../motion/appear";
import { useKeyboardFollow } from "../motion/keyboard";
import { useConversationPreferences } from "../conversation/useConversationPreferences";
import { useKernelConversation } from "../kernel/useKernelConversation";
import { useProviderCatalog } from "../kernel/useProviderCatalog";
import { resolveAdaptiveLayout } from "../layout/adaptive";
import { runPluginAction, toast, type PluginActionContext } from "../plugins/actions";
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
import {
  buildConversationQuotes,
  buildDraftAnnotationCounts,
  reorderAnnotations,
} from "../composer/annotations";
import { pluginSourceLabel, splitMessageMenuItems } from "../composer/messageMenu";
import { dismissKeyboardOnce, leaveComposerForNavigation } from "../composer/leave";
import { useI18n } from "../i18n";
import { createProject, setActiveProject, useProjects } from "../kernel/projects";
import { usePlugins } from "../plugins/usePlugins";
import type { KernelConversationQuote } from "@nibi-go/kernel-session";
import type { Effect } from "@nibi-go/plugin-contract";
import { radius, space, text, useNibiTheme } from "../theme";

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


const PERMISSION_OPTIONS: ReadonlyArray<{
  id: "build" | "guarded" | "yolo";
  labelZh: string;
  labelEn: string;
  detailZh: string;
  detailEn: string;
  icon: IconName;
}> = [
  {
    id: "build",
    labelZh: "变更前确认",
    labelEn: "Ask before edits",
    detailZh: "改文件前先问我。",
    detailEn: "Ask me before editing files.",
    icon: "pen",
  },
  {
    id: "guarded",
    labelZh: "自主模式",
    labelEn: "Autonomous",
    detailZh: "在有风险时询问",
    detailEn: "Ask only on risky actions.",
    icon: "shield",
  },
  {
    id: "yolo",
    labelZh: "完全访问",
    labelEn: "Full access",
    detailZh: "减少确认次数。",
    detailEn: "Minimize confirmation prompts.",
    icon: "question",
  },
];

/** filesDir 绝对路径：抽屉的项目筛选按它反查会话归属。 */
function workspaceRoot(): string {
  return documentRootOf(Paths.document.uri);
}

export default function GoHomeScreen() {
  const th = useNibiTheme();
  const { locale, pick } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // edge-to-edge 下 adjustResize 不一定会缩小窗口：直接把输入栏抬到键盘上方。
  // 2.0：走 react-native-keyboard-controller WindowInsetsAnimation 逐帧原生驱动。
  const keyboard = useKeyboardFollow(insets.bottom);
  const keyboardHeight = keyboard.height;

  const layout = resolveAdaptiveLayout({ width, height, sidebarOpen });
  // 首页即会话（D2）：内核会话与消息流直接挂在这页。
  const conversation = useKernelConversation();
  const [draft, setDraft] = useState("");
  // 输入栏上方的一次性提示（压缩前置条件、压缩失败等），4 秒后自动收掉。
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHint = (text: string) => {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 4_000);
  };
  // COMPOSE 里的不可编辑 token（插件引用 / 命令 / 技能）。
  const [tokens, setTokens] = useState<ComposerToken[]>([]);
  // 权限模式与计划开关是会话草稿意图：发送时随 sendText 一起交给内核；plan 不改变权限模式。
  const [permissionMode, setPermissionMode] = useState<"build" | "guarded" | "yolo">("build");
  const [planEnabled, setPlanEnabled] = useState(false);
  const [permissionMenu, setPermissionMenu] = useState<PopupAnchor | null>(null);
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const sessionChipRef = useRef<ComponentRef<typeof Pressable> | null>(null);
  // 内置插件的槽（工具卡/快捷动作/面板入口）；启停状态在插件中心改。
  const plugins = usePlugins();
  const projects = useProjects();
  // 新建对话默认进「当前项目」：设置 → 项目里切换；没有项目时沿用独立会话目录。
  const activeProjectId = projects.activeProjectId;
  const providerCatalog = useProviderCatalog();
  const { preferences: conversationPrefs } = useConversationPreferences();
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const composerCatalog = useMemo(
    () =>
      buildComposerCatalog(
        plugins.enabled,
        mergeSkillCatalog(conversation.skills, plugins.enabled),
      ),
    [conversation.skills, locale, plugins.enabled],
  );
  const composerPreferences = useComposerPreferences(composerCatalog);
  // 没有选择时用设置页的默认模型；默认值带档位时优先沿用。
  useEffect(() => {
    if (modelChoice) return;
    const state = providerCatalog.state;
    const preferred = state.default;
    if (preferred?.providerId && preferred.modelId) {
      const provider = state.providers.find((entry) => entry.id === preferred.providerId);
      const config = provider?.modelInfo?.find((model) => model.id === preferred.modelId)?.config;
      const levels = config?.optionSpecs?.reasoningLevel?.values ?? [];
      const fallback = levels[levels.length - 1];
      const reasoningLevel =
        preferred.reasoningLevel && (!levels.length || levels.includes(preferred.reasoningLevel))
          ? preferred.reasoningLevel
          : fallback;
      setModelChoice({
        providerId: preferred.providerId,
        modelId: preferred.modelId,
        ...(reasoningLevel ? { reasoningLevel } : {}),
      });
      return;
    }
    const provider = state.providers.find((entry) => entry.models.length > 0);
    const modelId = provider?.models[0];
    if (provider && modelId) {
      const config = provider.modelInfo?.find((model) => model.id === modelId)?.config;
      const levels = config?.optionSpecs?.reasoningLevel?.values ?? [];
      setModelChoice({
        providerId: provider.id,
        modelId,
        ...(levels.length > 0 ? { reasoningLevel: levels[levels.length - 1] } : {}),
      });
    }
  }, [modelChoice, providerCatalog.state]);

  const selectedProvider = providerCatalog.state.providers.find(
    (provider) => provider.id === modelChoice?.providerId,
  );
  const selectedModelConfig = selectedProvider?.modelInfo?.find(
    (model) => model.id === modelChoice?.modelId,
  )?.config;
  const selectedLevels = selectedModelConfig?.optionSpecs?.reasoningLevel?.values ?? [];
  const modelLabel = modelChoice?.modelId ?? conversation.modelLabel;
  const effortLabel = modelChoice?.reasoningLevel
    ? thinkingLevelLabel(modelChoice.reasoningLevel)
    : selectedLevels.length > 0
      ? thinkingLevelLabel(selectedLevels[selectedLevels.length - 1]!)
      : "";
  const effortProgress =
    modelChoice && selectedLevels.length > 1
      ? Math.max(0, selectedLevels.indexOf(modelChoice.reasoningLevel ?? "")) /
        (selectedLevels.length - 1)
      : 0;

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
  const pluginNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const plugin of plugins.enabled) {
      map.set(plugin.parsed.manifest.id, plugin.parsed.manifest.name);
    }
    return map;
  }, [plugins.enabled]);
  const messageMenuPartition = useMemo(
    () => splitMessageMenuItems(messageMenuItems),
    [messageMenuItems],
  );
  const [messageMoreTarget, setMessageMoreTarget] = useState<{
    messageKey: string;
    message: string;
    messageRole: "user" | "assistant";
    messageId?: string;
  } | null>(null);
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
  const draftAnnotationCounts = useMemo(
    () => buildDraftAnnotationCounts(annotations),
    [annotations],
  );
  const [annotationEditor, setAnnotationEditor] = useState<{
    messageKey: string;
    messageId?: string;
    messageRole: "user" | "assistant";
    fullText: string;
    initialExcerpt?: string;
    initialSelectionStart?: number;
    initialSelectionEnd?: number;
    editingId?: string;
    comment?: string;
    instruction?: string;
    instructionLabel?: string;
    returnToManager?: boolean;
  } | null>(null);
  const [annotationManagerOpen, setAnnotationManagerOpen] = useState(false);
  const [annotationManagerFilter, setAnnotationManagerFilter] = useState<{
    messageKey: string;
    messageText: string;
    messageRole: "user" | "assistant";
    messageId?: string;
  } | null>(null);
  const [scrollToMessage, setScrollToMessage] = useState<{ key: string; seq: number } | null>(
    null,
  );
  // 编辑重发：草稿承载改写文本，发送走 editUserQuery（内核截断历史后重发）；× 取消并清草稿。
  const [editTarget, setEditTarget] = useState<{
    rowId: number;
    entityId: string;
  } | null>(null);
  // 内核判定可编辑的用户行（actions.canEdit 只标最新一条 realUser 输入；旧帧没有 rowId）。
  const lastEditableUserRow = useMemo(() => {
    for (let i = conversation.rows.length - 1; i >= 0; i--) {
      const row = conversation.rows[i];
      if (row.kind === "user" && row.canEdit && typeof row.rowId === "number" && row.entityId) {
        return row;
      }
    }
    return null;
  }, [conversation.rows]);
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
  // Sheet 退场期间仍挂载子内容：关闭时不能把 payload 清成空，否则标题和动作行
  // 会在滑出途中消失（「没有可用的插件动作」闪一下）。保留最后一次非空快照。
  const sessionSheetRef = useRef<{
    title: string;
    items: PluginSheetItem[];
  } | null>(null);
  if (sessionSheet) sessionSheetRef.current = sessionSheet;
  const sessionSheetShown = sessionSheet ?? sessionSheetRef.current;
  const plusRef = useRef<ComponentRef<typeof Pressable> | null>(null);
  // 新建对话归属弹层（底部 sheet）：FAB 与抽屉「新对话」共用——先选归属再开会话，
  // 也可以就地新建项目（名称 + 文件夹名），不必先去设置。
  const [newChatOpen, setNewChatOpen] = useState(false);
  // 右侧工作区面板（文件/子代理）：顶栏文件夹键或右缘往左滑呼出。
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  // 离屏导航前要 blur 输入框：只收键盘不移焦点，Android 会在新页面转场时把输入法再弹一下。
  const composerInputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  // 输入框真实聚焦态：离屏导航只在有焦点时 blur。对未聚焦的 EditText 调 blur()
  // 在 Android 上会反向触发一次 IME 弹出（真机高频采样抓到的闪现来源）。
  const composerFocusedRef = useRef(false);
  // 聚焦光环与发送/停止图标 morph：都是纯透明度/缩放，不触发重排。
  const [composerFocused, setComposerFocused] = useState(false);
  const stopping = conversation.turn === "running";
  const [pendingSend, setPendingSend] = useState(false);
  const pendingSendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusRing = useRef(new Animated.Value(0)).current;
  const sendMorph = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (conversation.turn === "running") setPendingSend(false);
  }, [conversation.turn]);
  useEffect(() => {
    if (!conversation.sending && conversation.statusKind === "error") setPendingSend(false);
  }, [conversation.sending, conversation.statusKind]);
  useEffect(() => {
    setPendingSend(false);
  }, [conversation.activeSessionId]);
  useEffect(
    () => () => {
      if (pendingSendTimer.current) clearTimeout(pendingSendTimer.current);
    },
    [],
  );
  useEffect(() => {
    Animated.timing(focusRing, {
      toValue: composerFocused ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [composerFocused, focusRing]);
  useEffect(() => {
    Animated.timing(sendMorph, {
      toValue: stopping ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [sendMorph, stopping]);
  // 离屏导航窗口期锁死 composer：editable=false 会让 Android 清掉 IME 的 served view，
  // ColorOS/百度输入法在抽屉关闭动画期间再无机会把键盘弹出来（真机截图复现三次后
  // 用这一招正面压制）。推送完成后定时解锁。
  const [composerLocked, setComposerLocked] = useState(false);
  const blurComposer = () => {
    if (composerFocusedRef.current) composerInputRef.current?.blur();
  };

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
    command: {
      // "/" 用 dismissTo：首页自己发起命令时不会压出第二份首页（否则会再起一个内核客户端）。
      navigate: (path) => (path === "/" ? router.dismissTo("/") : router.push(path)),
      toast,
      newSession: conversation.newSession,
      compact: conversation.compact,
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
      // 命令、模式、技能各只认一个：内核只展开正文第一个 `/名字`，多选的技能不会生效。
      if (token.kind === "command" || token.kind === "mode" || token.kind === "skill") {
        return [...current.filter((entry) => entry.kind !== token.kind), token];
      }
      if (current.some((entry) => entry.id === token.id)) return current;
      return [...current, token];
    });
  };
  const setPlanMode = (enabled: boolean) => {
    setPlanEnabled(enabled);
    if (enabled) {
      addToken({
        id: "mode:plan",
        kind: "mode",
        pluginId: "nibi",
        pluginName: "NIBI",
        label: pick("计划模式", "Plan mode"),
        value: "plan",
        mode: "plan",
        accent: "brand",
        icon: "doc",
      });
    } else {
      setTokens((current) => current.filter((token) => token.kind !== "mode"));
    }
  };

  // 打开/新建会话时同步内核快照里的权限模式、计划与模型；用户改的草稿在发送前不被覆盖。
  useEffect(() => {
    setPermissionMode(conversation.sessionMode);
    if (conversation.sessionPlanEnabled) {
      setPlanEnabled(true);
      setTokens((current) =>
        current.some((token) => token.kind === "mode")
          ? current
          : [
              ...current,
              {
                id: "mode:plan",
                kind: "mode",
                pluginId: "nibi",
                pluginName: "NIBI",
                label: pick("计划模式", "Plan mode"),
                value: "plan",
                mode: "plan",
                accent: "brand",
                icon: "doc",
              },
            ],
      );
    } else {
      setPlanEnabled(false);
      setTokens((current) => current.filter((token) => token.kind !== "mode"));
    }
  }, [conversation.activeSessionId]);

  // 空会话不认快照里的模型：内核给空草稿的缺省可能是别的 provider（曾把 mock 写进会话并
// 一路沿用）。有真实消息后再按会话快照走。
  const sessionHasMessages = conversation.rows.some(
    (row) => row.kind === "user" || row.kind === "assistant",
  );
  useEffect(() => {
    if (!sessionHasMessages) return;
    if (conversation.currentModelSelection) setModelChoice(conversation.currentModelSelection);
  }, [conversation.currentModelSelection, sessionHasMessages]);

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
      label: pick("这条消息", "This message"),
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
      if (token.value === "plan") {
        setPlanMode(true);
      } else {
        setPlanMode(false);
      }
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

  /** 长按消息菜单：先引用消息，再触发命令/技能（不是注释评论）；同时支持浮层与「更多」抽屉。 */
  const applyMessageCatalogItem = (
    item: ComposerCatalogItem,
    explicitTarget?: {
      messageKey: string;
      message: string;
      messageRole: "user" | "assistant";
    },
  ) => {
    const target = explicitTarget ?? (popup?.kind === "message" ? popup : null);
    if (!target) return;
    setPopup(null);
    setMessageMoreTarget(null);
    const token = item.token;
    const pluginName = pluginSourceLabel(item, pluginNameMap);
    addMessageReference(
      target.messageKey,
      target.message,
      target.messageRole,
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
      title: title
        ? `${pick("会话信息", "Session info")} · ${title}`
        : pick("会话信息", "Session info"),
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
  const saveAnnotation = ({ excerpt, comment, selectionStart, selectionEnd }: AnnotationDraft) => {
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
                selectionStart,
                selectionEnd,
                ...(editor.instruction ? { instruction: editor.instruction } : {}),
              }
            : annotation,
        ),
      );
    } else {
      setAnnotations((current) => [
        ...current,
        {
          id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          messageKey: editor.messageKey,
          ...(editor.messageId ? { messageId: editor.messageId } : {}),
          messageRole: editor.messageRole,
          messageText: excerpt,
          fullText: editor.fullText,
          selectionStart,
          selectionEnd,
          comment,
          ...(editor.instruction ? { instruction: editor.instruction } : {}),
          createdAt: Date.now(),
        },
      ]);
    }
    const shouldReopenManager = Boolean(editor.returnToManager);
    setAnnotationEditor(null);
    if (shouldReopenManager) setAnnotationManagerOpen(true);
  };
  const editAnnotation = (annotation: AnnotationItem) => {
    setAnnotationManagerOpen(false);
    setAnnotationEditor({
      messageKey: annotation.messageKey,
      ...(annotation.messageId ? { messageId: annotation.messageId } : {}),
      messageRole: annotation.messageRole,
      fullText: annotation.fullText || annotation.messageText,
      initialExcerpt: annotation.messageText,
      initialSelectionStart: annotation.selectionStart,
      initialSelectionEnd: annotation.selectionEnd,
      editingId: annotation.id,
      comment: annotation.comment,
      ...(annotation.instruction ? { instruction: annotation.instruction } : {}),
      returnToManager: true,
    });
  };
  const deleteAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  };
  const clearAllAnnotations = () => {
    setAnnotations([]);
    setAnnotationManagerFilter(null);
    setAnnotationManagerOpen(false);
  };
  const reorderAnnotationItem = (index: number, delta: -1 | 1) => {
    setAnnotations((current) => reorderAnnotations(current, index, delta));
  };
  const jumpToAnnotatedMessage = (messageKey: string) => {
    setAnnotationManagerOpen(false);
    setScrollToMessage((prev) => ({ key: messageKey, seq: (prev?.seq ?? 0) + 1 }));
  };
  const handleAnnotationMarkPress = (
    messageKey: string,
    hasDraft: boolean,
    messageText: string,
    messageRole: "user" | "assistant",
    messageId?: string,
  ) => {
    if (hasDraft) {
      setAnnotationManagerFilter({ messageKey, messageText, messageRole, messageId });
      setAnnotationManagerOpen(true);
      return;
    }
    setAnnotationEditor({
      messageKey,
      ...(messageId ? { messageId } : {}),
      messageRole,
      fullText: messageText,
      initialExcerpt: messageText,
      comment: "",
    });
  };

  // 稳定引用桥：抽屉/面板开合会让首页整体重渲染，若给消息流的回调每次都换引用，
  // ConversationList 的 memo 就永远命中不了——整条消息流会跟着侧栏动画一起重排，
  // 这就是「滑动时不够丝滑」的一大来源。回调身份固定，内部始终调最新闭包。
  const latestHandlers = useRef({
    openSession: conversation.openSession,
    retryTurn: conversation.retryTurn,
    openMessagePopup,
    handleAnnotationMarkPress,
    onPluginAction,
    showHint,
  });
  latestHandlers.current = {
    openSession: conversation.openSession,
    retryTurn: conversation.retryTurn,
    openMessagePopup,
    handleAnnotationMarkPress,
    onPluginAction,
    showHint,
  };
  const stableOpenSession = useCallback((sessionId: string) => {
    void latestHandlers.current.openSession(sessionId);
  }, []);
  const stableRetryTurn = useCallback((target: { rowId: number; entityId: string }) => {
    void latestHandlers.current.retryTurn(target).then((error) => {
      if (error) latestHandlers.current.showHint(error);
    });
  }, []);
  const stableOpenMessagePopup = useCallback(
    (
      messageKey: string,
      message: string,
      anchor: PopupAnchor,
      role: "user" | "assistant",
      messageId?: string,
    ) => {
      latestHandlers.current.openMessagePopup(messageKey, message, anchor, role, messageId);
    },
    [],
  );
  const stableAnnotationMarkPress = useCallback(
    (
      messageKey: string,
      hasDraft: boolean,
      messageText: string,
      messageRole: "user" | "assistant",
      messageId?: string,
    ) => {
      latestHandlers.current.handleAnnotationMarkPress(
        messageKey,
        hasDraft,
        messageText,
        messageRole,
        messageId,
      );
    },
    [],
  );
  const stablePluginAction = useCallback<PluginActionHandler>((plugin, action) => {
    latestHandlers.current.onPluginAction(plugin, action);
  }, []);
  const sendDraft = () => {
    // 编辑重发：只发改写文本（内核 editUserQuery 截断历史后重发），不走普通发送链路。
    if (editTarget) {
      const text = draft.trim();
      if (!text) return;
      const target = editTarget;
      setEditTarget(null);
      setDraft("");
      void conversation.editResend(target, text).then((error) => {
        if (error) showHint(error);
      });
      return;
    }
    // 压缩是内核动作，不是一条消息：走 `compact` RPC，不留用户气泡、不发文本。
    // 带别的输入（附件/注释/引用）时不吞掉它们，只提示先单独压缩。
    const compactToken = tokens.find(
      (token) => token.kind === "command" && token.value === "compact",
    );
    if (compactToken) {
      const hasOther =
        draft.trim().length > 0 ||
        attachments.length > 0 ||
        annotations.length > 0 ||
        tokens.some((token) => token.id !== compactToken.id && token.kind !== "mode");
      if (hasOther) {
        showHint(
          pick(
            "压缩需要单独发送：请先清掉其他内容或附件",
            "Send /compact by itself: clear other text or attachments first",
          ),
        );
        return;
      }
      // 对话还很短时压缩不划算：摘要会把“消息”换成一段比它更长的话，上下文反而变大。
      const messageChars =
        conversation.contextUsage?.breakdown?.find((item) => item.source === "messages")
          ?.chars ?? 0;
      const messageTokens = Math.round(messageChars / 4);
      if (messageTokens > 0 && messageTokens < 2_000) {
        showHint(
          pick(
            `当前对话只有约 ${messageTokens} tokens，压缩不会更省`,
            `This conversation is only ~${messageTokens} tokens — compacting won't save space`,
          ),
        );
        return;
      }
      setTokens((current) => current.filter((token) => token.id !== compactToken.id));
      void conversation.compact().then((error) => {
        if (error) showHint(error);
      });
      return;
    }
    // 目标也走内核 RPC：`/goal` 当文本发时，设置虽生效但回执走 Meta stdout、界面看不到；
    // `/goal pause` 还会被内核当成一个叫 “pause” 的新目标。这里明确区分四种动作。
    const goalToken = tokens.find(
      (token) => token.kind === "command" && token.value === "goal",
    );
    if (goalToken) {
      const input = draft.trim();
      const keyword = input.toLowerCase();
      const action =
        keyword === ""
          ? "show"
          : keyword === "pause"
            ? "pause"
            : keyword === "resume" || keyword === "continue"
              ? "resume"
              : keyword === "clear" || keyword === "off"
                ? "clear"
                : "set";
      setTokens((current) => current.filter((token) => token.id !== goalToken.id));
      setDraft("");
      showHint(
        action === "show"
          ? pick("正在读取目标…", "Loading goal…")
          : pick("正在更新目标…", "Updating goal…"),
      );
      void conversation
        .runGoal(action, action === "set" ? input : undefined)
        .then(({ message }) => showHint(message));
      return;
    }
    const prompt = composePrompt(tokens, draft);
    const quotes: KernelConversationQuote[] = buildConversationQuotes(annotations, tokens, {
      user: pick("我", "Me"),
      assistant: "NIBI",
    });
    if (!prompt && quotes.length === 0 && attachments.length === 0) return;
    const pluginReferences = pluginReferencesForTokens(tokens);
    const attachmentRefs = attachments.map(toAttachmentRef);
    const snapshotAnnotations = annotations;
    const snapshotTokens = tokens;
    const snapshotAttachments = attachments;
    const snapshotDraft = draft;
    setAnnotations([]);
    setTokens((current) => current.filter((token) => token.kind === "mode"));
    setAttachments([]);
    setDraft("");
    void conversation
      .send(prompt, {
        ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
        mode: permissionMode,
        planEnabled,
        ...(modelChoice ? { modelSelection: modelChoice } : {}),
        ...(quotes.length > 0 ? { conversationQuotes: quotes } : {}),
        ...(pluginReferences.length > 0 ? { pluginReferences } : {}),
      })
      .then((ok) => {
        if (ok) return;
        // 发送失败时恢复草稿与注释，防止精心编写的注释丢失。
        if (snapshotAnnotations.length > 0) {
          setAnnotations((cur) => (cur.length === 0 ? snapshotAnnotations : cur));
        }
        if (snapshotAttachments.length > 0) {
          setAttachments((cur) => (cur.length === 0 ? snapshotAttachments : cur));
        }
        if (snapshotDraft) {
          setDraft((cur) => (cur.length === 0 ? snapshotDraft : cur));
        }
        const nonMode = snapshotTokens.filter((token) => token.kind !== "mode");
        if (nonMode.length > 0) {
          setTokens((cur) =>
            cur.some((token) => token.kind !== "mode") ? cur : snapshotTokens,
          );
        }
      });
  };

  // 面板动作里的“插入草稿”跨页带回首页；同时维护屏焦点，离焦时暂停宠物动画省电。
  const [screenFocused, setScreenFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      const text = takePendingInsert();
      if (text) {
        setDraft((current) => (current.length > 0 ? `${current}\n${text}` : text));
      }
      return () => setScreenFocused(false);
    }, []),
  );
  // 切换会话时清掉上一轮的注释/弹出层，避免把 A 会话的注释带进 B。
  useEffect(() => {
    setAnnotations([]);
    setTokens([]);
    setAttachments([]);
    setAnnotationEditor(null);
    setAnnotationManagerOpen(false);
    setAnnotationManagerFilter(null);
    setPopup(null);
  }, [conversation.activeSessionId]);
  // 发送反馈：sendText 的 RPC 很快返回、turn 变 running 要再等一拍；这段空窗
  // 里 canSend 已经是 false，按钮会先暗一下再变停止键。本地 pending 标记把这段
  // 填上（4s 兜底，避免发送失败时一直亮着）。
  const markPendingSend = () => {
    setPendingSend(true);
    if (pendingSendTimer.current) clearTimeout(pendingSendTimer.current);
    pendingSendTimer.current = setTimeout(() => setPendingSend(false), 4_000);
  };
  const submitDraft = () => {
    if (!canSend) return;
    markPendingSend();
    sendDraft();
  };
  const permissionLabel =
    permissionMode === "yolo"
      ? pick("完全访问", "Full access")
      : permissionMode === "guarded"
        ? pick("自主", "Auto")
        : pick("变更前", "Ask");
  const choosePermission = (id: "build" | "guarded" | "yolo") => {
    if (id === permissionMode) {
      setPermissionMenu(null);
      return;
    }
    if (id === "yolo") {
      setPermissionMenu(null);
      setConfirmFullAccess(true);
      return;
    }
    setPermissionMode(id);
    setPermissionMenu(null);
  };
  const activeTitle =
    conversation.sessions.find((session) => session.sessionId === conversation.activeSessionId)
      ?.title || pick("新对话", "New chat");
  // 配置缺失（没配模型服务）按结构化 setupIssue 判断，不再耦合中文文案。
  const setupIssue = conversation.setupIssue;
  // 2.1：桌宠走纯状态机 petMachine.ts，覆盖全部 9 种状态：
  //   拖动 → flying；报错 → error；等审批/提问 → waiting；
  //   执行交付工具/挂载附件注释 → carrying；执行工具/流式正文 → working；
  //   首 token 前/纯思考推理 → thinking；回合完成 → done（2.4s）；
  //   内核未就绪或 90s 无互动 → sleeping；默认 → idle。
  const [previewState, setPreviewState] = useState<PetStateId | null>(null);
  const [isDraggingPet, setIsDraggingPet] = useState(false);
  const [recentTurnOutcome, setRecentTurnOutcome] = useState<RecentTurnOutcome>(null);
  const [idleSleeping, setIdleSleeping] = useState(false);
  const outcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleSleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wakePet = useCallback(() => {
    setIdleSleeping(false);
    if (idleSleepTimerRef.current) clearTimeout(idleSleepTimerRef.current);
    idleSleepTimerRef.current = setTimeout(() => setIdleSleeping(true), 90_000);
  }, []);

  useEffect(() => {
    wakePet();
    return () => {
      if (idleSleepTimerRef.current) clearTimeout(idleSleepTimerRef.current);
    };
  }, [
    wakePet,
    draft,
    conversation.turn,
    conversation.rows.length,
    conversation.activeSessionId,
    attachments.length,
    annotations.length,
    isDraggingPet,
  ]);

  // 回合结束短时反馈（completed → done 2.4s，failed → error 3.5s）：
  // 新回合开始或切换会话立刻清掉定时器与状态，彻底避免 celebrating 卡死。
  const lastTurnState = useMemo(() => {
    for (let i = conversation.rows.length - 1; i >= 0; i--) {
      const row = conversation.rows[i]!;
      if (row.kind === "turn") return row.state;
    }
    return null;
  }, [conversation.rows]);
  const runningRef = useRef(false);
  const lastTurnStateRef = useRef(lastTurnState);
  lastTurnStateRef.current = lastTurnState;

  useEffect(() => {
    if (outcomeTimerRef.current) {
      clearTimeout(outcomeTimerRef.current);
      outcomeTimerRef.current = null;
    }
    runningRef.current = false;
    setRecentTurnOutcome(null);
  }, [conversation.activeSessionId]);

  useEffect(() => {
    const wasRunning = runningRef.current;
    const isRunning = conversation.turn === "running";
    runningRef.current = isRunning;
    if (isRunning) {
      if (outcomeTimerRef.current) {
        clearTimeout(outcomeTimerRef.current);
        outcomeTimerRef.current = null;
      }
      setRecentTurnOutcome(null);
      return;
    }
    if (!wasRunning) return;
    const state = lastTurnStateRef.current;
    const nextOutcome: RecentTurnOutcome =
      state === "completed" ? "completed" : state === "failed" ? "failed" : null;
    if (!nextOutcome) return;
    setRecentTurnOutcome(nextOutcome);
    if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
    outcomeTimerRef.current = setTimeout(
      () => {
        outcomeTimerRef.current = null;
        setRecentTurnOutcome(null);
      },
      nextOutcome === "completed" ? 2400 : 3500,
    );
  }, [conversation.turn]);

  useEffect(() => {
    return () => {
      if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
    };
  }, []);

  const livePetState = useMemo<PetStateId>(
    () =>
      derivePetState({
        dragging: isDraggingPet,
        statusKind: conversation.statusKind,
        setupIssue,
        reconnecting: conversation.statusKind === "busy" && !conversation.ready,
        ready: conversation.ready,
        turn: conversation.turn,
        pendingSend,
        rows: conversation.rows,
        recentOutcome: recentTurnOutcome,
        hasQueuedPayloads: attachments.length > 0 || annotations.length > 0,
        idleSleeping,
      }),
    [
      isDraggingPet,
      conversation.statusKind,
      setupIssue,
      conversation.ready,
      conversation.turn,
      pendingSend,
      conversation.rows,
      recentTurnOutcome,
      attachments.length,
      annotations.length,
      idleSleeping,
    ],
  );
  const petState = previewState ?? livePetState;
  const handlePetTap = () => {
    wakePet();
    if (!__DEV__) return;
    const next = nextDevPreviewState(previewState);
    setPreviewState(next);
    showHint(next ? `Pet preview: ${next}` : "Pet preview: live");
  };

  // 右侧工作区面板：当前会话的 workspace 目录 + 本会话子代理状态。
  const activeWorkspacePath = useMemo(() => {
    const session = conversation.sessions.find(
      (entry) => entry.sessionId === conversation.activeSessionId,
    );
    return session?.workspace?.workspacePath ?? null;
  }, [conversation.sessions, conversation.activeSessionId]);
  // 侧栏进度（Reanimated 共享值，UI 线程驱动）：+1 = 左抽屉完全展开，
  // -1 = 右侧面板完全展开，0 = 都收起。中部任意位置横滑跟手（临界阻尼弹簧，
  // 保留甩动速度、边缘轻橡皮筋、过阈微触感）；纵向滚动不受影响（failOffsetY 让位）。
  const side = useSharedValue(0);
  // 当前展开侧（0 收起 / 1 抽屉 / -1 面板）：手势方向判定用，工作线程可读。
  const sideMode = useSharedValue(0);
  // 手指正在拖动侧栏的标记（1=拖动中，0=松手）：拖动期绝不挂载 BlurView 掉帧。
  const sideDragging = useSharedValue(0);
  const sidePanActive = useSharedValue(0);
  const sideCrossed = useSharedValue(0);
  const drawerW = useSharedValue(320);
  const panelW = useSharedValue(360);
  const canOpenOverlayDrawer = useSharedValue(1);
  useEffect(() => {
    drawerW.value = layout.drawerWidth + insets.left;
    panelW.value = layout.workspacePanelWidth + insets.right;
    canOpenOverlayDrawer.value = layout.left === "sidebar" ? 0 : 1;
  }, [
    layout.drawerWidth,
    layout.workspacePanelWidth,
    layout.left,
    insets.left,
    insets.right,
    drawerW,
    panelW,
    canOpenOverlayDrawer,
  ]);
  useEffect(() => {
    sideMode.value = drawerOpen ? 1 : workspacePanelOpen ? -1 : 0;
  }, [drawerOpen, workspacePanelOpen, sideMode]);
  // 玻璃模糊目标：被侧栏遮住的主内容。expo-blur 的 Android 实现必须把内容包进
  // BlurTargetView 并传给 BlurView，否则 blurMethod 静默为 none（真机实测无模糊）。
  const blurTargetRef = useRef<ComponentRef<typeof View> | null>(null);
  const openDrawerSide = (animate = true) => {
    // 只 blur（有焦点才会真的收键盘）；不再补一次 Keyboard.dismiss——百度输入法
    // 对「已经收起时的再次 dismiss」会反转成弹出，这是键盘闪现反复复发的根因。
    blurComposer();
    setDrawerOpen(true);
    if (animate) {
      haptic("tap");
      side.value = withSpring(1, SIDE_SPRING_CONFIG);
    }
  };
  const closeDrawerSide = (animate = true) => {
    setDrawerOpen(false);
    if (animate) side.value = withSpring(0, SIDE_SPRING_CONFIG);
  };
  const openPanelSide = (animate = true) => {
    blurComposer();
    setWorkspacePanelOpen(true);
    if (animate) {
      haptic("tap");
      side.value = withSpring(-1, SIDE_SPRING_CONFIG);
    }
  };
  const closePanelSide = (animate = true) => {
    setWorkspacePanelOpen(false);
    if (animate) side.value = withSpring(0, SIDE_SPRING_CONFIG);
  };
  const sideGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!drawerOpen && !workspacePanelOpen)
        .activeOffsetX([-24, 24])
        .failOffsetY([-14, 14])
        .onBegin(() => {
          "worklet";
          sidePanActive.value = 0;
          sideCrossed.value = 0;
        })
        .onStart(() => {
          "worklet";
          sidePanActive.value = 1;
          sideDragging.value = 1;
          sideCrossed.value = 0;
        })
        .onUpdate((event) => {
          "worklet";
          const mode = sideMode.value;
          if (mode === 0) {
            if (event.translationX > 0) {
              if (canOpenOverlayDrawer.value === 0) {
                side.value = 0;
                return;
              }
              const raw = event.translationX / drawerW.value;
              side.value = raw > 1 ? 1 + rubberBandProgress(raw - 1) : raw;
            } else {
              const raw = event.translationX / panelW.value;
              side.value = raw < -1 ? -1 - rubberBandProgress(-1 - raw) : raw;
            }
            const absP = Math.abs(side.value);
            if (absP > 0.35 && sideCrossed.value === 0) {
              sideCrossed.value = 1;
              runOnJS(haptic)("threshold");
            } else if (absP < 0.25 && sideCrossed.value === 1) {
              sideCrossed.value = 0;
            }
          } else if (mode === 1) {
            const raw = 1 + event.translationX / drawerW.value;
            side.value = raw > 1 ? 1 + rubberBandProgress(raw - 1) : Math.max(0, raw);
            if (side.value < 0.65 && sideCrossed.value === 0) {
              sideCrossed.value = 1;
              runOnJS(haptic)("threshold");
            } else if (side.value > 0.75 && sideCrossed.value === 1) {
              sideCrossed.value = 0;
            }
          } else {
            const raw = -1 + event.translationX / panelW.value;
            side.value = raw < -1 ? -1 - rubberBandProgress(-1 - raw) : Math.min(0, raw);
            if (side.value > -0.65 && sideCrossed.value === 0) {
              sideCrossed.value = 1;
              runOnJS(haptic)("threshold");
            } else if (side.value < -0.75 && sideCrossed.value === 1) {
              sideCrossed.value = 0;
            }
          }
        })
        .onEnd((event) => {
          "worklet";
          const mode = sideMode.value;
          const progress = side.value;
          const fast = Math.abs(event.velocityX) > 550;
          if (mode === 0) {
            if (canOpenOverlayDrawer.value === 1 && (progress > 0.35 || (fast && event.velocityX > 0))) {
              const v = event.velocityX / drawerW.value;
              side.value = withSpring(1, { ...SIDE_SPRING_CONFIG, velocity: v });
              runOnJS(openDrawerSide)(false);
            } else if (progress < -0.35 || (fast && event.velocityX < 0)) {
              const v = event.velocityX / panelW.value;
              side.value = withSpring(-1, { ...SIDE_SPRING_CONFIG, velocity: v });
              runOnJS(openPanelSide)(false);
            } else {
              const denom = progress >= 0 ? drawerW.value : panelW.value;
              side.value = withSpring(0, { ...SIDE_SPRING_CONFIG, velocity: event.velocityX / denom });
            }
          } else if (mode === 1) {
            const v = event.velocityX / drawerW.value;
            if (progress < 0.65 || (fast && event.velocityX < 0)) {
              side.value = withSpring(0, { ...SIDE_SPRING_CONFIG, velocity: v });
              runOnJS(closeDrawerSide)(false);
            } else {
              side.value = withSpring(1, { ...SIDE_SPRING_CONFIG, velocity: v });
            }
          } else {
            const v = event.velocityX / panelW.value;
            if (progress > -0.65 || (fast && event.velocityX > 0)) {
              side.value = withSpring(0, { ...SIDE_SPRING_CONFIG, velocity: v });
              runOnJS(closePanelSide)(false);
            } else {
              side.value = withSpring(-1, { ...SIDE_SPRING_CONFIG, velocity: v });
            }
          }
        })
        .onFinalize((_event, success) => {
          "worklet";
          if (sidePanActive.value === 1) {
            sidePanActive.value = 0;
            sideDragging.value = 0;
            if (!success) {
              side.value = withSpring(sideMode.value, SIDE_SPRING_CONFIG);
            }
          }
        }),
    // 回调都是稳定的 setter；按侧栏开关状态启用/停用中部手势。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawerOpen, workspacePanelOpen],
  );
  // 舞台微景深（纯 GPU scale + 圆角，仅作用在 BlurTargetView 内部正文层；
  // 拖动期 BlurView 未挂载、停稳后模糊已冻结，所以零额外模糊帧开销）。
  const bodyDepthStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(side.value));
    return {
      transform: [{ scale: 1 - 0.022 * p }],
      borderRadius: p > 0.002 ? Math.round(18 * p) : 0,
    };
  });
  const closeSide = () => {
    if (drawerOpen) closeDrawerSide(true);
    else if (workspacePanelOpen) closePanelSide(true);
  };
  const closeSideFromSwipe = () => {
    if (drawerOpen) closeDrawerSide(false);
    else if (workspacePanelOpen) closePanelSide(false);
  };
  const [atBottom, setAtBottom] = useState(true);
  const [jumpSignal, setJumpSignal] = useState(0);
  const showJump = !atBottom && conversation.rows.length > 0;
  const jumpAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(jumpAnim, {
      toValue: showJump ? 1 : 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 280,
      mass: 0.7,
    }).start();
  }, [jumpAnim, showJump]);
  const keyboardLift = useMemo(
    () => Animated.multiply(keyboard.offset, -1),
    [keyboard.offset],
  );
  // 键盘取证：侧栏开着时如果 IME 还是弹出来，把调用栈打进 logcat（排查复发用）。
  const sideOpenRef = useRef({ drawer: false, panel: false });
  sideOpenRef.current = { drawer: drawerOpen, panel: workspacePanelOpen };
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => {
      if (sideOpenRef.current.drawer || sideOpenRef.current.panel) {
        console.warn("[nibi] keyboard shown while side panel open", new Error().stack);
      }
    });
    return () => shown.remove();
  }, []);

  // 悬浮工具卡的会话状态面：子代理（subagent 行 + Agent 工具行归并）与最新待办进度。
  // 递归收 toolGroup/process 里的嵌套行；Agent 工具行本身 success ≠ 子代理完成——
  // 触发的子代理仍在后台跑时工具行按运行中计。
  const sessionTools = useMemo(() => {
    type Face = {
      key: string;
      name: string;
      status: AgentFaceStatus;
      fromRow: boolean;
      summary?: string;
      childSessionId?: string;
    };
    const faces: Face[] = [];
    let todos: SessionTodoState | undefined;
    const faceStatus = (raw: string | undefined, backgrounded?: boolean): AgentFaceStatus =>
      raw === "failed" || raw === "error"
        ? "failed"
        : raw === "cancelled"
          ? "cancelled"
          : raw === "running" || raw === "inputStreaming" || raw === "pendingApproval"
            ? "running"
            : !raw && backgrounded
              ? "running"
              : "completed";
    const runningByTool = new Set<string>();
    const visit = (rows: readonly ChatRow[]) => {
      for (const row of rows) {
        if (row.kind === "subagent") {
          const status = faceStatus(row.status, row.backgrounded);
          if (status === "running" && row.parentToolCallId) runningByTool.add(`t${row.parentToolCallId}`);
          faces.push({
            key: row.key,
            name: row.subagentType,
            status,
            fromRow: true,
            ...(row.summary ? { summary: row.summary } : {}),
            ...(row.childSessionId ? { childSessionId: row.childSessionId } : {}),
          });
        } else if (row.kind === "tool") {
          if (row.name === "Agent") {
            const name =
              row.detail
                ? /"subagent_type"\s*:\s*"([^"]+)"/u.exec(row.detail)?.[1] ?? "Agent"
                : "Agent";
            faces.push({
              key: row.key,
              name,
              status: runningByTool.has(row.key) ? "running" : faceStatus(row.status),
              fromRow: false,
              ...(row.childSessionId ? { childSessionId: row.childSessionId } : {}),
            });
          }
          if (row.name === "TodoWrite" && row.todos) {
            const done = row.todos.filter((item) => item.status === "completed").length;
            const active = row.todos.find((item) => item.status === "in_progress");
            todos = {
              done,
              total: row.todos.length,
              ...(active ? { active: active.activeForm ?? active.content } : {}),
            };
          }
        } else if (row.kind === "toolGroup") {
          visit(row.tools);
        } else if (row.kind === "process") {
          visit(row.rows);
        }
      }
    };
    visit(conversation.rows);
    // 时间倒序后运行中排前；同一把手的运行中条目只留 subagent 行那份（它带子会话）。
    const latestFirst = [...faces].reverse();
    const deduped = latestFirst.filter(
      (face, index) =>
        !(
          !face.fromRow &&
          face.status === "running" &&
          latestFirst.some(
            (other) =>
              other !== face && other.fromRow && other.name === face.name && other.status === "running",
          )
        ) &&
        // 同一工具行可能既在 toolGroup 又在顶层重放：按 key 去重。
        latestFirst.findIndex((other) => other.key === face.key) === index,
    );
    const ordered = [
      ...deduped.filter((face) => face.status === "running"),
      ...deduped.filter((face) => face.status !== "running"),
    ];
    return {
      subagents: ordered.slice(0, 5),
      ...(todos ? { todos } : {}),
    };
  }, [conversation.rows]);

  // 宠物目标尺寸（dp）；PetView 按设备像素整数倍输出真实 box（crop=1 时零裁切）。
  // 手机 88 / 横屏 72（省高度）/ 平板 104。
  const petTarget = layout.landscapeCompact ? 72 : layout.windowClass === "compact" ? 88 : 104;
  const petBox = petDisplaySize(petTarget, 1).box;
  // 只裁掉脚线（y=58）下方极窄的透明底边，顶部 y=0 完整保留，彻底杜绝思考云顶部裁切。
  const petDockHeight = Math.ceil((petBox * PET_BASELINE) / PET_CELL) + 2;
  // 状态点挂在整个屏幕的右缘（不在正文的 16dp 留白里），底部按 COMPOSE 高度让位。
  // Android edgeToEdge 下 keyboardHeight 已扣除导航栏，需要加回 insets.bottom 才与输入栏对齐。
  const composerBottom = insets.bottom + space(2) + keyboardHeight;
  const statusBottom = composerBottom + 52 + petDockHeight + space(8);
  const hasSidebar = layout.left === "sidebar";
  const hasRail = layout.left === "rail";
  const inShell = hasSidebar || hasRail;

  // 顶栏 ≡ 键：侧栏 → 折叠；rail → 展开；无栏 → 开抽屉
  const onMenu = () => {
    if (layout.menuAction === "collapse") setSidebarOpen(false);
    else if (layout.menuAction === "expand") {
      // 展开侧栏也先清掉输入框焦点：否则随后点设置时转场会把输入法再弹一下。
      blurComposer();
      setSidebarOpen(true);
    } else {
      // 开抽屉前就 blur：抽屉本身会收键盘，但焦点还在输入框，点设置时输入法会闪。
      openDrawerSide();
    }
  };

  const bodyMax = Math.min(
    layout.bodyMaxWidth,
    inShell ? layout.bodyWidth - space(8) : layout.bodyMaxWidth,
  );

  // 宠物横向拖动（UI 线程 Reanimated SharedValue 驱动，拖动期 0 次 GoHomeScreen 重渲染）：
  // 偏移归一化到 -1..1，跨旋转/换尺寸自动收敛；拖动中自动切入 flying 态。
  const petRange = Math.max(0, (bodyMax - space(8) - petBox) / 2);
  const petRangeSv = useSharedValue(petRange);
  useEffect(() => {
    petRangeSv.value = petRange;
  }, [petRange, petRangeSv]);
  const petOffsetSv = useSharedValue(0);
  const petDragStartSv = useSharedValue(0);
  const petTranslateStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: petOffsetSv.value * petRangeSv.value }],
  }));
  const petDragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-6, 6])
        .failOffsetY([-12, 12])
        .onStart(() => {
          petDragStartSv.value = petOffsetSv.value;
          runOnJS(setIsDraggingPet)(true);
        })
        .onUpdate((e) => {
          const range = petRangeSv.value;
          if (range <= 0) return;
          const next = petDragStartSv.value + e.translationX / range;
          petOffsetSv.value = Math.max(-1, Math.min(1, next));
        })
        .onFinalize(() => {
          runOnJS(setIsDraggingPet)(false);
        }),
    [petDragStartSv, petOffsetSv, petRangeSv],
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

      <BlurTargetView ref={blurTargetRef} style={styles.shell}>
        {hasSidebar ? (
          <GoSidebar
            workspaceRoot={workspaceRoot()}
            petState={petState}
            sessions={conversation.sessions}
            archivedSessions={conversation.archivedSessions}
            activeSessionId={conversation.activeSessionId}
            onOpenSession={(sessionId) => void conversation.openSession(sessionId)}
            onNewSession={() => setNewChatOpen(true)}
            onArchiveSession={(sessionId) => conversation.archiveSession(sessionId)}
            onUnarchiveSession={(sessionId) => conversation.unarchiveSession(sessionId)}
            onDeleteSession={(sessionId) => conversation.deleteSession(sessionId)}
            onDeleteAllArchived={conversation.deleteAllArchived}
            onSessionActions={sessionActions.length > 0 ? openSessionSheet : undefined}
            onBeforeNavigate={() => {
              blurComposer();
              setComposerLocked(true);
              setTimeout(() => setComposerLocked(false), 1500);
            }}
          />
        ) : null}
        {hasRail ? (
          <GoRail
            petState={petState}
            onMenu={onMenu}
            onNewSession={() => {
              blurComposer();
              setNewChatOpen(true);
            }}
            onSearch={onMenu}
            onWork={() => {
              leaveComposerForNavigation({
                blur: blurComposer,
                dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
                navigate: () => router.push("/work"),
              });
            }}
            onSettings={() => {
              leaveComposerForNavigation({
                blur: blurComposer,
                dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
                navigate: () => router.push("/settings"),
              });
            }}
            onPlugins={() => {
              leaveComposerForNavigation({
                blur: blurComposer,
                dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
                navigate: () => router.push("/plugins"),
              });
            }}
          />
        ) : null}

        <Reanimated.View
          style={[
            styles.body,
            {
              paddingLeft: !inShell ? insets.left : 0,
              paddingRight: insets.right,
              overflow: "hidden",
            },
            bodyDepthStyle,
          ]}
        >
          <View style={[styles.bodyInner, { maxWidth: bodyMax }]}>
            {/*
              顶栏分两组，视觉重心居中：
              左组（身份/导航）= ≡ + 会话 chip；右组（操作）= 模型 chip + 工作区面板。
              顶栏用不透明 card：Android 上半透明 glass + elevation 会在圆键外圈打出浑浊灰框。
            */}
            <View style={[styles.topbar, { paddingTop: insets.top + space(1.5) }]}>
              <View style={styles.topLeft}>
                {!hasRail ? (
                  <PressableScale
                    style={[
                      styles.fab,
                      { backgroundColor: th.card, borderColor: th.hairlineStrong },
                      th.elevation.card,
                    ]}
                    onPress={onMenu}
                    accessibilityRole="button"
                    accessibilityLabel={
                      layout.menuAction === "collapse"
                        ? pick("折叠对话列表", "Collapse chats")
                        : pick("打开对话列表", "Open chats")
                    }
                  >
                    <Icon name="menu" size={17} color={th.ink} />
                  </PressableScale>
                ) : null}

                <PressableScale
                  ref={sessionChipRef}
                  onPress={() => {
                    haptic("tick");
                    sessionChipRef.current?.measureInWindow((x, y, width, height) => {
                      setPermissionMenu({ x, y, width, height });
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={pick(
                    `会话与权限模式：${permissionLabel}`,
                    `Session & permissions: ${permissionLabel}`,
                  )}
                  containerStyle={styles.chipFlex}
                  style={[
                    styles.chip,
                    { backgroundColor: th.card, borderColor: th.hairlineStrong },
                    th.elevation.card,
                  ]}
                >
                  <View style={styles.chipBody}>
                    <Text style={[styles.chipTitle, { color: th.ink }]} numberOfLines={1}>
                      {activeTitle}
                    </Text>
                    <View style={styles.chipStatus}>
                      <Dot
                        size={6}
                        color={permissionMode === "yolo" ? th.amber : th.brand}
                        ring={permissionMode === "yolo" ? th.amber : th.brand}
                      />
                      <Text style={[styles.chipSub, { color: th.inkSub }]} numberOfLines={1}>
                        {permissionLabel}
                      </Text>
                    </View>
                  </View>
                  <Icon name="chevron-down" size={13} color={th.inkFaint} />
                </PressableScale>
              </View>

              <View style={styles.topRight}>
                <PressableScale
                  onPress={() => {
                    haptic("tick");
                    setModelPickerOpen(true);
                    void providerCatalog.reload();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={pick(
                    `选择模型：${modelLabel}${effortLabel ? `，思考强度${effortLabel}` : ""}`,
                    `Select model: ${modelLabel}${effortLabel ? `, thinking effort ${effortLabel}` : ""}`,
                  )}
                  containerStyle={styles.modelChipFlex}
                  style={[
                    styles.modelChip,
                    { backgroundColor: th.card, borderColor: th.hairlineStrong },
                    th.elevation.card,
                  ]}
                >
                  <View style={[styles.effortMeter, { backgroundColor: th.hairlineStrong }]}>
                    <View
                      style={[
                        styles.effortMeterFill,
                        { height: `${Math.round(effortProgress * 100)}%`, backgroundColor: th.ok },
                      ]}
                    />
                  </View>
                  <Text style={[styles.modelText, { color: th.ink }]} numberOfLines={1}>
                    {modelLabel}
                  </Text>
                  <Icon name="chevron-down" size={12} color={th.inkFaint} />
                </PressableScale>

                <PressableScale
                  style={[
                    styles.fab,
                    { backgroundColor: th.card, borderColor: th.hairlineStrong },
                    th.elevation.card,
                  ]}
                  accessibilityLabel={pick("打开工作区面板", "Open workspace panel")}
                  onPress={() => openPanelSide(true)}
                >
                  <Icon name="folder" size={17} color={th.ink} />
                </PressableScale>

              </View>
            </View>

            {/* 状态横幅：内核连接/重启/失败常驻显示（此前只发 4 秒 hint）。 */}
            {/* 配置缺失 →「去设置」直达 Provider 页；链路失败 →「重试」。 */}
            {conversation.statusKind !== "ok" ? (
              <PressableScale
                scaleTo={0.985}
                onPress={
                  setupIssue
                    ? () => {
                        leaveComposerForNavigation({
                          blur: blurComposer,
                          dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
                          navigate: () => router.push("/settings/provider"),
                        });
                      }
                    : conversation.statusKind === "error" && conversation.statusRetryable
                      ? () => void conversation.retryStatus()
                      : undefined
                }
                style={[
                  styles.statusBanner,
                  { backgroundColor: th.glass, borderColor: th.glassBorder },
                  th.elevation.card,
                ]}
                accessibilityRole={setupIssue || conversation.statusRetryable ? "button" : "text"}
                accessibilityLabel={pick(
                  `内核状态：${conversation.status}`,
                  `Kernel status: ${conversation.status}`,
                )}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        conversation.statusKind === "error"
                          ? th.red
                          : conversation.statusKind === "busy"
                            ? th.brand
                            : th.inkFaint,
                    },
                  ]}
                />
                <Text style={[styles.statusBannerText, { color: th.inkSub }]} numberOfLines={2}>
                  {setupIssue
                    ? pick("还没有可用的模型服务", "No model provider configured yet")
                    : conversation.status}
                </Text>
                {setupIssue ? (
                  <Text style={[styles.statusRetry, { color: th.brand }]}>
                    {pick("去设置", "Configure")}
                  </Text>
                ) : conversation.statusKind === "error" && conversation.statusRetryable ? (
                  <Text style={[styles.statusRetry, { color: th.brand }]}>
                    {pick("重试", "Retry")}
                  </Text>
                ) : null}
              </PressableScale>
            ) : null}

            {/* 正文区：有消息就是会话流；没有消息才是空态说明（会话即首页）。 */}
            <GestureDetector gesture={sideGesture}>
            <Reanimated.View
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
                  onOpenSession={stableOpenSession}
                  plugins={plugins.enabled}
                  onPluginAction={stablePluginAction}
                  bottomInset={
                    (layout.landscapeCompact && keyboardHeight > 0
                      ? 0
                      : petDockHeight + (annotations.length > 0 ? space(10) : 0)) + keyboardHeight
                  }
                  onMessageLongPress={stableOpenMessagePopup}
                  draftAnnotationCounts={draftAnnotationCounts}
                  onAnnotationMarkPress={stableAnnotationMarkPress}
                  scrollToMessage={scrollToMessage}
                  showReasoning={conversationPrefs.showReasoning}
                  showTools={conversationPrefs.showTools}
                  autoCollapseThinking={conversationPrefs.autoCollapseReasoning}
                  autoCollapseTools={conversationPrefs.autoCollapseTools}
                  onRetryTurn={stableRetryTurn}
                  onAtBottomChange={setAtBottom}
                  jumpSignal={jumpSignal}
                />
              ) : (
                // 空态：纸上鸟圆章 + 标题/副标 + 三枚起手式胶囊（点按即填入输入框）。
                <AppearIn
                  distance={10}
                  style={[styles.stageText, layout.landscapeCompact && styles.stageTextLandscape]}
                >
                  {!(layout.landscapeCompact && keyboardHeight > 0) ? (
                    <View
                      style={[
                        styles.emptyMedallion,
                        layout.landscapeCompact ? { width: 64, height: 64, borderRadius: 32 } : null,
                        { backgroundColor: th.card, borderColor: th.hairlineStrong },
                        th.elevation.card,
                      ]}
                    >
                      <View style={[styles.emptyHalo, { backgroundColor: th.brandSoft }]} />
                      <PetView
                        state={PET_STATE.idle}
                        targetSize={layout.landscapeCompact ? 48 : 64}
                        animated={screenFocused && !drawerOpen && !workspacePanelOpen}
                        crop={0.8}
                      />
                    </View>
                  ) : null}
                  <Text style={[styles.stageTitle, { color: th.ink }]}>
                    {pick("开始一段对话", "Start a conversation")}
                  </Text>
                  <Text style={[styles.stageSubtitle, { color: th.inkSub }]}>
                    {pick(
                      "随时提问、审阅代码或交办后台任务",
                      "Ask questions, review code, or delegate background tasks",
                    )}
                  </Text>
                  {!layout.landscapeCompact ? (
                    <View style={styles.starterRow}>
                      {[
                        {
                          icon: "folder" as IconName,
                          label: pick("梳理项目结构", "Map project structure"),
                          prompt: pick(
                            "帮我梳理一下当前项目的目录结构与核心模块。",
                            "Walk me through the directory structure and core modules of this project.",
                          ),
                        },
                        {
                          icon: "wrench" as IconName,
                          label: pick("排查问题与报错", "Diagnose issues & errors"),
                          prompt: pick(
                            "帮我检查并定位当前工作区里的异常或潜在问题。",
                            "Inspect this workspace and locate any errors or potential issues.",
                          ),
                        },
                        {
                          icon: "checklist" as IconName,
                          label: pick("制定实现计划", "Draft an action plan"),
                          prompt: pick(
                            "先帮我拆解一份清晰的分步实现计划。",
                            "Break this down into a clear step-by-step implementation plan first.",
                          ),
                        },
                      ].map((starter) => (
                        <PressableScale
                          key={starter.label}
                          scaleTo={0.96}
                          onPress={() => {
                            haptic("tick");
                            setDraft(starter.prompt);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={starter.label}
                          style={[
                            styles.starterChip,
                            { backgroundColor: th.card, borderColor: th.hairlineStrong },
                            th.elevation.card,
                          ]}
                        >
                          <View style={[styles.starterIconWrap, { backgroundColor: th.brandSoft }]}>
                            <Icon name={starter.icon} size={12} color={th.brand} />
                          </View>
                          <Text style={[styles.starterChipText, { color: th.ink }]}>
                            {starter.label}
                          </Text>
                        </PressableScale>
                      ))}
                    </View>
                  ) : null}
                </AppearIn>
              )}

              {/* 底部渐隐：使用与底色同 RGB 的零透明起点（bgFadeStart），消除 Android
                  LinearGradient "transparent"(=rgba(0,0,0,0)) 带来的灰褐色断层带。 */}
              {/* 底部渐隐：键盘在横屏窄高下弹出时隐藏，避免挤占本来就紧张的消息可视区。 */}
              {!(layout.landscapeCompact && keyboardHeight > 0) ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.bottomFade,
                  {
                    height: petDockHeight + space(2),
                    transform: [{ translateY: keyboardLift }],
                    opacity: keyboard.offset.interpolate({
                      inputRange: [0, 120],
                      outputRange: [1, 0],
                      extrapolate: "clamp",
                    }),
                  },
                ]}
              >
                <LinearGradient
                  colors={[th.bgFadeStart, th.bgGradient[1]]}
                  locations={[0, 0.88]}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
              ) : null}

              {/* 宠物 + 快捷动作浮在会话流底部：不参与列表布局，也不改变 COMPOSE。
                  空态时不渲染（中央已有品牌大鸟）；横屏弹键盘时自动退让保住消息可读区。 */}
              {conversation.rows.length > 0 && !(layout.landscapeCompact && keyboardHeight > 0) ? (
              <Animated.View
                style={[styles.petOverlay, { transform: [{ translateY: keyboardLift }] }]}
                pointerEvents="box-none"
              >
                <View style={styles.actionsOverlay} pointerEvents="auto">
                  <CapsuleStack items={capsuleItems} onItem={applyCatalogItem} />
                </View>
                {annotations.length > 0 ? (
                  <Reanimated.View style={petTranslateStyle}>
                    <Pressable
                      onPress={() => {
                        setAnnotationManagerFilter(null);
                        setAnnotationManagerOpen(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={pick(`注释 ${annotations.length}`, `${annotations.length} annotations`)}
                      style={({ pressed }) => [
                        styles.annotationBadge,
                        { backgroundColor: th.card, borderColor: th.hairline },
                        th.elevation.card,
                        pressed ? { opacity: 0.8 } : null,
                      ]}
                    >
                      <Icon name="quote" size={12} color={th.brand} />
                      <Text style={[styles.annotationBadgeText, { color: th.brand }]}>
                        {pick(`注释 ${annotations.length}`, `Notes ${annotations.length}`)}
                      </Text>
                    </Pressable>
                  </Reanimated.View>
                ) : null}
                <Reanimated.View
                  pointerEvents="box-none"
                  style={[
                    styles.petDock,
                    { height: petDockHeight },
                    petTranslateStyle,
                  ]}
                >
                  <GestureDetector gesture={petDragGesture}>
                    <View
                      style={[styles.petTouch, { width: petBox, height: petDockHeight }]}
                    >
                      <Pressable
                        onPress={handlePetTap}
                        accessibilityLabel={pick("桌宠", "Pet mascot")}
                        style={({ pressed }) => ({
                          width: petBox,
                          height: petDockHeight,
                          alignItems: "center",
                          justifyContent: "flex-start",
                          opacity: pressed ? 0.86 : 1,
                        })}
                      >
                        <View pointerEvents="none">
                          <PetView
                            state={petState}
                            targetSize={petTarget}
                            // 侧栏展开、二级页覆盖或切后台时停帧，彻底零 GPU/CPU 空转。
                            animated={screenFocused && !drawerOpen && !workspacePanelOpen}
                          />
                        </View>
                      </Pressable>
                    </View>
                  </GestureDetector>
                </Reanimated.View>
              </Animated.View>
              ) : null}
            </Reanimated.View>
            </GestureDetector>

            {hint ? (
              <Animated.View
                style={[
                  styles.hint,
                  {
                    backgroundColor: th.panel,
                    borderColor: th.hairline,
                    transform: [{ translateY: keyboardLift }],
                  },
                ]}
                accessibilityRole="alert"
              >
                <Text style={[styles.hintText, { color: th.inkSub }]}>{hint}</Text>
              </Animated.View>
            ) : null}

            {/* 编辑重发条：草稿现在是「最后一条消息的改写文本」，发送即替换原文。 */}
            {editTarget ? (
              <Animated.View
                style={[
                  styles.editStrip,
                  {
                    backgroundColor: th.card,
                    borderColor: th.hairline,
                    transform: [{ translateY: keyboardLift }],
                  },
                ]}
              >
                <Text style={[styles.editStripText, { color: th.brand }]} numberOfLines={1}>
                  {pick(
                    "正在编辑重发最后一条消息，发送后替换原文",
                    "Editing your last message — sending will replace it",
                  )}
                </Text>
                <Pressable
                  accessibilityLabel={pick("取消编辑", "Cancel edit")}
                  hitSlop={10}
                  onPress={() => {
                    haptic("tick");
                    setEditTarget(null);
                    setDraft("");
                  }}
                  style={({ pressed }) => (pressed ? { opacity: 0.5 } : null)}
                >
                  <Icon name="x" size={13} color={th.inkSub} />
                </Pressable>
              </Animated.View>
            ) : null}

            {/* 输入栏遮罩裙边：随键盘同步上移，封住圆角输入栏下方与键盘顶沿之间的 8dp 缝隙，
                防止底层消息列表从输入栏圆角外侧或底缝漏出半截气泡。 */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.composerSkirt,
                {
                  height: insets.bottom + space(2) + 34,
                  backgroundColor: th.bgGradient[1],
                  transform: [{ translateY: keyboardLift }],
                },
              ]}
            />

            {/* 输入栏：纯 GPU translateY 随键盘上浮（marginBottom 保持静态，消除每帧 Yoga 重排）。 */}
            <Animated.View
              style={[
                styles.composer,
                {
                  backgroundColor: th.card,
                  borderColor: th.hairlineStrong,
                  marginBottom: insets.bottom + space(2),
                  transform: [{ translateY: keyboardLift }],
                },
                th.elevation.float,
              ]}
            >
              <PressableScale
                ref={plusRef}
                onPress={() => {
                  haptic("tap");
                  openPlusMenu();
                }}
                style={[
                  styles.plus,
                  { backgroundColor: th.surfaceSoft, borderColor: th.hairline },
                ]}
                accessibilityRole="button"
                accessibilityLabel={pick("选择插件", "Tools & plugins")}
              >
                <Icon name="plus" size={15} color={th.ink} />
              </PressableScale>
              <ComposerAttachments
                attachments={attachments}
                onRemove={(id) => {
                  haptic("tick");
                  setAttachments((current) => current.filter((attachment) => attachment.id !== id));
                }}
              />
              <ComposerTokens
                tokens={tokens}
                onRemove={(id) => {
                  haptic("tick");
                  const removed = tokens.find((token) => token.id === id);
                  if (removed?.kind === "mode") setPlanEnabled(false);
                  setTokens((current) => current.filter((token) => token.id !== id));
                }}
              />
              <TextInput
                ref={composerInputRef}
                value={draft}
                onChangeText={setDraft}
                placeholder={
                  tokens.length > 0
                    ? pick("继续输入…", "Keep typing…")
                    : pick("给 NIBI 发消息…", "Message NIBI…")
                }
                placeholderTextColor={th.inkFaint}
                style={[styles.composerInput, { color: th.ink }]}
                returnKeyType="send"
                editable={
                  conversation.ready && !composerLocked && !drawerOpen && !workspacePanelOpen
                }
                onFocus={() => {
                  composerFocusedRef.current = true;
                  setComposerFocused(true);
                }}
                onBlur={() => {
                  composerFocusedRef.current = false;
                  setComposerFocused(false);
                }}
                onSubmitEditing={submitDraft}
              />
              {/* 发送 ↔ 停止是同一个按钮：图标交叉淡化/缩放，不做整颗按钮替换。
                  发送 RPC 在途（turn 还没 running）时也不要把按钮先压暗——那是
                  「点发送后按钮闪一下」的来源。 */}
              <PressableScale
                accessibilityLabel={stopping ? pick("停止生成", "Stop generating") : pick("发送", "Send")}
                disabled={!stopping && !canSend}
                onPress={() => {
                  if (stopping) {
                    haptic("reject");
                    void conversation.stopTurn().then((error) => {
                      if (error) showHint(error);
                    });
                  } else {
                    haptic("tap");
                    submitDraft();
                  }
                }}
                style={[
                  styles.send,
                  {
                    backgroundColor: th.brand,
                    opacity: stopping || pendingSend || conversation.sending || canSend ? 1 : 0.4,
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.sendIcon,
                    {
                      opacity: sendMorph.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0],
                      }),
                      transform: [
                        {
                          scale: sendMorph.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 0.72],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Icon name="arrow-up" size={16} color={th.brandFg} />
                </Animated.View>
                <Animated.View
                  style={[
                    styles.sendIcon,
                    {
                      opacity: sendMorph,
                      transform: [
                        {
                          scale: sendMorph.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.72, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Icon name="stop" size={15} color={th.brandFg} />
                </Animated.View>
              </PressableScale>
              {/* 聚焦光环：只做透明度/缩放，不引发布局（边框色切换会硬跳）。 */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.composerFocusRing,
                  {
                    borderColor: th.brand,
                    opacity: focusRing,
                    transform: [
                      {
                        scale: focusRing.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.985, 1],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </Animated.View>
          </View>
        </Reanimated.View>
      </BlurTargetView>

      {/* 左右两栏共用的一层玻璃遮罩（模糊/压暗/点按与横滑关闭热区）。 */}
      <SideBackdrop
        progress={side}
        dragging={sideDragging}
        sideMode={sideMode}
        drawerW={drawerW}
        panelW={panelW}
        open={drawerOpen || workspacePanelOpen}
        onClose={closeSide}
        onSwipeClose={closeSideFromSwipe}
        blurTarget={blurTargetRef}
      />

      {/* 非常驻侧栏（包括手机与 840–919dp 中宽平板 GoRail 档）都挂载 overlay 抽屉，彻底消除 840–919dp 死胡同。 */}
      {!hasSidebar ? (
        <GoDrawer
          workspaceRoot={workspaceRoot()}
          open={drawerOpen}
          progress={side}
          dragging={sideDragging}
          onClose={() => closeDrawerSide(true)}
          onSwipeClose={() => closeDrawerSide(false)}
          petState={petState}
          sessions={conversation.sessions}
          archivedSessions={conversation.archivedSessions}
          activeSessionId={conversation.activeSessionId}
          onOpenSession={(sessionId) => void conversation.openSession(sessionId)}
          onNewSession={() => setNewChatOpen(true)}
          onArchiveSession={(sessionId) => conversation.archiveSession(sessionId)}
          onUnarchiveSession={(sessionId) => conversation.unarchiveSession(sessionId)}
          onDeleteSession={(sessionId) => conversation.deleteSession(sessionId)}
          onDeleteAllArchived={conversation.deleteAllArchived}
          onSessionActions={sessionActions.length > 0 ? openSessionSheet : undefined}
          onBeforeNavigate={() => {
            blurComposer();
            setComposerLocked(true);
            setTimeout(() => setComposerLocked(false), 1500);
          }}
        />
      ) : null}

      <WorkspacePanel
        visible={workspacePanelOpen}
        progress={side}
        dragging={sideDragging}
        onClose={() => closePanelSide(true)}
        onSwipeClose={() => closePanelSide(false)}
        workspacePath={activeWorkspacePath}
        subagents={sessionTools.subagents.map(
          (entry): WorkspaceSubagent => ({
            key: entry.key,
            name: entry.name,
            status: entry.status,
            ...(entry.summary ? { summary: entry.summary } : {}),
            ...(entry.childSessionId ? { childSessionId: entry.childSessionId } : {}),
          }),
        )}
      />

      {/* 「回到底部」浮钮：弹簧入场/退场 + GPU 随键盘上移 + 按压缩放与微触感。 */}
      <Animated.View
        pointerEvents={showJump ? "box-none" : "none"}
        style={[
          styles.jumpWrap,
          {
            right: insets.right + space(3.5),
            bottom: insets.bottom + space(2) + 60,
            transform: [{ translateY: keyboardLift }],
          },
        ]}
      >
        <Animated.View
          style={{
            opacity: jumpAnim,
            transform: [
              {
                scale: jumpAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.78, 1],
                }),
              },
              {
                translateY: jumpAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          }}
        >
          <PressableScale
            scaleTo={0.92}
            onPress={() => {
              haptic("tick");
              setJumpSignal((value) => value + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel={pick("跳到最新消息", "Jump to latest")}
            style={[
              styles.jumpButton,
              {
                backgroundColor: th.card,
                borderColor: th.hairlineStrong,
                ...th.elevation.menu,
              },
            ]}
          >
            <Icon name="chevron-down" size={17} color={th.ink} />
          </PressableScale>
        </Animated.View>
      </Animated.View>

      <SideStatus
        plugins={plugins.enabled}
        usage={conversation.contextUsage}
        slotData={conversation.pluginSlotData}
        session={sessionTools}
        bottom={statusBottom}
        paused={drawerOpen || workspacePanelOpen}
      />

      <PluginPopup
        visible={popup?.kind === "plus"}
        anchor={popup?.kind === "plus" ? popup.anchor : null}
        onClose={() => setPopup(null)}
        width={300}
      >
        <ScrollView
          style={{ maxHeight: Math.min(430, Math.max(180, Math.round(height * 0.6))) }}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {PLUS_GROUPS.map(({ group, title, titleEn }) => {
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
                  { borderColor: th.hairline, backgroundColor: pressed ? th.hover : "transparent", opacity: pressed ? 0.92 : 1 },
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
                <Text style={[styles.plusTitle, { color: th.ink }]}>
                  {pick(title, titleEn)}
                </Text>
                {(split ? nibi : items).map(row)}
                {split && plugin.length > 0 ? (
                  <>
                    <Text style={[styles.plusSubtitle, { color: th.inkFaint }]}>
                      {group === "skill"
                        ? pick("插件技能", "Plugin skills")
                        : pick("用户插件", "User plugins")}
                    </Text>
                    {plugin.map(row)}
                  </>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </PluginPopup>

      <ModelPickerSheet
        visible={modelPickerOpen}
        providers={providerCatalog.state.providers}
        selection={modelChoice}
        onSelect={setModelChoice}
        onClose={() => setModelPickerOpen(false)}
        onManage={() => {
          setModelPickerOpen(false);
          router.push("/settings/provider");
        }}
      />

      <ConfirmDialog
        visible={confirmFullAccess}
        title={pick("切换到完全访问", "Switch to Full Access")}
        message={pick(
          "完全访问会减少确认次数，模型可以在不逐次询问的情况下修改文件和执行命令。\n\n只在你信任当前任务和模型时使用。",
          "Full access reduces confirmation prompts, allowing the model to edit files and run commands without asking each time.\n\nUse only when you trust the current task and model.",
        )}
        confirmLabel={pick("切换到完全访问", "Enable Full Access")}
        danger
        onCancel={() => setConfirmFullAccess(false)}
        onConfirm={() => {
          setConfirmFullAccess(false);
          setPermissionMode("yolo");
        }}
      />

      {/* 新建对话归属（底部 sheet）：独立会话 / 各项目 / 就地新建项目 / 管理入口。
          FAB 与抽屉「新对话」都走这一份交互（此前抽屉直接静默新建）。 */}
      <NewChatSheet
        visible={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onPick={(projectId) => {
          setDraft("");
          void conversation.newSession(projectId);
        }}
        onCreateProject={async (name, folder) => {
          await createProject(name, folder);
          await setActiveProject(folder);
          setDraft("");
          await conversation.newSession(folder);
        }}
        onManage={() => {
          leaveComposerForNavigation({
            blur: blurComposer,
            dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
            navigate: () => router.push("/settings/projects"),
          });
        }}
        projects={projects.projects}
        activeProjectId={projects.activeProjectId}
      />

      <PluginPopup
        visible={permissionMenu !== null}
        anchor={permissionMenu}
        onClose={() => setPermissionMenu(null)}
        width={286}
      >
        <Text style={[styles.popupTitle, { color: th.ink }]}>
          {pick("会话权限", "Session permissions")}
        </Text>
        <Pressable
          onPress={() => {
            setPlanMode(!planEnabled);
            setPermissionMenu(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            planEnabled
              ? pick("关闭计划模式", "Turn off Plan mode")
              : pick("打开计划模式", "Turn on Plan mode")
          }
          style={({ pressed }) => [
            styles.menuRow,
            { borderColor: th.hairline, backgroundColor: pressed ? th.hover : "transparent", opacity: pressed ? 0.92 : 1 },
          ]}
        >
          <View
            style={[
              styles.toolIconSmall,
              { backgroundColor: planEnabled ? th.brandSoft : th.panel },
            ]}
          >
            <Icon name="doc" size={15} color={planEnabled ? th.brand : th.inkSub} />
          </View>
          <View style={styles.menuText}>
            <Text style={[styles.menuLabel, { color: th.ink }]}>
              {pick("计划模式", "Plan mode")}
            </Text>
            <Text style={[styles.menuDetail, { color: th.inkFaint }]}>
              {pick("编辑前先出计划。", "Draft a plan before editing.")}
            </Text>
          </View>
          <Icon
            name={planEnabled ? "check" : "chevron-right"}
            size={13}
            color={planEnabled ? th.brand : th.inkGhost}
          />
        </Pressable>
        <View style={[styles.menuDivider, { backgroundColor: th.hairline }]} />
        {PERMISSION_OPTIONS.map((option) => {
          const active = permissionMode === option.id;
          const optionLabel = pick(option.labelZh, option.labelEn);
          const optionDetail = pick(option.detailZh, option.detailEn);
          return (
            <Pressable
              key={option.id}
              onPress={() => choosePermission(option.id)}
              accessibilityRole="button"
              accessibilityLabel={`${optionLabel}: ${optionDetail}`}
              style={({ pressed }) => [
                styles.menuRow,
                { borderColor: th.hairline, backgroundColor: pressed ? th.hover : "transparent", opacity: pressed ? 0.92 : 1 },
              ]}
            >
              <View
                style={[
                  styles.toolIconSmall,
                  {
                    backgroundColor:
                      option.id === "yolo"
                        ? th.amberSoft
                        : active
                          ? th.brandSoft
                          : th.panel,
                  },
                ]}
              >
                <Icon
                  name={option.icon}
                  size={15}
                  color={
                    option.id === "yolo" ? th.amber : active ? th.brand : th.inkSub
                  }
                />
              </View>
              <View style={styles.menuText}>
                <Text style={[styles.menuLabel, { color: th.ink }]}>{optionLabel}</Text>
                <Text style={[styles.menuDetail, { color: th.inkFaint }]}>{optionDetail}</Text>
              </View>
              {active ? <Icon name="check" size={13} color={th.brand} /> : null}
            </Pressable>
          );
        })}
      </PluginPopup>

      <PluginPopup
        visible={popup?.kind === "message"}
        anchor={popup?.kind === "message" ? popup.anchor : null}
        onClose={() => setPopup(null)}
        width={264}
      >
        {/* 顶部原生核心动作横向工具条：复制 / 注释 / 编辑重发永远常驻首排，不被插件数量挤掉。 */}
        <View style={styles.msgCoreBar}>
          <Pressable
            onPress={() => {
              if (popup?.kind !== "message") return;
              const text = popup.message;
              setPopup(null);
              void Clipboard.setStringAsync(text)
                .then((saved) =>
                  showHint(
                    saved
                      ? pick("已复制", "Copied")
                      : pick("复制失败，请手动选择文本", "Copy failed — select text manually"),
                  ),
                )
                .catch(() =>
                  showHint(pick("复制失败，请手动选择文本", "Copy failed — select text manually")),
                );
            }}
            accessibilityRole="button"
            accessibilityLabel={pick("复制消息", "Copy message")}
            style={({ pressed }) => [
              styles.msgCoreTile,
              {
                backgroundColor: pressed ? th.hover : th.surfaceSoft,
                borderColor: th.hairline,
              },
            ]}
          >
            <Icon name="copy" size={16} color={th.inkSub} />
            <Text style={[styles.msgCoreLabel, { color: th.ink }]}>{pick("复制", "Copy")}</Text>
          </Pressable>

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
            accessibilityLabel={pick("添加注释", "Add annotation")}
            style={({ pressed }) => [
              styles.msgCoreTile,
              {
                backgroundColor: pressed ? th.hover : th.brandSoft,
                borderColor: th.hairline,
              },
            ]}
          >
            <Icon name="quote" size={16} color={th.brand} />
            <Text style={[styles.msgCoreLabel, { color: th.brand }]}>
              {(() => {
                const count =
                  popup?.kind === "message"
                    ? (draftAnnotationCounts[popup.messageKey] ?? 0)
                    : 0;
                return count > 0
                  ? pick(`注释 (${count})`, `Annotate (${count})`)
                  : pick("注释", "Annotate");
              })()}
            </Text>
          </Pressable>

          {/* 编辑重发：只出现在内核判定可编辑（最新一条 realUser 输入）的用户消息上。 */}
          {popup?.kind === "message" &&
          popup.messageRole === "user" &&
          lastEditableUserRow?.key === popup.messageKey ? (
            <Pressable
              onPress={() => {
                if (popup?.kind !== "message") return;
                const row = lastEditableUserRow;
                if (!row || typeof row.rowId !== "number" || !row.entityId) return;
                setPopup(null);
                if (
                  (row.conversationQuotes?.length ?? 0) > 0 ||
                  (row.attachments?.length ?? 0) > 0 ||
                  (row.pluginReferences?.length ?? 0) > 0
                ) {
                  showHint(
                    pick(
                      "带附件或引用的消息暂不支持编辑重发",
                      "Messages with attachments or quotes can't be edited & resent yet",
                    ),
                  );
                  return;
                }
                setEditTarget({ rowId: row.rowId, entityId: row.entityId });
                setDraft(row.text);
              }}
              accessibilityRole="button"
              accessibilityLabel={pick("编辑重发", "Edit & resend")}
              style={({ pressed }) => [
                styles.msgCoreTile,
                {
                  backgroundColor: pressed ? th.hover : th.surfaceSoft,
                  borderColor: th.hairline,
                },
              ]}
            >
              <Icon name="pen" size={16} color={th.inkSub} />
              <Text style={[styles.msgCoreLabel, { color: th.ink }]}>
                {pick("编辑重发", "Edit")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {messageMenuItems.length > 0 ? (
          <>
            <View style={[styles.menuDivider, { backgroundColor: th.hairline }]} />
            <ScrollView
              style={styles.msgPluginScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              {messageMenuPartition.direct.map((item) => {
                const sourceName = pluginSourceLabel(item, pluginNameMap);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => applyMessageCatalogItem(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}（${sourceName}）`}
                    style={({ pressed }) => [
                      styles.menuRow,
                      {
                        borderColor: th.hairline,
                        backgroundColor: pressed ? th.hover : "transparent",
                        opacity: pressed ? 0.92 : 1,
                      },
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
                      <Text style={[styles.menuLabel, { color: th.ink }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                    </View>
                    <Text
                      style={[styles.msgSourceLabel, { color: th.inkFaint }]}
                      numberOfLines={1}
                    >
                      {sourceName}
                    </Text>
                  </Pressable>
                );
              })}

              {messageMenuPartition.hasOverflow ? (
                <>
                  <View style={[styles.menuDivider, { backgroundColor: th.hairline }]} />
                  <Pressable
                    onPress={() => {
                      if (popup?.kind !== "message") return;
                      const captured = {
                        messageKey: popup.messageKey,
                        message: popup.message,
                        messageRole: popup.messageRole,
                        ...(popup.messageId ? { messageId: popup.messageId } : {}),
                      };
                      setPopup(null);
                      setMessageMoreTarget(captured);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={pick(
                      `更多插件动作，共 ${messageMenuItems.length} 项`,
                      `More plugin actions (${messageMenuItems.length})`,
                    )}
                    style={({ pressed }) => [
                      styles.menuRow,
                      {
                        borderColor: th.hairline,
                        backgroundColor: pressed ? th.hover : "transparent",
                        opacity: pressed ? 0.92 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.toolIconSmall, { backgroundColor: th.surfaceSoft }]}>
                      <Icon name="puzzle" size={14} color={th.inkSub} />
                    </View>
                    <View style={styles.menuText}>
                      <Text style={[styles.menuLabel, { color: th.ink }]}>
                        {pick("更多插件动作", "More plugin actions")}
                      </Text>
                    </View>
                    <View style={[styles.msgMoreBadge, { backgroundColor: th.surfaceSoft }]}>
                      <Text style={[styles.msgMoreBadgeText, { color: th.inkSub }]}>
                        {pick(`共 ${messageMenuItems.length} 项`, `${messageMenuItems.length}`)}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={13} color={th.inkFaint} />
                  </Pressable>
                </>
              ) : null}
            </ScrollView>
          </>
        ) : null}
      </PluginPopup>

      <MessageActionsSheet
        visible={messageMoreTarget !== null}
        items={messageMenuItems}
        pluginNames={pluginNameMap}
        onPick={(item) => {
          if (messageMoreTarget) applyMessageCatalogItem(item, messageMoreTarget);
        }}
        onManage={() => {
          setMessageMoreTarget(null);
          setComposerLocked(true);
          setTimeout(() => setComposerLocked(false), 1500);
          leaveComposerForNavigation({
            blur: blurComposer,
            dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
            navigate: () => router.push("/settings/composer"),
          });
        }}
        onClose={() => setMessageMoreTarget(null)}
      />

      <AnnotationComposer
        visible={annotationEditor !== null}
        fullText={annotationEditor?.fullText ?? ""}
        initialExcerpt={annotationEditor?.initialExcerpt}
        initialComment={annotationEditor?.comment}
        initialSelectionStart={annotationEditor?.initialSelectionStart}
        initialSelectionEnd={annotationEditor?.initialSelectionEnd}
        instruction={annotationEditor?.instruction}
        instructionLabel={annotationEditor?.instructionLabel}
        editing={annotationEditor?.editingId !== undefined}
        editingId={annotationEditor?.editingId}
        existingAnnotations={annotations}
        transformCount={tokens.filter((t) => t.kind === "message" && Boolean(t.messageText)).length}
        transformChars={tokens
          .filter((t) => t.kind === "message" && Boolean(t.messageText))
          .reduce((sum, t) => sum + (t.messageText?.length ?? 0), 0)}
        onCancel={() => {
          const reopen = Boolean(annotationEditor?.returnToManager);
          setAnnotationEditor(null);
          if (reopen) setAnnotationManagerOpen(true);
        }}
        onSubmit={saveAnnotation}
      />

      <AnnotationManager
        visible={annotationManagerOpen}
        annotations={annotations}
        filterMessageKey={annotationManagerFilter?.messageKey ?? null}
        onClearFilter={() => setAnnotationManagerFilter(null)}
        onAddForFilteredMessage={
          annotationManagerFilter
            ? () => {
                const target = annotationManagerFilter;
                setAnnotationManagerOpen(false);
                setAnnotationEditor({
                  messageKey: target.messageKey,
                  ...(target.messageId ? { messageId: target.messageId } : {}),
                  messageRole: target.messageRole,
                  fullText: target.messageText,
                  initialExcerpt: target.messageText,
                  comment: "",
                  returnToManager: true,
                });
              }
            : undefined
        }
        onClose={() => {
          setAnnotationManagerOpen(false);
          setAnnotationManagerFilter(null);
        }}
        onEdit={editAnnotation}
        onDelete={deleteAnnotation}
        onClearAll={clearAllAnnotations}
        onReorder={reorderAnnotationItem}
        onJumpToMessage={jumpToAnnotatedMessage}
      />

      <PluginActionSheet
        visible={sessionSheet !== null}
        title={sessionSheetShown?.title ?? ""}
        items={sessionSheetShown?.items ?? []}
        onClose={() => setSessionSheet(null)}
      />
    </View>
  );
}

/** 顶栏控件统一高度（圆钮/会话 chip/模型 chip 同高）。 */
const TOPBAR_H = 42;

const styles = StyleSheet.create({
  root: { flex: 1 },
  shell: { flex: 1, flexDirection: "row" },
  body: { flex: 1, alignItems: "center" },
  bodyInner: { flex: 1, width: "100%", paddingHorizontal: space(3.5) },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingBottom: space(2),
  },
  topLeft: { flexDirection: "row", alignItems: "center", gap: space(2), flex: 1, minWidth: 0 },
  // 不要 marginLeft:"auto"：它会把剩余宽度全吃掉，左组的 flex:1 拿不到空间，
  // 会话 chip 只剩内容宽 → 标题和权限名一起被截。
  topRight: { flexDirection: "row", alignItems: "center", gap: space(2), flexShrink: 0 },
  fab: {
    width: TOPBAR_H,
    height: TOPBAR_H,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  // 「回到底部」浮钮：在正文之上的独立层（不在滚动容器里，避免被底部渐变压住）。
  jumpWrap: {
    position: "absolute",
    right: space(3.5),
    zIndex: 6,
  },
  jumpButton: {
    width: 40,
    height: 40,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  // 顶栏四件同一高度（TOPBAR_H），高度一致才像一排控件
  // flex 约束必须落在按压原语的外层 Pressable 上（内层是视觉层，不参与父级 flex 分配）。
  // 不许再给 minWidth：左组一旦超过分到的宽度就会压到模型 chip 上（两 chip 重叠）。
  chipFlex: { flexGrow: 1, flexShrink: 1, minWidth: 96 },
  chip: {
    height: TOPBAR_H,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingLeft: space(2.5),
    paddingRight: space(2),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    // 宽度不够时先截标题（chipTitle 可收缩），权限名靠 chipStatus 不收缩保住。
    minWidth: 0,
  },
  chipBody: { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  // 标题吃剩余宽度；权限名只有 3–4 字，不参与收缩（否则会变成「完全…」）。
  chipTitle: { ...text("small"), fontSize: 13, fontWeight: "700", flexShrink: 1 },
  chipStatus: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  chipSub: { ...text("micro"), fontSize: 10.5, fontWeight: "600", flexShrink: 0 },
  // 模型 chip 允许适度收缩并限制最大宽，保住左侧会话 chip 的「完全访问」永不被截断。
  modelChipFlex: { flexGrow: 0, flexShrink: 1, maxWidth: 132, minWidth: 0 },
  modelChip: {
    height: TOPBAR_H,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    gap: 5,
    paddingHorizontal: space(2.5),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modelText: { ...text("micro"), fontSize: 12, fontWeight: "700", flexShrink: 1 },
  effortMeter: {
    width: 3.5,
    height: 16,
    borderRadius: 2,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  effortMeterFill: { width: "100%", borderRadius: 2 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space(4) },
  stageList: { alignItems: "stretch", justifyContent: "flex-start", paddingHorizontal: 0 },
  stageLandscape: { justifyContent: "flex-start", paddingTop: space(3) },
  stageText: { alignItems: "center", gap: space(1.5) },
  emptyMark: { marginBottom: space(1), alignItems: "center" },
  emptyMedallion: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space(1.5),
  },
  emptyHalo: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  stageTextLandscape: { alignItems: "center", maxWidth: 460, gap: space(1) },
  stageTitle: { ...text("title"), fontWeight: "700", letterSpacing: 0.2 },
  stageSubtitle: { ...text("small"), textAlign: "center", marginBottom: space(1.5) },
  starterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space(2),
    maxWidth: 340,
  },
  starterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    paddingLeft: space(2),
    paddingRight: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  starterIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  starterChipText: { ...text("small"), fontSize: 12, fontWeight: "600" },
  startCta: {
    marginTop: space(3),
    borderRadius: radius.control,
    paddingHorizontal: space(6),
    paddingVertical: space(3),
    alignSelf: "center",
  },
  startCtaText: { ...text("body"), fontWeight: "700" },
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
  menuLabel: { ...text("small"), fontWeight: "600" },
  menuDetail: { ...text("micro"), fontSize: 10.5 },
  menuDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  newProjectForm: { paddingHorizontal: space(2), paddingBottom: space(2), gap: space(2) },
  projectActions: { flexDirection: "row", justifyContent: "flex-end", gap: space(2) },
  projectInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    ...text("body"),
  },
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
  // PetView 顶部 y=0 必须从容器顶边起画（绝不垂直居中裁头）；只裁掉脚线（y=58）下方极窄透明留白。
  petDock: { alignItems: "center", justifyContent: "flex-start", overflow: "hidden" },
  petTouch: { alignItems: "center", justifyContent: "flex-start" },
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
  },
  annotationBadgeText: { ...text("micro"), fontSize: 10.5, fontWeight: "700" },
  hint: {
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    marginBottom: space(1.5),
  },
  hintText: { ...text("micro") },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    marginHorizontal: space(3),
    marginBottom: space(1.5),
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusBannerText: { ...text("micro"), flex: 1, fontSize: 11.5 },
  statusRetry: { ...text("small"), fontWeight: "700" },
  editStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    marginBottom: space(1.5),
  },
  editStripText: { ...text("micro"), flex: 1, fontSize: 11.5 },
  composerSkirt: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 54,
  },
  plus: {
    width: 36,
    height: 36,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  composerInput: { ...text("body"), flex: 1, paddingVertical: space(1) },
  composerFocusRing: {
    position: "absolute",
    left: -1,
    right: -1,
    top: -1,
    bottom: -1,
    borderRadius: radius.chip,
    borderWidth: 1.5,
  },
  send: { width: 38, height: 38, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
  sendIcon: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  msgCoreBar: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space(1.5),
    padding: space(0.5),
  },
  msgCoreTile: {
    flex: 1,
    minHeight: 54,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    gap: space(1),
    paddingVertical: space(1.5),
    paddingHorizontal: space(1),
  },
  msgCoreLabel: {
    ...text("micro"),
    fontWeight: "700",
  },
  msgPluginScroll: {
    maxHeight: 240,
  },
  msgSourceLabel: {
    ...text("micro"),
    maxWidth: 86,
    textAlign: "right",
  },
  msgMoreBadge: {
    borderRadius: radius.chip,
    paddingHorizontal: space(2),
    paddingVertical: 2,
  },
  msgMoreBadgeText: {
    ...text("micro"),
    fontSize: 10.5,
    fontWeight: "600",
  },
});
