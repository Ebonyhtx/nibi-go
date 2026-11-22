// GO 导航：一份内容，三种承载（承载方式对齐 dsh-Go adaptive_rail / adaptive_scaffold）。
//   compact  → GoDrawer：从左侧滑出，压在正文上（overlay）
//   expanded → GoSidebar：常驻左栏（侧栏放不下正文时自动退成 GoRail）
//   expanded + 折叠 → GoRail：一列圆键
//
// 信息架构（2.0 收敛：侧栏只做「找会话」，仪表盘式的状态卡/筛选/位置区已裁掉）：
//   1. 品牌行：brandSoft 品牌砖 + NIBI-GO 字标（副标「本机 AGENT」）+ 新对话 pill
//   2. 搜索井：surfaceSoft 内嵌面，聚焦时发丝线加深
//   3. 会话列表：按日期分组；抽屉展开时分组头/行 stagger 入场；长按行菜单（归档）
//   4. 底部工具条：本机状态点 + WORK / 插件 / 设置圆键（玻璃底 + 发丝线）
import { Fragment, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { haptic } from "../motion/haptics";
import { rubberBandProgress, SIDE_BLEED, SIDE_SPRING_CONFIG } from "../motion/sidePhysics";
import {
  Alert,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type AlertButton,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Dot, Icon } from "./Icon";
import { useProjects } from "../kernel/projects";
import { projectIdOfWorkspace } from "../kernel/workspace";
import type { PetStateId } from "./PetView";
import { PET_STATE } from "./petStates";
import type { KernelSessionSummary } from "@nibi-go/kernel-session";
import { motion, radius, size, space, text, useNibiTheme } from "../theme";
import { filterSessionsByTitle, groupSessionsByDay } from "./sessionGroups";
import { formatBytes } from "../kernel/sessionArchive";
import { dismissKeyboardOnce, leaveComposerForNavigation } from "../composer/leave";
import { PressableScale } from "../motion/PressableScale";
import { AppearIn, staggerDelay } from "../motion/appear";
import { easingStandard } from "../motion/easing";

export interface NavProps {
  /** 底栏展示的本机状态（挂起期固定 sleeping）。 */
  petState?: PetStateId;
  /** 侧栏形态下不画自己的顶栏留白（由父级给）。 */
  insetTop?: number;
  insetBottom?: number;
  onNavigate?: () => void;
  /** 离屏导航前的清理：首页用它 blur 输入框，避免输入法在设置页闪一下又收起。 */
  onBeforeNavigate?: () => void;
  /** 抽屉是否可见；隐藏后清掉搜索焦点，避免抽屉关掉后键盘还留在屏幕上。 */
  active?: boolean;
  /** 桌面端在线设备数（0 = 未登录 / 无在线）。 */
  onlineDevices?: number;
  /** 本机会话列表（session/list）；空数组显示空态。 */
  sessions?: readonly KernelSessionSummary[];
  /** 已归档会话（本地归档状态；内核不存归档）。 */
  archivedSessions?: readonly KernelSessionSummary[];
  activeSessionId?: string | null;
  /** filesDir 绝对路径：项目 workspace 前缀反查用（项目筛选）。 */
  workspaceRoot?: string;
  onOpenSession?: (sessionId: string) => void;
  onNewSession?: (projectId?: string) => void;
  onArchiveSession?: (sessionId: string) => void | Promise<void>;
  onUnarchiveSession?: (sessionId: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<unknown>;
  onDeleteAllArchived?: () => Promise<{
    succeeded: number;
    failed: number;
    kept: number;
    bytes: number;
  }>;
  /** 会话行菜单里的插件动作入口（有 session.actions 时由首页提供）。 */
  onSessionActions?: (sessionId: string) => void;
}

function sessionTime(ms: number | undefined): string {
  if (typeof ms !== "number" || ms <= 0) return "";
  const date = new Date(ms);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 导航内容本体（抽屉 / 常驻侧栏共用）。
 *
 * 侧栏只做一件事：**找会话**。所以只有四块——
 *   1. 头部：品牌 + 新对话（一行）
 *   2. 搜索
 *   3. 会话列表（空态一句话；有会话后按 本机 / 桌面 分组）
 *   4. 底部工具条：本机 AGENT 状态 / 切换位置（桌面）/ 设置
 * 之前的 AGENT 状态卡、筛选 chips、位置区、更多区都是仪表盘式冗余，
 * 挂起期没有会话可筛也没有多入口可列，全部去掉。
 */
export function GoNavContent({
  petState = PET_STATE.sleeping,
  insetTop = 0,
  insetBottom = 0,
  onNavigate,
  onBeforeNavigate,
  active = true,
  onlineDevices = 0,
  sessions = [],
  archivedSessions = [],
  activeSessionId = null,
  workspaceRoot,
  onOpenSession,
  onNewSession,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  onDeleteAllArchived,
  onSessionActions,
}: NavProps) {
  const t = useNibiTheme();
  const router = useRouter();
  const suspended = petState === PET_STATE.sleeping;
  const [search, setSearch] = useState("");
  // 聚焦环走静态样式：只换发丝线颜色（hairline → hairlineStrong），不做动画环。
  const [searchFocused, setSearchFocused] = useState(false);
  // 搜索框「点击才激活」：抽屉打开时系统会把焦点自动给第一个可聚焦输入框，键盘随即
  // 弹出、点设置/插件时又缩回去——运营者多次反馈的闪现复发点。未激活时不渲染
  // TextInput（只画搜索样式的占位行），从根上断掉自动聚焦。
  const [searchArmed, setSearchArmed] = useState(false);
  // 抽屉/侧栏出现时搜索框会被系统自动聚焦；转场前必须 blur，否则输入法会闪一下。
  const searchRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  // 键盘可见性守卫：ColorOS 的百度输入法对「已经收起时的再次 dismiss」会反转成
  // 弹出（真机截图抓到：抽屉打开后点设置/插件，键盘在首页上冒出又缩回）。
  // 只对真正显示中的键盘发 dismiss。
  const keyboardVisible = useRef(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisible.current = true;
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisible.current = false;
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const dismissKeyboardIfShown = () => {
    if (keyboardVisible.current) Keyboard.dismiss();
  };
  useEffect(() => {
    searchRef.current?.blur();
  }, []);
  // 抽屉滑走时搜索框仍是 IME 的 served view：不主动清焦点，键盘会一直留在首页上。
  const wasActive = useRef(active);
  // 收起动画期间**不换内容**：以前关闭时立刻 setSearchArmed(false)，搜索框在滑出
  // 途中突然变回占位行；展开时又给列表换 key 重播 stagger——两次都表现为「内容闪
  // 一下」。现在只在滑出完成后复位（450ms > 300ms 动画），重开则取消复位。
  const closingRef = useRef(false);
  closingRef.current = !active;
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    if (wasActive.current && !active) {
      // 只 blur，不改内容；也不重复 Keyboard.dismiss()（ColorOS 的输入法对同一时刻
      // 的第二次 dismiss 会反转成弹出——点设置/插件时键盘闪一下的根因）。
      searchRef.current?.blur();
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        setSearchArmed(false);
        setSearchFocused(false);
        setSearch("");
        setProjectFilter(null);
      }, 450);
    }
    wasActive.current = active;
  }, [active]);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );
  const leaveFor = (path: "/settings" | "/settings/projects" | "/plugins") => {
    // 先关抽屉、收键盘，等抽屉滑出（~320ms）后再 push：导航转场和 IME 收起
    // 同一帧发生会让键盘在新页面上闪一下（运营者反馈多次的复发点）。
    leaveComposerForNavigation({
      blur: () => {
        onBeforeNavigate?.();
        searchRef.current?.blur();
      },
      dismiss: () => dismissKeyboardOnce(() => dismissKeyboardIfShown()),
      navigate: () => {
        onNavigate?.();
        // 抽屉关闭动画走完再 push（320ms + 余量），转场期间不再碰键盘 API。
        setTimeout(() => router.push(path), 400);
      },
    });
  };
  // 会话列表 / 归档管理（NIBI 客户端的「归档任务 → 归档管理里删除」同一套流程）。
  const [view, setView] = useState<"sessions" | "archived">("sessions");
  // 项目筛选：null=全部；选中的项目按 workspace 前缀过滤会话，「新对话」也归它。
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const { projects } = useProjects();
  const groups = useMemo(() => {
    const filtered =
      projectFilter && workspaceRoot
        ? sessions.filter(
            (session) =>
              projectIdOfWorkspace(workspaceRoot, session.workspace?.workspacePath) ===
              projectFilter,
          )
        : sessions;
    return groupSessionsByDay(filterSessionsByTitle(filtered, search));
  }, [sessions, search, projectFilter, workspaceRoot]);
  const archivedRows = useMemo(
    () => filterSessionsByTitle(archivedSessions, search),
    [archivedSessions, search],
  );

  // 「全部」视图按项目分组（运营者 2026-11-21：项目与会话管理不明确）——每条会话
  // 归在哪个项目一眼可见；没归进项目的进「独立会话」。选了项目筛选才按日期分组
  // （那时已经在单看一个项目）。项目组内保持 updatedAt 倒序（session/list 已排好）。
  const displayGroups = useMemo(() => {
    if (projectFilter !== null || projects.length === 0) {
      return groups.map((group) => ({
        key: group.day,
        label: group.label,
        items: group.items,
        project: false,
      }));
    }
    const out: Array<{
      key: string;
      label: string;
      items: KernelSessionSummary[];
      project: boolean;
    }> = [];
    for (const project of projects) {
      const items = filterSessionsByTitle(
        sessions.filter(
          (session) =>
            !!workspaceRoot &&
            projectIdOfWorkspace(workspaceRoot, session.workspace?.workspacePath) === project.id,
        ),
        search,
      );
      if (items.length > 0)
        out.push({ key: project.id, label: project.name, items, project: true });
    }
    const loose = filterSessionsByTitle(
      sessions.filter(
        (session) =>
          !workspaceRoot ||
          projectIdOfWorkspace(workspaceRoot, session.workspace?.workspacePath) === null,
      ),
      search,
    );
    if (loose.length > 0)
      out.push({ key: "independent", label: "独立会话", items: loose, project: true });
    return out;
  }, [groups, sessions, search, projects, projectFilter, workspaceRoot]);

  const run = (action: (() => void | Promise<void>) | undefined, message: string) => {
    if (!action) return;
    void Promise.resolve(action()).catch((error: unknown) => {
      Alert.alert(message, error instanceof Error ? error.message : String(error));
    });
  };

  /** 活动列表的行菜单：归档任务（删除只在归档管理里，避免误删）。 */
  const openRowMenu = (session: KernelSessionSummary) => {
    const buttons: AlertButton[] = [
      { text: "取消", style: "cancel" },
      { text: "归档任务", onPress: () => run(() => onArchiveSession?.(session.sessionId), "归档失败") },
    ];
    if (onSessionActions) {
      buttons.push({
        text: "会话信息",
        onPress: () => onSessionActions(session.sessionId),
      });
    }
    Alert.alert(session.title || "新对话", "归档后可在「已归档」里恢复或删除。", buttons);
  };

  const confirmDelete = (session: KernelSessionSummary) => {
    Alert.alert(
      "彻底删除这个会话？",
      `“${session.title || "新对话"}”的会话记录、附件与轨迹文件会一起删除，无法恢复。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "彻底删除",
          style: "destructive",
          onPress: () => {
            void Promise.resolve(onDeleteSession?.(session.sessionId))
              .then((bytes) => {
                if (typeof bytes === "number" && bytes > 0) {
                  Alert.alert("已删除", `释放了 ${formatBytes(bytes)}。`);
                }
              })
              .catch((error: unknown) => {
                Alert.alert("删除失败", error instanceof Error ? error.message : String(error));
              });
          },
        },
      ],
    );
  };

  const confirmDeleteAll = () => {
    if (archivedSessions.length === 0) return;
    Alert.alert(
      `彻底删除这 ${archivedSessions.length} 个归档会话？`,
      "会话记录、附件与轨迹文件会一起删除，无法恢复。运行中或被引用的会话会保留。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "全部删除",
          style: "destructive",
          onPress: () => {
            void onDeleteAllArchived?.()
              .then((result) => {
                const lines = [`成功 ${result.succeeded} 项`];
                if (result.bytes > 0) lines.push(`释放 ${formatBytes(result.bytes)}`);
                if (result.kept > 0) lines.push(`保留 ${result.kept} 项（运行中/被引用）`);
                if (result.failed > 0) lines.push(`失败 ${result.failed} 项`);
                Alert.alert(
                  result.failed > 0 ? "部分删除失败" : "删除完成",
                  `${lines.join("，")}。`,
                );
              })
              .catch((error: unknown) => {
                Alert.alert("删除失败", error instanceof Error ? error.message : String(error));
              });
          },
        },
      ],
    );
  };

  // 入场 stagger 的全局序号（渲染期同步递增，不进状态）：归档入口行占 0，分组头/行依次 +1。
  let staggerIndex = 0;

  return (
    <>
      <View style={[styles.head, { paddingTop: insetTop + space(3) }]}>
        {/* 品牌砖：NIBI 品牌图（纸上鸟），与桌面 icon_512@2x 同源。
            之前用铅笔图标——看起来和「新对话」动作重复（运营者 2026-11-21 指出）。 */}
        <View
          style={[
            styles.logoTile,
            {
              backgroundColor: t.card,
              borderColor: t.hairlineStrong,
              ...t.elevation.card,
            },
          ]}
        >
          <Image source={require("../../assets/icon.png")} style={styles.logo} />
        </View>
        <View style={styles.brandCol}>
          <Text style={[styles.wordmark, { color: t.ink }]}>NIBI-GO</Text>
          <View style={styles.brandSubRow}>
            <Dot
              size={6}
              color={suspended ? t.inkGhost : t.ok}
              ring={suspended ? t.inkGhost : undefined}
            />
            <Text
              numberOfLines={1}
              style={[styles.brandSubText, { color: suspended ? t.inkFaint : t.inkSub }]}
            >
              {suspended
                ? "未连接"
                : onlineDevices > 0
                  ? `本机就绪 · ${onlineDevices} 台在线`
                  : "本机就绪"}
            </Text>
          </View>
        </View>
        <PressableScale
          scaleTo={0.94}
          style={[
            styles.newChat,
            {
              backgroundColor: t.brand,
              ...t.elevation.card,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="新对话"
          onPress={() => {
            onNewSession?.(projectFilter ?? undefined);
            onNavigate?.();
          }}
        >
          <Icon name="plus" size={12} color={t.brandFg} />
          <Text style={[styles.newChatText, { color: t.brandFg }]}>新对话</Text>
        </PressableScale>
      </View>

      {/* 搜索井：surfaceSoft 内嵌在 card 面板里；聚焦只把发丝线加深一档。
          未点击前只画占位行（不渲染 TextInput），避免抽屉打开时被系统自动聚焦。 */}
      {searchArmed || search.length > 0 ? (
        <View
          style={[
            styles.search,
            {
              backgroundColor: t.surfaceSoft,
              borderColor: searchFocused ? t.hairlineStrong : t.hairline,
            },
          ]}
        >
          <Icon name="search" size={13} color={t.inkGhost} />
          <TextInput
            ref={searchRef}
            value={search}
            onChangeText={setSearch}
            placeholder="搜索对话"
            placeholderTextColor={t.inkFaint}
            style={[styles.searchInput, { color: t.ink }]}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
            onFocus={() => setSearchFocused(true)}
            onBlur={() => {
              setSearchFocused(false);
              // 抽屉正在收起时先别拆输入框（会在滑出途中闪成占位行），交给复位计时器。
              if (search.length === 0 && !closingRef.current) setSearchArmed(false);
            }}
          />
          {search.length > 0 ? (
            <Pressable
              onPress={() => setSearch("")}
              accessibilityRole="button"
              accessibilityLabel="清除搜索"
              hitSlop={8}
            >
              <Icon name="x" size={13} color={t.inkGhost} />
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Pressable
          onPress={() => setSearchArmed(true)}
          accessibilityRole="button"
          accessibilityLabel="搜索对话"
          style={[styles.search, { backgroundColor: t.surfaceSoft, borderColor: t.hairline }]}
        >
          <Icon name="search" size={13} color={t.inkGhost} />
          <Text style={[styles.searchPlaceholder, { color: t.inkFaint }]}>搜索对话</Text>
        </Pressable>
      )}

      {/* 项目筛选 chips：建了项目才出现；选中后列表只看该项目的会话，「新对话」也归它。 */}
      {projects.length > 0 ? (
        <View style={styles.projectChips}>
          <PressableScale
            scaleTo={0.94}
            onPress={() => setProjectFilter(null)}
            accessibilityRole="button"
            accessibilityLabel="显示全部会话"
            accessibilityState={{ selected: projectFilter === null }}
            style={[
              styles.projectChip,
              {
                backgroundColor: projectFilter === null ? t.brandSoft : t.surfaceSoft,
                borderColor: projectFilter === null ? t.brand : t.hairline,
              },
            ]}
          >
            <Text
              style={[styles.projectChipText, { color: projectFilter === null ? t.brand : t.inkSub }]}
              numberOfLines={1}
            >
              全部
            </Text>
          </PressableScale>
          {projects.map((project) => {
            const active = projectFilter === project.id;
            return (
              <PressableScale
                key={project.id}
                scaleTo={0.94}
                onPress={() => setProjectFilter(active ? null : project.id)}
                accessibilityRole="button"
                accessibilityLabel={`只看项目 ${project.name}`}
                accessibilityState={{ selected: active }}
                style={[
                  styles.projectChip,
                  {
                    backgroundColor: active ? t.brandSoft : t.surfaceSoft,
                    borderColor: active ? t.brand : t.hairline,
                  },
                ]}
              >
                <Text
                  style={[styles.projectChipText, { color: active ? t.brand : t.inkSub }]}
                  numberOfLines={1}
                >
                  {project.name}
                </Text>
              </PressableScale>
            );
          })}
          {/* 管理入口放在筛选 chips 行尾：chips 是筛选，管理才是建/删/重命名的地方。 */}
          <PressableScale
            scaleTo={0.94}
            onPress={() => leaveFor("/settings/projects")}
            accessibilityRole="button"
            accessibilityLabel="管理项目"
            style={[styles.projectChip, { backgroundColor: t.surfaceSoft, borderColor: t.hairline }]}
          >
            <Icon name="folder" size={11} color={t.inkSub} />
            <Text style={[styles.projectChipText, { color: t.inkSub }]}>管理</Text>
          </PressableScale>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {view === "sessions" ? (
          /* 不随开合重挂列表：面板在滑，内容不该再播一次入场动画（stagger 与滑动叠加
             = 运营者看到的「闪一下」）。入场动画只在首次挂载（离屏时）播一次。 */
          <Fragment>
            {archivedSessions.length > 0 ? (
              <AppearIn delay={staggerDelay(staggerIndex++, 24, 240)}>
                <PressableScale
                  scaleTo={0.985}
                  style={({ pressed }) => [
                    styles.archiveEntry,
                    { backgroundColor: pressed ? t.hover : t.surfaceSoft },
                  ]}
                  onPress={() => setView("archived")}
                  accessibilityRole="button"
                  accessibilityLabel={`已归档 ${archivedSessions.length} 个会话`}
                >
                  <Icon name="archive" size={13} color={t.inkSub} />
                  <Text style={[styles.archiveEntryText, { color: t.inkSub }]}>
                    已归档 · {archivedSessions.length}
                  </Text>
                  <Icon name="chevron-right" size={12} color={t.inkGhost} />
                </PressableScale>
              </AppearIn>
            ) : null}
            {sessions.length === 0 ? (
              <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                {suspended ? "还没有对话" : "还没有对话，点右上角开始"}
              </Text>
            ) : displayGroups.length === 0 ? (
              <Text style={[styles.emptyText, { color: t.inkFaint }]}>没有匹配的对话</Text>
            ) : (
              displayGroups.map((group) => {
                const headDelay = staggerDelay(staggerIndex++, 24, 240);
                return (
                  <View key={group.key}>
                    <AppearIn delay={headDelay}>
                      <View style={styles.groupLabelRow}>
                        {group.project ? (
                          <Icon
                            name="folder"
                            size={11}
                            color={t.inkSub}
                          />
                        ) : null}
                        <Text style={[styles.groupLabel, { color: t.inkSub }]}>
                          {group.label}
                        </Text>
                      </View>
                    </AppearIn>
                    {group.items.map((session) => {
                      // 行级选中态（区别于抽屉的 active 开合 prop，避免同名遮蔽）。
                      const rowActive = session.sessionId === activeSessionId;
                      return (
                        <AppearIn
                          key={session.sessionId}
                          delay={staggerDelay(staggerIndex++, 24, 240)}
                        >
                          <PressableScale
                            scaleTo={0.985}
                            onPress={() => {
                              onOpenSession?.(session.sessionId);
                              onNavigate?.();
                            }}
                            onLongPress={() => {
                              haptic("longPress");
                              openRowMenu(session);
                            }}
                            delayLongPress={400}
                            accessibilityRole="button"
                            accessibilityHint="长按归档这条会话"
                            style={({ pressed }) => [
                              styles.sessionRow,
                              {
                                backgroundColor: rowActive
                                  ? t.brandSoft
                                  : pressed
                                    ? t.hover
                                    : "transparent",
                                borderColor: rowActive ? t.brand : "transparent",
                              },
                            ]}
                          >
                            {rowActive ? (
                              <View style={[styles.activeRail, { backgroundColor: t.brand }]} />
                            ) : null}
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.sessionTitle,
                                {
                                  color: rowActive ? t.ink : t.inkSub,
                                  fontWeight: rowActive ? "700" : "600",
                                },
                              ]}
                            >
                              {session.title || "新对话"}
                            </Text>
                            <Text
                              style={[
                                styles.sessionTime,
                                { color: rowActive ? t.inkSub : t.inkGhost },
                              ]}
                            >
                              {sessionTime(session.updatedAt ?? session.createdAt)}
                            </Text>
                            <Pressable
                              onPress={() => openRowMenu(session)}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`${session.title || "新对话"} 的会话操作`}
                            >
                              <Icon
                                name="ellipsis"
                                size={14}
                                color={rowActive ? t.inkSub : t.inkFaint}
                              />
                            </Pressable>
                          </PressableScale>
                        </AppearIn>
                      );
                    })}
                  </View>
                );
              })
            )}
          </Fragment>
        ) : (
          <>
            <View style={styles.archiveHead}>
              <Pressable
                onPress={() => setView("sessions")}
                style={styles.archiveBack}
                accessibilityRole="button"
                accessibilityLabel="返回会话列表"
              >
                <Icon name="chevron-left" size={13} color={t.inkSub} />
                <Text style={[styles.archiveBackText, { color: t.inkSub }]}>会话</Text>
              </Pressable>
              <Text style={[styles.archiveTitle, { color: t.ink }]}>已归档的会话</Text>
              {archivedSessions.length > 0 ? (
                <Pressable
                  onPress={confirmDeleteAll}
                  accessibilityRole="button"
                  accessibilityLabel="删除所有归档会话"
                  hitSlop={6}
                >
                  <Text style={[styles.archiveDeleteAll, { color: t.red }]}>全部删除</Text>
                </Pressable>
              ) : null}
            </View>
            {archivedRows.length === 0 ? (
              <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                {archivedSessions.length === 0 ? "暂无已归档会话" : "没有匹配的归档会话"}
              </Text>
            ) : (
              archivedRows.map((session) => (
                <View key={session.sessionId} style={styles.sessionRow}>
                  <Pressable
                    style={styles.archivedBody}
                    onPress={() => {
                      run(() => onUnarchiveSession?.(session.sessionId), "恢复失败");
                      onOpenSession?.(session.sessionId);
                      onNavigate?.();
                    }}
                    accessibilityRole="button"
                    accessibilityHint="打开并取消归档"
                  >
                    <Text numberOfLines={1} style={[styles.sessionTitle, { color: t.inkSub }]}>
                      {session.title || "新对话"}
                    </Text>
                    <Text style={[styles.sessionTime, { color: t.inkGhost }]}>
                      {sessionTime(session.updatedAt ?? session.createdAt)}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => run(() => onUnarchiveSession?.(session.sessionId), "恢复失败")}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`取消归档 ${session.title || "新对话"}`}
                  >
                    <Text style={[styles.restoreText, { color: t.inkSub }]}>恢复</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete(session)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`删除 ${session.title || "新对话"}`}
                  >
                    <Icon name="trash" size={15} color={t.red} />
                  </Pressable>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* 底部三键底座：远控 / 插件中心 / 设置（内嵌面卡片 + 圆底图标徽章） */}
      <View style={[styles.footWrap, { paddingBottom: insetBottom + space(2.5) }]}>
        <View
          style={[
            styles.footDock,
            {
              backgroundColor: t.surfaceSoft,
              borderColor: t.hairline,
            },
          ]}
        >
          <PressableScale
            scaleTo={0.95}
            containerStyle={styles.flex1}
            style={({ pressed }) => [
              styles.footBtn,
              { backgroundColor: pressed ? t.hover : "transparent" },
            ]}
            onPress={() => {
              onNavigate?.();
              router.push("/work");
            }}
            accessibilityRole="button"
            accessibilityLabel="切换到桌面电脑"
          >
            <View
              style={[
                styles.footIconCircle,
                { backgroundColor: t.card, borderColor: t.hairline },
              ]}
            >
              <Icon name="monitor" size={15} color={t.steel} />
              {onlineDevices > 0 ? (
                <View style={[styles.footBadge, { backgroundColor: t.ok }]}>
                  <Text style={[styles.footBadgeText, { color: t.card }]}>{onlineDevices}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.footBtnLabel, { color: t.inkSub }]}>远控</Text>
          </PressableScale>

          <PressableScale
            scaleTo={0.95}
            containerStyle={styles.flex1}
            style={({ pressed }) => [
              styles.footBtn,
              { backgroundColor: pressed ? t.hover : "transparent" },
            ]}
            accessibilityRole="button"
            accessibilityLabel="插件"
            onPress={() => leaveFor("/plugins")}
          >
            <View
              style={[
                styles.footIconCircle,
                { backgroundColor: t.card, borderColor: t.hairline },
              ]}
            >
              <Icon name="plug" size={15} color={t.inkSub} />
            </View>
            <Text style={[styles.footBtnLabel, { color: t.inkSub }]}>插件中心</Text>
          </PressableScale>

          <PressableScale
            scaleTo={0.95}
            containerStyle={styles.flex1}
            style={({ pressed }) => [
              styles.footBtn,
              { backgroundColor: pressed ? t.hover : "transparent" },
            ]}
            accessibilityRole="button"
            accessibilityLabel="设置"
            onPress={() => leaveFor("/settings")}
          >
            <View
              style={[
                styles.footIconCircle,
                { backgroundColor: t.card, borderColor: t.hairline },
              ]}
            >
              <Icon name="gear" size={15} color={t.inkSub} />
            </View>
            <Text style={[styles.footBtnLabel, { color: t.inkSub }]}>设置</Text>
          </PressableScale>
        </View>
      </View>
    </>
  );
}

/** 主界面中部横向手势的跟手拖动 API（index 接线）。 */
export interface GoDrawerHandle {
  beginDrag: () => void;
  moveDrag: (dx: number) => void;
  /** 松手：过阈值停靠打开（父级 setOpen(true)），否则弹回。 */
  endDrag: (velocityX: number) => void;
}

/** compact：滑出抽屉（进度由父级共享值驱动：+1 完全展开、0 收起）。 */
export function GoDrawer({
  open,
  onClose,
  onSwipeClose,
  progress,
  dragging,
  petState,
  onlineDevices,
  sessions,
  archivedSessions,
  activeSessionId,
  workspaceRoot,
  onOpenSession,
  onNewSession,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  onDeleteAllArchived,
  onSessionActions,
  onBeforeNavigate,
}: {
  open: boolean;
  onClose: () => void;
  /** 左滑松手已起速度弹簧时回调，只同步 JS 开关态、不再覆写第二条动画。 */
  onSwipeClose?: () => void;
  /** 侧栏进度（父级 index 的共享值，中部手势在 UI 线程直接写它）。 */
  progress: SharedValue<number>;
  /** 手指拖动标记（1=拖动期，0=松手）：防止模糊层在拖动中误挂。 */
  dragging: SharedValue<number>;
  petState?: PetStateId;
  onlineDevices?: number;
  sessions?: readonly KernelSessionSummary[];
  archivedSessions?: readonly KernelSessionSummary[];
  activeSessionId?: string | null;
  /** filesDir 绝对路径：项目 workspace 前缀反查用（项目筛选）。 */
  workspaceRoot?: string;
  onOpenSession?: (sessionId: string) => void;
  onNewSession?: (projectId?: string) => void;
  onArchiveSession?: (sessionId: string) => void | Promise<void>;
  onUnarchiveSession?: (sessionId: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<unknown>;
  onDeleteAllArchived?: () => Promise<{
    succeeded: number;
    failed: number;
    kept: number;
    bytes: number;
  }>;
  /** 会话行菜单里的插件动作入口（有 session.actions 时由首页提供）。 */
  onSessionActions?: (sessionId: string) => void;
  /** 离屏导航前的清理（blur 首页输入框）。 */
  onBeforeNavigate?: () => void;
}) {
  const t = useNibiTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(300, Math.round(width * 0.8));
  const panelWidthSV = useSharedValue(panelWidth);
  useEffect(() => {
    panelWidthSV.value = panelWidth;
  }, [panelWidth, panelWidthSV]);

  // 进度 → 位移/视差（UI 线程驱动；支持过界橡皮筋，左缘有 SIDE_BLEED 余量防露缝）。
  const panelStyle = useAnimatedStyle(() => {
    const p = Math.max(0, progress.value);
    return { transform: [{ translateX: -panelWidthSV.value * (1 - p) }] };
  });
  const contentStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, progress.value));
    return { transform: [{ translateX: -10 * (1 - p) }] };
  });
  // 展开后在面板上往左拖 = 跟手关闭；保留松手速度，带过阈微触感与异常取消兜底。
  const crossed = useSharedValue(0);
  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 14])
        .failOffsetY([-16, 16])
        .onBegin(() => {
          "worklet";
          dragging.value = 1;
          crossed.value = 0;
        })
        .onUpdate((event) => {
          "worklet";
          const raw = 1 + event.translationX / panelWidthSV.value;
          progress.value = raw > 1 ? 1 + rubberBandProgress(raw - 1) : Math.max(0, raw);
          if (progress.value < 0.65 && crossed.value === 0) {
            crossed.value = 1;
            runOnJS(haptic)("threshold");
          } else if (progress.value > 0.75 && crossed.value === 1) {
            crossed.value = 0;
          }
        })
        .onEnd((event) => {
          "worklet";
          const p = progress.value;
          const v = event.velocityX / panelWidthSV.value;
          if (p < 0.65 || event.velocityX < -550) {
            progress.value = withSpring(0, { ...SIDE_SPRING_CONFIG, velocity: v });
            runOnJS(onSwipeClose ?? onClose)();
          } else {
            progress.value = withSpring(1, { ...SIDE_SPRING_CONFIG, velocity: v });
          }
        })
        .onFinalize((_event, success) => {
          "worklet";
          dragging.value = 0;
          if (!success) {
            progress.value = withSpring(1, SIDE_SPRING_CONFIG);
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );


  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* 玻璃模糊/压暗由 index 的 SideBackdrop 统一渲染（左右两栏共用一层）。 */}
      <GestureDetector gesture={closeGesture}>
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          styles.panel,
          {
            left: -SIDE_BLEED,
            width: panelWidth + SIDE_BLEED,
            paddingLeft: SIDE_BLEED,
            backgroundColor: t.card,
            borderRightColor: t.hairline,
            paddingTop: insets.top,
            // 弹层投影（elevation.menu）：压在正文上要有「浮起来」的一档。
            ...t.elevation.menu,
          },
          panelStyle,
        ]}
      >
        <Animated.View style={[styles.panelContent, contentStyle]}>
          <GoNavContent
            petState={petState}
            insetTop={0}
            insetBottom={insets.bottom}
            active={open}
            onNavigate={onClose}
            onBeforeNavigate={onBeforeNavigate}
            onlineDevices={onlineDevices}
            workspaceRoot={workspaceRoot}
            sessions={sessions}
            archivedSessions={archivedSessions}
            activeSessionId={activeSessionId}
            onOpenSession={onOpenSession}
            onNewSession={onNewSession}
            onArchiveSession={onArchiveSession}
            onUnarchiveSession={onUnarchiveSession}
            onDeleteSession={onDeleteSession}
            onDeleteAllArchived={onDeleteAllArchived}
            onSessionActions={onSessionActions}
          />
        </Animated.View>
      </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** expanded：常驻侧栏（内容同一份，宽度按 sidebarWidth 固定）。 */
export function GoSidebar({
  petState,
  onlineDevices,
  sessions,
  archivedSessions,
  activeSessionId,
  workspaceRoot,
  onOpenSession,
  onNewSession,
  onArchiveSession,
  onUnarchiveSession,
  onDeleteSession,
  onDeleteAllArchived,
  onSessionActions,
  onBeforeNavigate,
}: {
  petState?: PetStateId;
  onlineDevices?: number;
  sessions?: readonly KernelSessionSummary[];
  archivedSessions?: readonly KernelSessionSummary[];
  activeSessionId?: string | null;
  /** filesDir 绝对路径：项目 workspace 前缀反查用（项目筛选）。 */
  workspaceRoot?: string;
  onOpenSession?: (sessionId: string) => void;
  onNewSession?: (projectId?: string) => void;
  onArchiveSession?: (sessionId: string) => void | Promise<void>;
  onUnarchiveSession?: (sessionId: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<unknown>;
  onDeleteAllArchived?: () => Promise<{
    succeeded: number;
    failed: number;
    kept: number;
    bytes: number;
  }>;
  /** 会话行菜单里的插件动作入口（有 session.actions 时由首页提供）。 */
  onSessionActions?: (sessionId: string) => void;
  /** 离屏导航前的清理（blur 首页输入框）。 */
  onBeforeNavigate?: () => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.sidebar,
        { backgroundColor: t.card, borderRightColor: t.hairline, paddingLeft: insets.left },
      ]}
    >
      <GoNavContent
        petState={petState}
        insetTop={insets.top}
        insetBottom={insets.bottom + space(2)}
        onlineDevices={onlineDevices}
        workspaceRoot={workspaceRoot}
        sessions={sessions}
        archivedSessions={archivedSessions}
        activeSessionId={activeSessionId}
        onOpenSession={onOpenSession}
        onNewSession={onNewSession}
        onArchiveSession={onArchiveSession}
        onUnarchiveSession={onUnarchiveSession}
        onDeleteSession={onDeleteSession}
        onDeleteAllArchived={onDeleteAllArchived}
        onSessionActions={onSessionActions}
        onBeforeNavigate={onBeforeNavigate}
      />
    </View>
  );
}

/** expanded + 折叠：一列圆键（≡/搜索在上，AGENT/设置在下）。 */
export function GoRail({
  petState,
  onMenu,
  onSearch,
  onSettings,
  onPlugins,
}: {
  petState?: PetStateId;
  onMenu: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onPlugins?: () => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const suspended = petState === PET_STATE.sleeping;
  const key = (
    icon: "menu" | "search" | "phone" | "gear" | "plug",
    onPress?: () => void,
    label?: string,
  ) => (
    <PressableScale
      key={icon}
      scaleTo={0.94}
      onPress={onPress}
      style={[
        styles.railKey,
        { ...t.elevation.card, backgroundColor: t.glass, borderColor: t.glassBorder },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={18} color={onPress ? t.ink : t.inkFaint} />
    </PressableScale>
  );

  return (
    <View style={[styles.rail, { paddingLeft: insets.left, paddingTop: insets.top + space(2) }]}>
      <View style={styles.railGroup}>
        {key("menu", onMenu, "展开对话列表")}
        {key("search", onSearch, "搜索对话")}
      </View>
      <View style={styles.flex1} />
      <View style={[styles.railGroup, { paddingBottom: insets.bottom + space(2) }]}>
        <View
          style={[
            styles.railKey,
            { ...t.elevation.card, backgroundColor: t.glass, borderColor: t.glassBorder },
          ]}
        >
          <Icon name="phone" size={18} color={suspended ? t.inkFaint : t.ink} />
          <View style={styles.railBadge}>
            <Dot size={7} color={t.inkGhost} ring={t.inkGhost} />
          </View>
        </View>
        {key("gear", onSettings, "设置")}
        {onPlugins ? key("plug", onPlugins, "插件") : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  panelContent: { flex: 1 },
  sidebar: { width: 320, height: "100%", borderRightWidth: StyleSheet.hairlineWidth },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(3.5),
    paddingBottom: space(3),
  },
  // 品牌砖 40px：size 阶梯没有 40 这一档，用 space(10) 表达（space 允许做尺寸用）。
  logoTile: {
    width: space(10),
    height: space(10),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  logo: {
    width: "100%",
    height: "100%",
    borderRadius: radius.control,
  },
  brandCol: { flex: 1, minWidth: 0, gap: 2 },
  wordmark: { ...text("bodyLg"), fontWeight: "700", letterSpacing: 0.5 },
  brandSubRow: { flexDirection: "row", alignItems: "center", gap: space(1) },
  brandSubText: { ...text("micro"), fontWeight: "600" },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingHorizontal: space(3),
    height: size.chipLg,
    borderRadius: radius.chip,
  },
  newChatText: { ...text("micro"), fontWeight: "700" },
  search: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginHorizontal: space(3.5),
    marginBottom: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, ...text("small"), padding: 0 },
  searchPlaceholder: { flex: 1, ...text("small") },
  projectChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(1.5),
    paddingHorizontal: space(3.5),
    paddingBottom: space(1.5),
  },
  projectChip: {
    maxWidth: 120,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  projectChipText: { ...text("micro"), fontWeight: "600" },
  scroll: { paddingHorizontal: space(3.5), paddingTop: space(1.5), paddingBottom: space(3), flexGrow: 1 },
  emptyText: { ...text("small"), paddingTop: space(2) },
  groupLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    paddingHorizontal: space(2.5),
    paddingTop: space(3),
    paddingBottom: space(1),
  },
  groupLabel: {
    ...text("micro"),
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  sessionRow: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    // 透明边框占位：选中行只换边框色，不引起 1px 布局抖动。
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    marginBottom: space(1),
  },
  // 选中行的 3px 品牌导轨（规格定值；绝对定位，不占行内布局）。
  activeRail: {
    position: "absolute",
    left: 0,
    top: space(2),
    bottom: space(2),
    width: 3,
    borderRadius: radius.chip,
  },
  sessionTitle: { flex: 1, ...text("small"), fontWeight: "600" },
  sessionTime: { ...text("micro") },
  archiveEntry: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    marginBottom: space(2),
  },
  archiveEntryText: { flex: 1, ...text("small"), fontWeight: "600" },
  archiveHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingBottom: space(2),
  },
  archiveBack: { flexDirection: "row", alignItems: "center", gap: space(0.5) },
  archiveBackText: { ...text("micro"), fontWeight: "600" },
  archiveTitle: { flex: 1, ...text("small"), fontWeight: "700" },
  archiveDeleteAll: { ...text("micro"), fontWeight: "700" },
  archivedBody: { flex: 1, minWidth: 0 },
  restoreText: { ...text("micro"), fontWeight: "600" },
  footWrap: {
    paddingHorizontal: space(3.5),
    paddingTop: space(1.5),
  },
  footDock: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(1.5),
  },
  footBtn: {
    alignItems: "center",
    justifyContent: "center",
    gap: space(1),
    paddingVertical: space(1),
    borderRadius: radius.control,
  },
  footIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  footBtnLabel: {
    ...text("micro"),
    fontWeight: "600",
  },
  // 在线数徽标放大到 18px：字阶最小是 micro(11)，8.5px 那种字面量不再出现。
  footBadge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(0.5),
  },
  footBadgeText: { ...text("micro"), fontWeight: "700" },
  rail: { width: 68, height: "100%", alignItems: "center", paddingBottom: space(2) },
  railGroup: { alignItems: "center", gap: space(2) },
  railKey: {
    width: size.buttonLg,
    height: size.buttonLg,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  railBadge: { position: "absolute", right: space(2), bottom: space(2) },
});
