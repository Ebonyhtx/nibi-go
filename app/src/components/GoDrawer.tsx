// GO 导航：一份内容，三种承载（承载方式对齐 dsh-Go adaptive_rail / adaptive_scaffold）。
//   compact  → GoDrawer：从左侧滑出，压在正文上（overlay）
//   expanded → GoSidebar：常驻左栏（侧栏放不下正文时自动退成 GoRail）
//   expanded + 折叠 → GoRail：一列圆键
//
// 信息架构按 NIBI-GO 自己的概念排，不是把 dsh-Go 的抽屉照搬过来：
//   1. 品牌 + 主 CTA 新对话（全宽，唯一橙色强调）
//   2. AGENT 状态卡：本机 AGENT 是 GO 的主体身份，摆在最显眼处——
//      静态小鸟 + 状态灯 + Phase C 说明（挂起期如实说清"为什么还不能用"）
//   3. 搜索 + 按形态筛选（全部 / 本机 / 桌面，不是通用状态筛选）
//   4. 会话列表按位置分组（本机 / 桌面）
//   5. 位置：GO 的双形态落地点——本机 AGENT（当前）与桌面电脑（可立即用）
//   6. 更多：插件市场（D13 独立生态）、设置
// 底栏不重复"本机"（状态卡已说），改为版本标识。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Keyboard,
  Easing,
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
import { radius, space, useNibiTheme } from "../theme";
import { filterSessionsByTitle, groupSessionsByDay } from "./sessionGroups";
import { formatBytes } from "../kernel/sessionArchive";

export interface NavProps {
  /** 底栏展示的本机状态（挂起期固定 sleeping）。 */
  petState?: PetStateId;
  /** 侧栏形态下不画自己的顶栏留白（由父级给）。 */
  insetTop?: number;
  insetBottom?: number;
  onNavigate?: () => void;
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

  return (
    <>
      <View style={[styles.head, { paddingTop: insetTop + space(3) }]}>
        <View style={[styles.logo, { backgroundColor: t.brandSoft }]}>
          <Icon name="pen" size={15} color={t.brand} />
        </View>
        <Text style={[styles.wordmark, { color: t.ink }]}>NIBI-GO</Text>
        <Pressable
          style={[styles.newChat, { backgroundColor: t.panel }]}
          accessibilityRole="button"
          onPress={() => {
            onNewSession?.();
            onNavigate?.();
          }}
        >
          <Icon name="plus" size={12} color={t.inkSub} />
          <Text style={[styles.newChatText, { color: t.inkSub }]}>新对话</Text>
        </Pressable>
      </View>

      <View style={[styles.search, { backgroundColor: t.panel }]}>
        <Icon name="search" size={13} color={t.inkFaint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索对话"
          placeholderTextColor={t.inkFaint}
          style={[styles.searchInput, { color: t.ink }]}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 ? (
          <Pressable
            onPress={() => setSearch("")}
            accessibilityRole="button"
            accessibilityLabel="清除搜索"
            hitSlop={8}
          >
            <Icon name="x" size={13} color={t.inkFaint} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {view === "sessions" ? (
          <>
            {archivedSessions.length > 0 ? (
              <Pressable
                style={[styles.archiveEntry, { backgroundColor: t.panel }]}
                onPress={() => setView("archived")}
                accessibilityRole="button"
                accessibilityLabel={`已归档 ${archivedSessions.length} 个会话`}
              >
                <Icon name="archive" size={13} color={t.inkSub} />
                <Text style={[styles.archiveEntryText, { color: t.inkSub }]}>
                  已归档 · {archivedSessions.length}
                </Text>
                <Icon name="chevron-right" size={12} color={t.inkFaint} />
              </Pressable>
            ) : null}
            {sessions.length === 0 ? (
              <Text style={[styles.emptyText, { color: t.inkFaint }]}>
                {suspended
                  ? "还没有对话。本机内核 Phase C 挂起中。"
                  : "还没有对话。点右上角铅笔开始新对话。"}
              </Text>
            ) : groups.length === 0 ? (
              <Text style={[styles.emptyText, { color: t.inkFaint }]}>没有匹配的对话</Text>
            ) : (
              groups.map((group) => (
                <View key={group.day}>
                  <Text style={[styles.groupLabel, { color: t.inkFaint }]}>{group.label}</Text>
                  {group.items.map((session) => {
                    const active = session.sessionId === activeSessionId;
                    return (
                      <Pressable
                        key={session.sessionId}
                        onPress={() => {
                          onOpenSession?.(session.sessionId);
                          onNavigate?.();
                        }}
                        onLongPress={() => openRowMenu(session)}
                        delayLongPress={400}
                        style={[styles.sessionRow, active && { backgroundColor: t.panel }]}
                        accessibilityRole="button"
                        accessibilityHint="长按归档这条会话"
                      >
                        <Text
                          numberOfLines={1}
                          style={[styles.sessionTitle, { color: active ? t.ink : t.inkSub }]}
                        >
                          {session.title || "新对话"}
                        </Text>
                        <Text style={[styles.sessionTime, { color: t.inkFaint }]}>
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
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </>
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
                  <Text style={styles.archiveDeleteAll}>全部删除</Text>
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
                    <Text
                      numberOfLines={1}
                      style={[styles.sessionTitle, { color: t.inkSub }]}
                    >
                      {session.title || "新对话"}
                    </Text>
                    <Text style={[styles.sessionTime, { color: t.inkFaint }]}>
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
                    <Icon name="trash" size={15} color="#b3261e" />
                  </Pressable>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* 底部工具条：本机状态 / 位置切换 / 设置 */}
      <View style={[styles.foot, { borderTopColor: t.hairline, paddingBottom: insetBottom + space(2) }]}>
        <View style={styles.footStatus}>
          <Dot size={6} color={suspended ? t.inkGhost : t.ok} ring={suspended ? t.inkGhost : undefined} />
          <Text style={[styles.footStatusText, { color: suspended ? t.inkFaint : t.ok }]}>
            {suspended ? "本机挂起" : "本机就绪"}
          </Text>
        </View>
        <View style={styles.footActions}>
          <Pressable
            style={[styles.footBtn, { backgroundColor: t.steelSoft }]}
            onPress={() => {
              onNavigate?.();
              router.push("/work");
            }}
            accessibilityRole="button"
            accessibilityLabel="切换到桌面电脑"
          >
            <Icon name="monitor" size={16} color={t.steel} />
            {onlineDevices > 0 ? (
              <View style={[styles.footBadge, { backgroundColor: t.ok }]}>
                <Text style={styles.footBadgeText}>{onlineDevices}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            style={[styles.footBtn, { backgroundColor: t.panel }]}
            accessibilityLabel="插件"
            onPress={() => {
              Keyboard.dismiss();
              onNavigate?.();
              router.push("/plugins");
            }}
          >
            <Icon name="puzzle" size={16} color={t.inkSub} />
          </Pressable>
          <Pressable
            style={[styles.footBtn, { backgroundColor: t.panel }]}
            accessibilityLabel="设置"
            onPress={() => {
              Keyboard.dismiss();
              onNavigate?.();
              router.push("/settings");
            }}
          >
            <Icon name="sliders" size={16} color={t.inkSub} />
          </Pressable>
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
}) {
  const t = useNibiTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(300, Math.round(width * 0.8));

  const slide = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(dim, { toValue: open ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [open, slide, dim]);

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[styles.dim, { opacity: dim }]}>
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
          },
        ]}
      >
        <GoNavContent
          petState={petState}
          insetTop={0}
          insetBottom={insets.bottom}
          onNavigate={onClose}
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
    <Pressable
      key={icon}
      onPress={onPress}
      style={[styles.railKey, { backgroundColor: t.glass, borderColor: t.glassBorder }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={18} color={onPress ? t.ink : t.inkFaint} />
    </Pressable>
  );

  return (
    <View style={[styles.rail, { paddingLeft: insets.left, paddingTop: insets.top + space(2) }]}>
      <View style={styles.railGroup}>
        {key("menu", onMenu, "展开对话列表")}
        {key("search", onSearch, "搜索对话")}
      </View>
      <View style={styles.flex1} />
      <View style={[styles.railGroup, { paddingBottom: insets.bottom + space(2) }]}>
        <View style={[styles.railKey, { backgroundColor: t.glass, borderColor: t.glassBorder }]}>
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
    backgroundColor: "rgba(28,47,78,0.08)",
    zIndex: 19,
    elevation: 19,
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
    elevation: 20,
  },
  sidebar: { width: 320, height: "100%", borderRightWidth: StyleSheet.hairlineWidth },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: space(3.5),
    paddingBottom: space(3),
  },
  logo: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  wordmark: { flex: 1, fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space(2.5),
    paddingVertical: 6,
    borderRadius: radius.chip,
  },
  newChatText: { fontSize: 11.5, fontWeight: "700" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginHorizontal: space(3.5),
    marginBottom: space(2),
    paddingHorizontal: space(3),
    paddingVertical: 9,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 12.5, padding: 0 },
  scroll: { paddingHorizontal: space(3.5), paddingTop: space(2), paddingBottom: space(3), flexGrow: 1 },
  emptyText: { fontSize: 12, lineHeight: 19, paddingTop: space(2) },
  groupLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    letterSpacing: 0.4,
    paddingHorizontal: space(2.5),
    paddingTop: space(2),
    paddingBottom: 2,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    borderRadius: radius.control,
    marginBottom: 2,
  },
  sessionTitle: { flex: 1, fontSize: 12.5, fontWeight: "600" },
  sessionTime: { fontSize: 10.5 },
  archiveEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
    borderRadius: radius.control,
    marginBottom: space(2),
  },
  archiveEntryText: { flex: 1, fontSize: 11.5, fontWeight: "600" },
  archiveHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingBottom: space(2),
  },
  archiveBack: { flexDirection: "row", alignItems: "center", gap: 2 },
  archiveBackText: { fontSize: 11.5, fontWeight: "600" },
  archiveTitle: { flex: 1, fontSize: 12.5, fontWeight: "700" },
  archiveDeleteAll: { fontSize: 11.5, fontWeight: "700", color: "#b3261e" },
  archivedBody: { flex: 1, minWidth: 0 },
  restoreText: { fontSize: 11.5, fontWeight: "600" },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(3.5),
    paddingTop: space(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footStatus: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  footStatusText: { fontSize: 11, fontWeight: "600" },
  footActions: { flexDirection: "row", gap: space(2) },
  footBtn: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  footBadge: {
    position: "absolute",
    top: 3,
    right: 3,
    minWidth: 13,
    height: 13,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  footBadgeText: { fontSize: 8.5, fontWeight: "700", color: "#fffdf9" },
  rail: { width: 68, height: "100%", alignItems: "center", paddingBottom: space(2) },
  railGroup: { alignItems: "center", gap: space(2) },
  railKey: {
    width: 44,
    height: 44,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  railBadge: { position: "absolute", right: 7, bottom: 7 },
});
