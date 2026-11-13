// GO 主体抽屉（对齐 dsh-Go sessions_drawer 语义）：新对话 / 搜索 / 状态筛选 /
// 时间分组会话 / 目的地（本机 AGENT、桌面·NIBI-WORK、插件市场、设置）/ 底栏本机状态。
// Phase C 挂起期：会话区是空态，目的地里只有 WORK 可达。
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
import { radius, space, type as typeScale, useNibiTheme } from "../theme";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** 底栏展示的本机状态（挂起期固定 sleeping）。 */
  petState?: PetStateId;
}

const FILTERS = ["全部", "运行中", "待确认", "未读"];

export function GoDrawer({ open, onClose, petState = PET_STATE.sleeping }: DrawerProps) {
  const t = useNibiTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(288, Math.round(width * 0.78));

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
  const suspended = petState === PET_STATE.sleeping;

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
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={[styles.head, { paddingTop: insets.top + space(3) }]}>
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
            <View
              key={label}
              style={[
                styles.fchip,
                { backgroundColor: i === 0 ? t.ink : t.panel },
              ]}
            >
              <Text style={[styles.fchipText, { color: i === 0 ? t.card : t.inkSub }]}>{label}</Text>
            </View>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.groupLabel, { color: t.inkGhost }]}>本机</Text>
          <View style={[styles.emptyCard, { borderColor: t.hairline }]}>
            <Text style={[styles.emptyText, { color: t.inkFaint }]}>
              {suspended
                ? "还没有对话。本机内核 Phase C 挂起中。"
                : "还没有对话。点「新对话」开始。"}
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
              onClose();
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

        <View style={[styles.foot, { borderTopColor: t.hairline, paddingBottom: insets.bottom + space(3) }]}>
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
          <Icon name="puzzle" size={15} color={t.inkGhost} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,47,78,0.24)" },
  panel: { position: "absolute", left: 0, top: 0, bottom: 0, borderRightWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: space(4), paddingTop: space(5), paddingBottom: space(2) },
  logo: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  wordmark: { flex: 1, fontSize: 15, fontWeight: "700", letterSpacing: 0.5 },
  newChat: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: space(3), paddingVertical: 7, borderRadius: radius.chip },
  newChatText: { fontSize: 12, fontWeight: "700" },
  search: { flexDirection: "row", alignItems: "center", gap: 7, marginHorizontal: space(3.5), marginBottom: space(2), paddingHorizontal: space(3), paddingVertical: 9, borderRadius: 12 },
  searchText: { fontSize: 12.5 },
  filters: { flexDirection: "row", gap: 7, paddingHorizontal: space(3.5), paddingBottom: space(1) },
  fchip: { paddingHorizontal: space(2.5), paddingVertical: 5, borderRadius: radius.chip },
  fchipText: { fontSize: 11, fontWeight: "600" },
  scroll: { paddingHorizontal: space(3.5), paddingBottom: space(4) },
  groupLabel: { fontSize: 10.5, fontWeight: "600", paddingTop: space(3), paddingBottom: space(1.5), paddingLeft: space(1) },
  emptyCard: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.control, padding: space(3) },
  emptyText: { fontSize: 12, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: space(4) },
  destRow: { flexDirection: "row", alignItems: "center", gap: space(2.5), paddingVertical: space(2.5) },
  destIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  destBody: { flex: 1, gap: 2 },
  destTitle: { fontSize: 13.5, fontWeight: "600" },
  destSub: { fontSize: 10.5 },
  foot: { flexDirection: "row", alignItems: "center", gap: space(2.5), paddingHorizontal: space(3.5), paddingVertical: space(3), borderTopWidth: StyleSheet.hairlineWidth },
  footIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  footStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
});

export default GoDrawer;
export { typeScale };
