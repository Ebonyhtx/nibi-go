// GO 导航：一份内容，三种承载（对齐 dsh-Go adaptive_rail / sessions_drawer 的分层）。
//   compact  → GoDrawer：从左侧滑出，压在正文上（overlay）
//   expanded → GoSidebar：常驻左栏（侧栏放不下正文时自动退成 GoRail）
//   expanded + 折叠 → GoRail：一列圆键，≡/搜索在上，本机/设置在下
// 内容语义：新对话 / 搜索 / 状态筛选 / 按来源分组的会话 / 目的地（本机·挂起、
// 桌面·NIBI-WORK、插件市场、设置）/ 底栏本机状态。Phase C 挂起期会话区为空态。
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
import { PET_STATE } from "./petStates";
import type { PetStateId } from "./PetView";
import { radius, space, useNibiTheme } from "../theme";

const FILTERS = ["全部", "运行中", "待确认", "未读"];

export interface NavProps {
  /** 底栏展示的本机状态（挂起期固定 sleeping）。 */
  petState?: PetStateId;
  /** 侧栏形态下不画自己的顶栏留白（由父级给）。 */
  insetTop?: number;
  insetBottom?: number;
  onNavigate?: () => void;
}

/** 导航内容本体（抽屉 / 常驻侧栏共用）。 */
export function GoNavContent({ petState = PET_STATE.sleeping, insetTop = 0, insetBottom = 0, onNavigate }: NavProps) {
  const t = useNibiTheme();
  const router = useRouter();
  const suspended = petState === PET_STATE.sleeping;

  return (
    <>
      <View style={[styles.head, { paddingTop: insetTop + space(2) }]}>
        <View style={[styles.logo, { backgroundColor: t.brandSoft }]}>
          <Icon name="pen" size={16} color={t.brand} />
        </View>
        <Text style={[styles.wordmark, { color: t.ink }]}>NIBI-GO</Text>
        <View style={[styles.newChat, { backgroundColor: t.panel }]}>
          <Icon name="plus" size={13} color={t.inkFaint} />
          <Text style={[styles.newChatText, { color: t.inkFaint }]}>新对话</Text>
        </View>
      </View>

      <View style={[styles.search, { backgroundColor: t.panel }]}>
        <Icon name="search" size={13} color={t.inkFaint} />
        <Text style={[styles.searchText, { color: t.inkFaint }]}>搜索对话</Text>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((label, i) => (
          <View key={label} style={[styles.fchip, { backgroundColor: i === 0 ? t.ink : t.panel }]}>
            <Text style={[styles.fchipText, { color: i === 0 ? t.card : t.inkSub }]}>{label}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.groupLabel, { color: t.inkGhost }]}>本机</Text>
        <View style={[styles.emptyCard, { borderColor: t.hairline }]}>
          <Text style={[styles.emptyText, { color: t.inkFaint }]}>
            {suspended ? "还没有对话。本机内核 Phase C 挂起中。" : "还没有对话。点「新对话」开始。"}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: t.hairline }]} />
        <Text style={[styles.groupLabel, { color: t.inkGhost }]}>目的地</Text>

        <View style={styles.destRow}>
          <View style={[styles.destIcon, { backgroundColor: t.panel }]}>
            <Icon name="phone" size={17} color={t.inkFaint} />
          </View>
          <View style={styles.destBody}>
            <Text style={[styles.destTitle, { color: t.inkFaint }]}>本机 AGENT</Text>
            <Text style={[styles.destSub, { color: t.inkGhost }]}>Phase C 挂起 · 数据不出机</Text>
          </View>
        </View>

        <Pressable
          style={styles.destRow}
          onPress={() => {
            onNavigate?.();
            router.push("/work");
          }}
          accessibilityRole="button"
          accessibilityLabel="进入 NIBI-WORK 桌面远控"
        >
          <View style={[styles.destIcon, { backgroundColor: t.steelSoft }]}>
            <Icon name="monitor" size={17} color={t.steel} />
          </View>
          <View style={styles.destBody}>
            <Text style={[styles.destTitle, { color: t.ink }]}>桌面 · NIBI-WORK</Text>
            <Text style={[styles.destSub, { color: t.inkFaint }]}>远控同账号电脑 · UI 与桌面同源</Text>
          </View>
          <Icon name="chevron-right" size={15} color={t.inkGhost} />
        </Pressable>

        <View style={styles.destRow}>
          <View style={[styles.destIcon, { backgroundColor: t.panel }]}>
            <Icon name="puzzle" size={17} color={t.inkFaint} />
          </View>
          <View style={styles.destBody}>
            <Text style={[styles.destTitle, { color: t.inkFaint }]}>插件市场</Text>
            <Text style={[styles.destSub, { color: t.inkGhost }]}>GO 生态 · 随 C 立项</Text>
          </View>
        </View>

        <View style={styles.destRow}>
          <View style={[styles.destIcon, { backgroundColor: t.panel }]}>
            <Icon name="sliders" size={17} color={t.inkFaint} />
          </View>
          <View style={styles.destBody}>
            <Text style={[styles.destTitle, { color: t.inkFaint }]}>设置</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.foot, { borderTopColor: t.hairline, paddingBottom: insetBottom + space(2) }]}>
        <View style={[styles.footIcon, { backgroundColor: t.steelSoft }]}>
          <Icon name="phone" size={15} color={t.steel} />
        </View>
        <View style={styles.destBody}>
          <Text style={[styles.destTitle, { color: t.ink }]}>本机</Text>
          <View style={styles.footStatus}>
            <Dot size={6} color={t.inkGhost} ring={t.inkGhost} />
            <Text style={[styles.destSub, { color: t.inkFaint }]}>
              {suspended ? "AGENT 挂起" : "AGENT 就绪"}
            </Text>
          </View>
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
}: {
  open: boolean;
  onClose: () => void;
  petState?: PetStateId;
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
        <GoNavContent petState={petState} insetTop={0} insetBottom={insets.bottom} onNavigate={onClose} />
      </Animated.View>
    </View>
  );
}

/** expanded：常驻侧栏（内容同一份，宽度按 sidebarWidth 固定）。 */
export function GoSidebar({ petState }: { petState?: PetStateId }) {
  const t = useNibiTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.sidebar,
        { backgroundColor: t.card, borderRightColor: t.hairline, paddingLeft: insets.left },
      ]}
    >
      <GoNavContent petState={petState} insetTop={insets.top} insetBottom={insets.bottom + space(2)} />
    </View>
  );
}

/** expanded + 折叠：一列圆键（≡/搜索在上，本机/设置在下）。 */
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
      style={[
        styles.railKey,
        { backgroundColor: t.glass, borderColor: t.glassBorder },
      ]}
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
  sidebar: {
    width: 320,
    height: "100%",
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: space(4), paddingBottom: space(2) },
  logo: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  wordmark: { flex: 1, fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
  newChat: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: space(3), paddingVertical: 7, borderRadius: radius.chip },
  newChatText: { fontSize: 12, fontWeight: "700" },
  search: { flexDirection: "row", alignItems: "center", gap: 7, marginHorizontal: space(3.5), marginBottom: space(2), paddingHorizontal: space(3), paddingVertical: 9, borderRadius: 12 },
  searchText: { fontSize: 12.5 },
  filters: { flexDirection: "row", gap: 7, paddingHorizontal: space(3.5), paddingBottom: space(1) },
  fchip: { paddingHorizontal: space(2.5), paddingVertical: 5, borderRadius: radius.chip },
  fchipText: { fontSize: 11, fontWeight: "600" },
  scroll: { paddingHorizontal: space(3.5), paddingBottom: space(4), flexGrow: 1 },
  groupLabel: { fontSize: 10.5, fontWeight: "600", paddingTop: space(3), paddingBottom: space(1.5), paddingLeft: space(1) },
  emptyCard: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.control, padding: space(3) },
  emptyText: { fontSize: 12, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: space(4) },
  destRow: { flexDirection: "row", alignItems: "center", gap: space(2.5), paddingVertical: space(2.5) },
  destIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  destBody: { flex: 1, gap: 2 },
  destTitle: { fontSize: 13.5, fontWeight: "600" },
  destSub: { fontSize: 10.5 },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(3.5),
    paddingTop: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  footStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
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
