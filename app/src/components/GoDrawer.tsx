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
import {
  Alert,
  Animated,
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
import type { PetStateId } from "./PetView";
import { PET_STATE } from "./petStates";
import type { KernelSessionSummary } from "@nibi-go/kernel-session";
import { motion, radius, size, space, text, useNibiTheme } from "../theme";
import { filterSessionsByTitle, groupSessionsByDay } from "./sessionGroups";
import { formatBytes } from "../kernel/sessionArchive";
import { leaveComposerForNavigation } from "../composer/leave";
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
  onOpenSession?: (sessionId: string) => void;
  onNewSession?: () => void;
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
  // 抽屉/侧栏出现时搜索框会被系统自动聚焦；转场前必须 blur，否则输入法会闪一下。
  const searchRef = useRef<ComponentRef<typeof TextInput> | null>(null);
  useEffect(() => {
    searchRef.current?.blur();
  }, []);
  // 抽屉滑走时搜索框仍是 IME 的 served view：不主动清焦点，键盘会一直留在首页上。
  const wasActive = useRef(active);
  // 入场 stagger 的重播计数：GoNavContent 常驻挂载（GoDrawer 关闭不卸载），
  // 所以「关→开」沿计数 +1，给列表子树换 key 强制重挂载；数据变化不重播。
  // GoSidebar 没有开合概念（active 恒 true），只在首次挂载播一次。
  const [staggerTick, setStaggerTick] = useState(0);
  useEffect(() => {
    if (wasActive.current && !active) {
      searchRef.current?.blur();
      Keyboard.dismiss();
    }
    if (!wasActive.current && active) setStaggerTick((n) => n + 1);
    wasActive.current = active;
  }, [active]);
  const leaveFor = (path: "/settings" | "/plugins") => {
    leaveComposerForNavigation({
      blur: () => {
        onBeforeNavigate?.();
        searchRef.current?.blur();
      },
      dismiss: Keyboard.dismiss,
      navigate: () => {
        onNavigate?.();
        router.push(path);
      },
    });
  };
  // 会话列表 / 归档管理（NIBI 客户端的「归档任务 → 归档管理里删除」同一套流程）。
  const [view, setView] = useState<"sessions" | "archived">("sessions");
  const groups = useMemo(
    () => groupSessionsByDay(filterSessionsByTitle(sessions, search)),
    [sessions, search],
  );
  const archivedRows = useMemo(
    () => filterSessionsByTitle(archivedSessions, search),
    [archivedSessions, search],
  );

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
        {/* 品牌砖：brandSoft 底 + brand 发丝描边。不换 Skia 手绘小鸟——sprite 太重、
            现有铅笔就是「写」的标记，只把砖放大到 40px（size 阶梯没有 40，走 space(10)）。 */}
        <View style={[styles.logo, { backgroundColor: t.brandSoft, borderColor: t.brand }]}>
          <Icon name="pen" size={18} color={t.brand} />
        </View>
        <View style={styles.brandCol}>
          <Text style={[styles.wordmark, { color: t.ink }]}>NIBI-GO</Text>
          {/* 2.0.1：删「本机 AGENT」副标——应用名已说明身份，对用户无信息量。 */}
        </View>
        <PressableScale
          scaleTo={0.94}
          style={({ pressed }) => [styles.newChat, { backgroundColor: pressed ? t.hover : t.panel }]}
          accessibilityRole="button"
          onPress={() => {
            onNewSession?.();
            onNavigate?.();
          }}
        >
          <Icon name="plus" size={12} color={t.inkSub} />
          <Text style={[styles.newChatText, { color: t.inkSub }]}>新对话</Text>
        </PressableScale>
      </View>

      {/* 搜索井：surfaceSoft 内嵌在 card 面板里；聚焦只把发丝线加深一档。 */}
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
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
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

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {view === "sessions" ? (
          /* key=staggerTick：抽屉每次展开重挂列表子树，分组头/行重播入场 stagger；
             平时的数据变化不换 key，不会闪。 */
          <Fragment key={staggerTick}>
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
            ) : groups.length === 0 ? (
              <Text style={[styles.emptyText, { color: t.inkFaint }]}>没有匹配的对话</Text>
            ) : (
              groups.map((group) => {
                const headDelay = staggerDelay(staggerIndex++, 24, 240);
                return (
                  <View key={group.day}>
                    <AppearIn delay={headDelay}>
                      <Text style={[styles.groupLabel, { color: t.inkFaint }]}>{group.label}</Text>
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
                            onLongPress={() => openRowMenu(session)}
                            delayLongPress={400}
                            accessibilityRole="button"
                            accessibilityHint="长按归档这条会话"
                            style={({ pressed }) => [
                              styles.sessionRow,
                              {
                                backgroundColor: rowActive
                                  ? t.card
                                  : pressed
                                    ? t.hover
                                    : "transparent",
                              },
                              // 选中行：card 底 + card 级投影，从纸面上浮一档。
                              rowActive ? { borderColor: t.hairline, ...t.elevation.card } : null,
                            ]}
                          >
                            {rowActive ? (
                              <View style={[styles.activeRail, { backgroundColor: t.brandSoft }]} />
                            ) : null}
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.sessionTitle,
                                { color: rowActive ? t.ink : t.inkSub },
                              ]}
                            >
                              {session.title || "新对话"}
                            </Text>
                            <Text style={[styles.sessionTime, { color: t.inkGhost }]}>
                              {sessionTime(session.updatedAt ?? session.createdAt)}
                            </Text>
                            <Pressable
                              onPress={() => openRowMenu(session)}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`${session.title || "新对话"} 的会话操作`}
                            >
                              <Icon name="ellipsis" size={14} color={t.inkFaint} />
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

      {/* 底部工具条：本机状态 / WORK / 插件 / 设置（38px 玻璃圆键） */}
      <View style={[styles.foot, { borderTopColor: t.hairline, paddingBottom: insetBottom + space(2) }]}>
        <View style={styles.footStatus}>
          <Dot size={6} color={suspended ? t.inkGhost : t.ok} ring={suspended ? t.inkGhost : undefined} />
          <Text style={[styles.footStatusText, { color: suspended ? t.inkFaint : t.ok }]}>
            {suspended ? "未连接" : "本机就绪"}
          </Text>
        </View>
        <View style={styles.footActions}>
          <PressableScale
            scaleTo={0.94}
            style={[styles.footBtn, { backgroundColor: t.glass, borderColor: t.hairline }]}
            onPress={() => {
              onNavigate?.();
              router.push("/work");
            }}
            accessibilityRole="button"
            accessibilityLabel="切换到桌面电脑"
          >
            <Icon name="monitor" size={17} color={t.steel} />
            {onlineDevices > 0 ? (
              <View style={[styles.footBadge, { backgroundColor: t.ok }]}>
                <Text style={[styles.footBadgeText, { color: t.card }]}>{onlineDevices}</Text>
              </View>
            ) : null}
          </PressableScale>
          <PressableScale
            scaleTo={0.94}
            style={[styles.footBtn, { backgroundColor: t.glass, borderColor: t.hairline }]}
            accessibilityLabel="插件"
            onPress={() => leaveFor("/plugins")}
          >
            <Icon name="puzzle" size={17} color={t.inkSub} />
          </PressableScale>
          <PressableScale
            scaleTo={0.94}
            style={[styles.footBtn, { backgroundColor: t.glass, borderColor: t.hairline }]}
            accessibilityLabel="设置"
            onPress={() => leaveFor("/settings")}
          >
            <Icon name="sliders" size={17} color={t.inkSub} />
          </PressableScale>
        </View>
      </View>
    </>
  );
}

/** compact：滑出抽屉。 */
export function GoDrawer({
  open,
  onClose,
  petState,
  onlineDevices,
  sessions,
  archivedSessions,
  activeSessionId,
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
  petState?: PetStateId;
  onlineDevices?: number;
  sessions?: readonly KernelSessionSummary[];
  archivedSessions?: readonly KernelSessionSummary[];
  activeSessionId?: string | null;
  onOpenSession?: (sessionId: string) => void;
  onNewSession?: () => void;
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

  const slide = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(0)).current;
  // 面板内容的轻视差：展开时内容再从 -8px 滑到位（晚 40ms 起步），与面板滑动错开一点层次。
  // 收起不复位（面板已在滑出，看不见）；下次展开前 setValue(0) 重新起跑。
  const content = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    // 面板是「大件」，走 slow 320 + standard 曲线（动效契约）；遮罩更快一档，跟手不拖沓。
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: motion.duration.slow,
      easing: easingStandard,
      useNativeDriver: true,
    }).start();
    Animated.timing(dim, {
      toValue: open ? 1 : 0,
      duration: motion.duration.base,
      easing: easingStandard,
      useNativeDriver: true,
    }).start();
    if (open) {
      content.setValue(0);
      Animated.timing(content, {
        toValue: 1,
        delay: 40,
        duration: motion.duration.base,
        easing: easingStandard,
        useNativeDriver: true,
      }).start();
    }
  }, [open, slide, dim, content]);

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] });
  const contentX = content.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[styles.dim, { opacity: dim, backgroundColor: t.backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭抽屉" />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            backgroundColor: t.card,
            borderRightColor: t.hairline,
            paddingTop: insets.top,
            transform: [{ translateX }],
            // 弹层投影（elevation.menu）：压在正文上要有「浮起来」的一档。
            ...t.elevation.menu,
          },
        ]}
      >
        <Animated.View style={[styles.panelContent, { transform: [{ translateX: contentX }] }]}>
          <GoNavContent
            petState={petState}
            insetTop={0}
            insetBottom={insets.bottom}
            active={open}
            onNavigate={onClose}
            onBeforeNavigate={onBeforeNavigate}
            onlineDevices={onlineDevices}
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
  onOpenSession?: (sessionId: string) => void;
  onNewSession?: () => void;
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
    icon: "menu" | "search" | "phone" | "sliders" | "puzzle",
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
        {key("sliders", onSettings, "设置")}
        {onPlugins ? key("puzzle", onPlugins, "插件") : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  dim: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 19,
  },
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
    gap: space(2),
    paddingHorizontal: space(3.5),
    paddingBottom: space(3),
  },
  // 品牌砖 40px：size 阶梯没有 40 这一档，用 space(10) 表达（space 允许做尺寸用）。
  logo: {
    width: space(10),
    height: space(10),
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  brandCol: { flex: 1 },
  wordmark: { ...text("bodyLg"), fontWeight: "700", letterSpacing: 0.5 },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingHorizontal: space(2.5),
    height: size.chip,
    borderRadius: radius.chip,
  },
  newChatText: { ...text("micro"), fontWeight: "700" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginHorizontal: space(3.5),
    marginBottom: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, ...text("small"), padding: 0 },
  scroll: { paddingHorizontal: space(3.5), paddingTop: space(2), paddingBottom: space(3), flexGrow: 1 },
  emptyText: { ...text("small"), paddingTop: space(2) },
  groupLabel: {
    ...text("micro"),
    fontWeight: "600",
    letterSpacing: 0.4,
    paddingHorizontal: space(2.5),
    paddingTop: space(2),
    paddingBottom: space(0.5),
  },
  sessionRow: {
    minHeight: size.row,
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.control,
    // 透明边框占位：选中行只换边框色，不引起 1px 布局抖动。
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    marginBottom: space(0.5),
  },
  // 选中行的 3px 品牌导轨（规格定值；绝对定位，不占行内布局）。
  activeRail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: radius.xs,
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
  foot: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(3.5),
    paddingTop: space(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footStatus: { flex: 1, flexDirection: "row", alignItems: "center", gap: space(1) },
  footStatusText: { ...text("micro"), fontWeight: "600" },
  footActions: { flexDirection: "row", gap: space(2) },
  footBtn: {
    width: size.button,
    height: size.button,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  // 在线数徽标放大到 18px：字阶最小是 micro(11)，8.5px 那种字面量不再出现。
  footBadge: {
    position: "absolute",
    top: space(0.5),
    right: space(0.5),
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
