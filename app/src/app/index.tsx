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
import { GoDrawer, GoRail, GoSidebar, type GoDrawerHandle } from "../components/GoDrawer";
import { Dot, Icon, type IconName } from "../components/Icon";
import { PetView, type PetStateId } from "../components/PetView";
import { PluginActionSheet, type PluginSheetItem } from "../components/PluginActionSheet";
import { PluginPopup, type PopupAnchor } from "../components/PluginPopup";
import type { PluginActionHandler } from "../components/PluginView";
import { SideStatus, type SessionTodoState } from "../components/SideStatus";
import {
  WorkspacePanel,
  type WorkspacePanelHandle,
  type WorkspaceSubagent,
} from "../components/WorkspacePanel";
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
import { dismissKeyboardOnce, leaveComposerForNavigation } from "../composer/leave";
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
  label: string;
  detail: string;
  icon: IconName;
}> = [
  { id: "build", label: "变更前确认", detail: "改文件前先问我。", icon: "pen" },
  { id: "guarded", label: "自主模式", detail: "在有风险时询问", icon: "shield" },
  { id: "yolo", label: "完全访问", detail: "减少确认次数。", icon: "question" },
];

/** filesDir 绝对路径：抽屉的项目筛选按它反查会话归属。 */
function workspaceRoot(): string {
  return documentRootOf(Paths.document.uri);
}

export default function GoHomeScreen() {
  const th = useNibiTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // edge-to-edge 下 adjustResize 不一定会缩小窗口：直接把输入栏抬到键盘上方。
  // 2.0：高度走 Animated.Value（键盘抬起时输入栏跟手滑动，不再硬跳一下）。
  const keyboard = useKeyboardFollow();
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
    [conversation.skills, plugins.enabled],
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
        label: "计划模式",
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
                label: "计划模式",
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
        showHint("压缩需要单独发送：请先清掉其他内容或附件");
        return;
      }
      // 对话还很短时压缩不划算：摘要会把“消息”换成一段比它更长的话，上下文反而变大。
      const messageChars =
        conversation.contextUsage?.breakdown?.find((item) => item.source === "messages")
          ?.chars ?? 0;
      const messageTokens = Math.round(messageChars / 4);
      if (messageTokens > 0 && messageTokens < 2_000) {
        showHint(`当前对话只有约 ${messageTokens} tokens，压缩不会更省`);
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
      showHint(action === "show" ? "正在读取目标…" : "正在更新目标…");
      void conversation
        .runGoal(action, action === "set" ? input : undefined)
        .then(({ message }) => showHint(message));
      return;
    }
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
    const attachmentRefs = attachments.map(toAttachmentRef);
    setAnnotations([]);
    setTokens((current) => current.filter((token) => token.kind === "mode"));
    setAttachments([]);
    setDraft("");
    void conversation.send(prompt, {
      ...(attachmentRefs.length > 0 ? { attachments: attachmentRefs } : {}),
      mode: permissionMode,
      planEnabled,
      ...(modelChoice ? { modelSelection: modelChoice } : {}),
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
  const permissionLabel =
    permissionMode === "yolo" ? "完全访问" : permissionMode === "guarded" ? "自主" : "变更前";
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
      ?.title || "新对话";
  // 配置缺失（没配模型服务）是设置问题，不是链路故障：横幅给「去设置」而不是「重试」，
  // 宠物也不报 error。错误文案真源在 useKernelConversation（“还没有可用的模型服务”）。
  const setupIssue = conversation.status.includes("还没有可用的模型服务");
  // 2.0：桌宠接会话状态机（此前只播 idle）——
  //   等审批 → waiting；流式（还没出正文）→ thinking；流式/工具 → working；
  //   回合刚完成 → done（2.4s 后回 idle）；内核不可用 → sleeping；连接失败 → error。
  // dev 下点宠物仍可循环九个状态，用来核对切换与过渡（发布构建不生效）。
  const [previewState, setPreviewState] = useState<PetStateId | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const livePetState = useMemo<PetStateId>(() => {
    // 配置缺失（未配 Provider / 没默认模型）是设置问题，不是链路故障——别让宠物一直报红。
    if (conversation.statusKind === "error" && !setupIssue) return PET_STATE.error;
    if (conversation.statusKind === "error" && !setupIssue) return PET_STATE.error;
    if (conversation.rows.some((row) => row.kind === "approval" || row.kind === "question")) {
      return PET_STATE.waiting;
    }
    if (conversation.turn === "running") {
      const streaming = [...conversation.rows]
        .reverse()
        .find((row) => row.kind === "assistant" && row.streaming);
      // 长推理段（只有思考、还没正文）用 thinking；其余（正文流式/工具）用 working。
      if (streaming?.kind === "assistant" && streaming.text.trim().length === 0) {
        return PET_STATE.thinking;
      }
      return PET_STATE.working;
    }
    if (celebrating) return PET_STATE.done;
    if (!conversation.ready) return PET_STATE.sleeping;
    return PET_STATE.idle;
  }, [
    setupIssue,
    conversation.statusKind,
    conversation.rows,
    conversation.turn,
    conversation.ready,
    celebrating,
  ]);
  // 回合完成 → 播一次 done（只在「从 running 变 idle 且最后一轮 completed」时触发）。
  const lastTurnState = useMemo(() => {
    for (let i = conversation.rows.length - 1; i >= 0; i--) {
      const row = conversation.rows[i];
      if (row.kind === "turn") return row.state;
    }
    return null;
  }, [conversation.rows]);
  const runningRef = useRef(false);
  useEffect(() => {
    const wasRunning = runningRef.current;
    runningRef.current = conversation.turn === "running";
    if (!wasRunning || runningRef.current) return;
    if (lastTurnState !== "completed") return;
    setCelebrating(true);
    const timer = setTimeout(() => setCelebrating(false), 2400);
    return () => clearTimeout(timer);
  }, [conversation.turn, lastTurnState]);
  const petState = previewState ?? livePetState;
  const cyclePetState = () => {
    if (!__DEV__) return;
    const ids = Object.values(PET_STATE);
    const i = ids.indexOf(petState);
    setPreviewState(ids[(i + 1) % ids.length]!);
  };

  // 右侧工作区面板：当前会话的 workspace 目录 + 本会话子代理状态。
  const activeWorkspacePath = useMemo(() => {
    const session = conversation.sessions.find(
      (entry) => entry.sessionId === conversation.activeSessionId,
    );
    return session?.workspace?.workspacePath ?? null;
  }, [conversation.sessions, conversation.activeSessionId]);
  // 中部横向手势：任意位置起滑（运营者 2026-11-22 要求，对齐豆包的手感）——
  // 往右拖出左抽屉、往左拖出右侧工作区面板，面板跟手；纵向滑动让位给列表滚动。
  // 用 capture 阶段抢水平手势，ScrollView 纵向不受影响。
  const sideGestureRef = useRef<"drawer" | "panel" | null>(null);
  const sidePan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 16) return false;
          if (Math.abs(gesture.dx) < Math.abs(gesture.dy) * 1.6) return false;
          if (gesture.dx > 0 && !drawerOpen) {
            sideGestureRef.current = "drawer";
            return true;
          }
          if (gesture.dx < 0 && !workspacePanelOpen) {
            sideGestureRef.current = "panel";
            return true;
          }
          return false;
        },
        onPanResponderGrant: () => {
          if (sideGestureRef.current === "drawer") drawerRef.current?.beginDrag();
          else panelRef.current?.beginDrag();
        },
        onPanResponderMove: (_event, gesture) => {
          if (sideGestureRef.current === "drawer") drawerRef.current?.moveDrag(gesture.dx);
          else if (sideGestureRef.current === "panel") panelRef.current?.moveDrag(gesture.dx);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (sideGestureRef.current === "drawer") drawerRef.current?.endDrag(gesture.vx);
          else if (sideGestureRef.current === "panel") panelRef.current?.endDrag(gesture.vx);
          sideGestureRef.current = null;
        },
        onPanResponderTerminate: () => {
          if (sideGestureRef.current === "drawer") drawerRef.current?.endDrag(0);
          else if (sideGestureRef.current === "panel") panelRef.current?.endDrag(0);
          sideGestureRef.current = null;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [drawerOpen, workspacePanelOpen],
  );
  // 两个侧栏的句柄（跟手拖动）+ 「回到底部」浮钮状态。
  const drawerRef = useRef<GoDrawerHandle | null>(null);
  const panelRef = useRef<WorkspacePanelHandle | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [jumpSignal, setJumpSignal] = useState(0);

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
    else if (layout.menuAction === "expand") {
      // 展开侧栏也先清掉输入框焦点：否则随后点设置时转场会把输入法再弹一下。
      blurComposer();
      setSidebarOpen(true);
    } else {
      // 开抽屉前就 blur：抽屉本身会收键盘，但焦点还在输入框，点设置时输入法会闪。
      leaveComposerForNavigation({
        blur: blurComposer,
        dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
        navigate: () => setDrawerOpen(true),
      });
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
            onMenu={() => {
              leaveComposerForNavigation({
                blur: blurComposer,
                dismiss: () => dismissKeyboardOnce(Keyboard.dismiss),
                navigate: () => setSidebarOpen(true),
              });
            }}
            onSearch={() => undefined}
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
                  <PressableScale
                    style={[
                      styles.fab,
                      { backgroundColor: th.glass, borderColor: th.glassBorder },
                      th.elevation.card,
                    ]}
                    onPress={onMenu}
                    accessibilityRole="button"
                    accessibilityLabel={layout.menuAction === "collapse" ? "折叠对话列表" : "打开对话列表"}
                  >
                    <Icon name="menu" size={17} color={th.ink} />
                  </PressableScale>
                ) : null}

                <PressableScale
                  ref={sessionChipRef}
                  onPress={() => {
                    sessionChipRef.current?.measureInWindow((x, y, width, height) => {
                      setPermissionMenu({ x, y, width, height });
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`会话与权限模式：${permissionLabel}`}
                  containerStyle={styles.chipFlex}
                  style={[styles.chip, { backgroundColor: th.glass, borderColor: th.glassBorder }]}
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
                      <Text style={[styles.chipSub, { color: th.inkFaint }]} numberOfLines={1}>
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
                    setModelPickerOpen(true);
                    void providerCatalog.reload();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`选择模型：${modelLabel}${effortLabel ? `，思考强度${effortLabel}` : ""}`}
                  containerStyle={styles.modelChipFlex}
                  style={[styles.modelChip, { backgroundColor: th.glass, borderColor: th.glassBorder }]}
                >
                  <View style={[styles.effortMeter, { backgroundColor: th.hairline }]}>
                    <View
                      style={[
                        styles.effortMeterFill,
                        { height: `${Math.round(effortProgress * 100)}%`, backgroundColor: th.ok },
                      ]}
                    />
                  </View>
                  <Text style={[styles.modelText, { color: th.inkSub }]} numberOfLines={1}>
                    {modelLabel}
                  </Text>
                  <Icon name="chevron-down" size={12} color={th.inkGhost} />
                </PressableScale>

                <PressableScale
                  style={[
                    styles.fab,
                    { backgroundColor: th.glass, borderColor: th.glassBorder },
                    th.elevation.card,
                  ]}
                  accessibilityLabel="打开工作区面板"
                  onPress={() => setWorkspacePanelOpen(true)}
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
                accessibilityLabel={`内核状态：${conversation.status}`}
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
                  {setupIssue ? "还没有可用的模型服务" : conversation.status}
                </Text>
                {setupIssue ? (
                  <Text style={[styles.statusRetry, { color: th.brand }]}>去设置</Text>
                ) : conversation.statusKind === "error" && conversation.statusRetryable ? (
                  <Text style={[styles.statusRetry, { color: th.brand }]}>重试</Text>
                ) : null}
              </PressableScale>
            ) : null}

            {/* 正文区：有消息就是会话流；没有消息才是空态说明（会话即首页）。 */}
            <View
              style={[
                styles.stage,
                conversation.rows.length > 0 && styles.stageList,
                layout.landscapeCompact && styles.stageLandscape,
              ]}
              {...sidePan.panHandlers}
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
                  showReasoning={conversationPrefs.showReasoning}
                  showTools={conversationPrefs.showTools}
                  autoCollapseThinking={conversationPrefs.autoCollapseReasoning}
                  autoCollapseTools={conversationPrefs.autoCollapseTools}
                  onRetryTurn={(target) => {
                    void conversation.retryTurn(target).then((error) => {
                      if (error) showHint(error);
                    });
                  }}
                  onAtBottomChange={setAtBottom}
                  jumpSignal={jumpSignal}
                />
              ) : (
                // 空态：品牌印记 + 标题，一句不多——输入框 placeholder 与横幅已承担引导。
                // 2.0.1 减法：删说明段（「内核在本机运行…」是实现自白）与两枚状态徽章
                //（「本机内核/可先连桌面」无可执行动作），同屏只留一只鸟。
                <AppearIn
                  distance={10}
                  style={[styles.stageText, layout.landscapeCompact && styles.stageTextLandscape]}
                >
                  <View style={styles.emptyMark}>
                    <PetView state={PET_STATE.idle} targetSize={64} animated={false} crop={0.8} />
                  </View>
                  <Text style={[styles.stageTitle, { color: th.ink }]}>开始一段对话</Text>
                </AppearIn>
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

              {/* 宠物 + 快捷动作浮在会话流底部：不参与列表布局，也不改变 COMPOSE。
                  空态时不渲染——中央已有品牌大鸟，同屏两只鸟抢主角（运营者 2026-11-21 指出）。 */}
              {conversation.rows.length > 0 ? (
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
                        th.elevation.card,
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
              ) : null}
            </View>

            {hint ? (
              <View
                style={[styles.hint, { backgroundColor: th.panel, borderColor: th.hairline }]}
                accessibilityRole="alert"
              >
                <Text style={[styles.hintText, { color: th.inkSub }]}>{hint}</Text>
              </View>
            ) : null}

            {/* 编辑重发条：草稿现在是「最后一条消息的改写文本」，发送即替换原文。 */}
            {editTarget ? (
              <View
                style={[styles.editStrip, { backgroundColor: th.glass, borderColor: th.glassBorder }]}
              >
                <Text style={[styles.editStripText, { color: th.brand }]} numberOfLines={1}>
                  正在编辑重发最后一条消息，发送后替换原文
                </Text>
                <Pressable
                  accessibilityLabel="取消编辑"
                  hitSlop={8}
                  onPress={() => {
                    setEditTarget(null);
                    setDraft("");
                  }}
                >
                  <Icon name="x" size={13} color={th.inkSub} />
                </Pressable>
              </View>
            ) : null}

            {/* 输入栏：原始单行 pill；插件/命令 token 与草稿同一行，点 × 只移除 token。
                2.0：marginBottom 由键盘动画驱动（抬起时整条输入栏跟手上滑）。 */}
            <Animated.View
              style={[
                styles.composer,
                {
                  backgroundColor: th.glass,
                  borderColor: th.glassBorder,
                  marginBottom: Animated.add(keyboard.offset, insets.bottom + space(2)),
                },
                th.elevation.float,
              ]}
            >
              <PressableScale
                ref={plusRef}
                onPress={openPlusMenu}
                style={[styles.plus, { backgroundColor: th.panel }]}
                accessibilityRole="button"
                accessibilityLabel="选择插件"
              >
                <Icon name="plus" size={13} color={th.inkSub} />
              </PressableScale>
              <ComposerAttachments
                attachments={attachments}
                onRemove={(id) =>
                  setAttachments((current) => current.filter((attachment) => attachment.id !== id))
                }
              />
              <ComposerTokens
                tokens={tokens}
                onRemove={(id) => {
                  const removed = tokens.find((token) => token.id === id);
                  if (removed?.kind === "mode") setPlanEnabled(false);
                  setTokens((current) => current.filter((token) => token.id !== id));
                }}
              />
              <TextInput
                ref={composerInputRef}
                value={draft}
                onChangeText={setDraft}
                placeholder={tokens.length > 0 ? "继续输入…" : "给 NIBI 发消息…"}
                placeholderTextColor={th.inkFaint}
                style={[styles.composerInput, { color: th.ink }]}
                returnKeyType="send"
                editable={conversation.ready && !composerLocked}
                onFocus={() => {
                  composerFocusedRef.current = true;
                }}
                onBlur={() => {
                  composerFocusedRef.current = false;
                }}
                onSubmitEditing={() => {
                  if (canSend) sendDraft();
                }}
              />
              {conversation.turn === "running" ? (
                /* 流式期间发送键变停止键（内核 `stop` → Interrupt）；草稿保留，停止后可继续发。 */
                <PressableScale
                  accessibilityLabel="停止生成"
                  onPress={() => {
                    void conversation.stopTurn().then((error) => {
                      if (error) showHint(error);
                    });
                  }}
                  style={[styles.send, { backgroundColor: th.brand }]}
                >
                  <Icon name="stop" size={15} color={th.brandFg} />
                </PressableScale>
              ) : (
                <PressableScale
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
                </PressableScale>
              )}
            </Animated.View>
          </View>
        </View>
      </View>

      {!inShell ? (
        <GoDrawer
          ref={drawerRef}
          workspaceRoot={workspaceRoot()}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSwipeOpen={() => {
            // 中部手势开抽屉也要先收输入框/键盘：键盘浮层会压在抽屉上层，
            // 一直可见到导航时才缩回——看起来就是「键盘闪一下」（运营者反馈）。
            blurComposer();
            dismissKeyboardOnce(Keyboard.dismiss);
            setDrawerOpen(true);
          }}
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
        ref={panelRef}
        visible={workspacePanelOpen}
        onClose={() => setWorkspacePanelOpen(false)}
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
        onSwipeOpen={() => {
          blurComposer();
          dismissKeyboardOnce(Keyboard.dismiss);
          setWorkspacePanelOpen(true);
        }}
      />

      {/* 「回到底部」浮钮：渲染在这层（晚于正文的渐变遮罩），离开底部时出现。 */}
      {!atBottom && conversation.rows.length > 0 ? (
        <Pressable
          onPress={() => setJumpSignal((value) => value + 1)}
          accessibilityRole="button"
          accessibilityLabel="跳到最新消息"
          style={({ pressed }) => [
            styles.jumpButton,
            {
              backgroundColor: pressed ? th.hover : th.card,
              borderColor: th.hairline,
              bottom: composerBottom + 60,
              ...th.elevation.card,
            },
          ]}
        >
          <Icon name="chevron-down" size={16} color={th.inkSub} />
        </Pressable>
      ) : null}

      <SideStatus
        plugins={plugins.enabled}
        usage={conversation.contextUsage}
        slotData={conversation.pluginSlotData}
        session={sessionTools}
        bottom={statusBottom}
      />

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
        title="切换到完全访问"
        message={"完全访问会减少确认次数，模型可以在不逐次询问的情况下修改文件和执行命令。\n\n只在你信任当前任务和模型时使用。"}
        confirmLabel="切换到完全访问"
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
        <Text style={[styles.popupTitle, { color: th.ink }]}>会话权限</Text>
        <Pressable
          onPress={() => {
            setPlanMode(!planEnabled);
            setPermissionMenu(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={planEnabled ? "关闭计划模式" : "打开计划模式"}
          style={({ pressed }) => [
            styles.menuRow,
            { borderColor: th.hairline, opacity: pressed ? 0.6 : 1 },
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
            <Text style={[styles.menuLabel, { color: th.ink }]}>计划模式</Text>
            <Text style={[styles.menuDetail, { color: th.inkFaint }]}>编辑前先出计划。</Text>
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
          return (
            <Pressable
              key={option.id}
              onPress={() => choosePermission(option.id)}
              accessibilityRole="button"
              accessibilityLabel={`${option.label}：${option.detail}`}
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
                <Text style={[styles.menuLabel, { color: th.ink }]}>{option.label}</Text>
                <Text style={[styles.menuDetail, { color: th.inkFaint }]}>{option.detail}</Text>
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
        width={240}
      >
        <Text style={[styles.popupTitle, { color: th.ink }]}>消息动作</Text>
        <Pressable
          onPress={() => {
            if (popup?.kind !== "message") return;
            const text = popup.message;
            setPopup(null);
            void Clipboard.setStringAsync(text)
              .then((saved) => showHint(saved ? "已复制" : "复制失败，请手动选择文本"))
              .catch(() => showHint("复制失败，请手动选择文本"));
          }}
          accessibilityRole="button"
          accessibilityLabel="复制消息"
          style={({ pressed }) => [
            styles.menuRow,
            { borderColor: th.hairline, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <View style={[styles.toolIconSmall, { backgroundColor: th.panel }]}>
            <Icon name="copy" size={15} color={th.inkSub} />
          </View>
          {/* 菜单只留「图标+标题」：动作名称自解释，解释文让菜单高度翻倍（2.0.1 审查口径）。 */}
          <View style={styles.menuText}>
            <Text style={[styles.menuLabel, { color: th.ink }]}>复制</Text>
          </View>
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
                showHint("带附件或引用的消息暂不支持编辑重发");
                return;
              }
              setEditTarget({ rowId: row.rowId, entityId: row.entityId });
              setDraft(row.text);
            }}
            accessibilityRole="button"
            accessibilityLabel="编辑重发"
            style={({ pressed }) => [
              styles.menuRow,
              { borderColor: th.hairline, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={[styles.toolIconSmall, { backgroundColor: th.panel }]}>
              <Icon name="pen" size={15} color={th.inkSub} />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuLabel, { color: th.ink }]}>编辑重发</Text>
              <Text style={[styles.menuDetail, { color: th.inkFaint }]}>改写后替换这条输入</Text>
            </View>
          </Pressable>
        ) : null}
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
          </View>
          <Icon name="chevron-right" size={13} color={th.inkFaint} />
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
            </View>
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
  jumpButton: {
    position: "absolute",
    right: space(3),
    width: 38,
    height: 38,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },
  // 顶栏四件同一高度（TOPBAR_H），高度一致才像一排控件
  // flex 约束必须落在按压原语的外层 Pressable 上（内层是视觉层，不参与父级 flex 分配）。
  // 不许再给 minWidth：左组一旦超过分到的宽度就会压到模型 chip 上（两 chip 重叠）。
  chipFlex: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
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
  chipSub: { ...text("micro"), fontSize: 10, flexShrink: 0 },
  // 模型 chip 按内容定宽、不抢空间；剩余宽度全给会话 chip（标题可截，权限名不截）。
  modelChipFlex: { flexGrow: 0, flexShrink: 0, minWidth: 0 },
  modelChip: {
    height: TOPBAR_H,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    gap: 5,
    paddingHorizontal: space(3),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modelText: { ...text("micro"), fontSize: 11.5, fontWeight: "600", flexShrink: 1 },
  effortMeter: {
    width: 3,
    height: 16,
    borderRadius: 2,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  effortMeterFill: { width: "100%", borderRadius: 2 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space(4) },
  stageList: { alignItems: "stretch", justifyContent: "flex-start", paddingHorizontal: 0 },
  stageLandscape: { justifyContent: "flex-start", paddingTop: space(3) },
  stageText: { alignItems: "center", gap: space(2) },
  emptyMark: { marginBottom: space(1), alignItems: "center" },
  stageTextLandscape: { alignItems: "center", maxWidth: 460, gap: space(1) },
  stageTitle: { ...text("title"), fontWeight: "700" },
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
  },
  plus: { width: 32, height: 32, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
  composerInput: { ...text("body"), flex: 1, paddingVertical: space(1) },
  send: { width: 38, height: 38, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
});
