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
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Dot, Icon } from "./Icon";
import type { PetStateId } from "./PetView";
import { PET_STATE } from "./petStates";
import { radius, space, useNibiTheme } from "../theme";

export interface NavProps {
  /** 底栏展示的本机状态（挂起期固定 sleeping）。 */
  petState?: PetStateId;
  /** 侧栏形态下不画自己的顶栏留白（由父级给）。 */
  insetTop?: number;
  insetBottom?: number;
  onNavigate?: () => void;
  /** 桌面端在线设备数（0 = 未登录 / 无在线）。 */
  onlineDevices?: number;
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
}: NavProps) {
  const t = useNibiTheme();
  const router = useRouter();
  const suspended = petState === PET_STATE.sleeping;

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
          onPress={onNavigate}
        >
          <Icon name="plus" size={12} color={t.inkSub} />
          <Text style={[styles.newChatText, { color: t.inkSub }]}>新对话</Text>
        </Pressable>
      </View>

      <View style={[styles.search, { backgroundColor: t.panel }]}>
        <Icon name="search" size={13} color={t.inkFaint} />
        <Text style={[styles.searchText, { color: t.inkFaint }]}>搜索对话</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {suspended ? (
          <Text style={[styles.emptyText, { color: t.inkFaint }]}>
            还没有对话。本机内核 Phase C 挂起中。
          </Text>
        ) : null}
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
          <Pressable style={[styles.footBtn, { backgroundColor: t.panel }]} accessibilityLabel="设置">
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
}: {
  open: boolean;
  onClose: () => void;
  petState?: PetStateId;
  onlineDevices?: number;
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
        />
      </Animated.View>
    </View>
  );
}

/** expanded：常驻侧栏（内容同一份，宽度按 sidebarWidth 固定）。 */
export function GoSidebar({
  petState,
  onlineDevices,
}: {
  petState?: PetStateId;
  onlineDevices?: number;
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
}: {
  petState?: PetStateId;
  onMenu: () => void;
  onSearch: () => void;
  onSettings: () => void;
}) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  const suspended = petState === PET_STATE.sleeping;
  const key = (icon: "menu" | "search" | "phone" | "sliders", onPress?: () => void, label?: string) => (
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  dim: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,47,78,0.24)" },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
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
  searchText: { fontSize: 12.5 },
  scroll: { paddingHorizontal: space(3.5), paddingTop: space(2), paddingBottom: space(3), flexGrow: 1 },
  emptyText: { fontSize: 12, lineHeight: 19, paddingTop: space(2) },
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
