// GO 主体首页 = 会话即首页（D2 修订：打开即 GO，WORK 只是抽屉里的目的地）。
// 版式对齐 dsh-Go home_shell（浮动玻璃 pill 顶栏 + 会话流 + 输入栏 + 宠物在场），
// 配色走纸上鸟 token（theme.ts）。Phase C 挂起：空态 + 睡着的鸟 + 灰态输入栏。
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GoDrawer } from "../components/GoDrawer";
import { Dot, Icon, ScreenBackground } from "../components/Icon";
import { PetView } from "../components/PetView";
import { PET_STATE } from "../components/petStates";
import { radius, space, type as t, useNibiTheme } from "../theme";

export default function GoHomeScreen() {
  const th = useNibiTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Phase C 挂起中：AGENT 没有工作可做，宠物睡在空态舞台里。
  const petState = PET_STATE.sleeping;

  return (
    <View style={[styles.root, { backgroundColor: th.bg }]}>
      <ScreenBackground
        width={width}
        height={height}
        top={th.bgGradient[0]}
        bottom={th.bgGradient[1]}
        glow={th.glow}
      />

      <View style={[styles.topbar, { paddingTop: insets.top + space(2) }]}>
        <Pressable
          style={[styles.fab, styles.glass, { backgroundColor: th.glass, borderColor: th.glassBorder }]}
          onPress={() => setDrawerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="打开抽屉"
        >
          <Icon name="menu" size={17} color={th.ink} />
        </Pressable>

        <View
          style={[styles.chip, styles.glass, { backgroundColor: th.glass, borderColor: th.glassBorder }]}
        >
          <View style={styles.chipBody}>
            <Text style={[styles.chipTitle, { color: th.ink }]} numberOfLines={1}>
              新对话
            </Text>
            <View style={styles.chipStatus}>
              <Dot size={6} color={th.inkGhost} ring={th.inkGhost} />
              <Text style={[styles.chipSub, { color: th.inkFaint }]}>本机 · 挂起</Text>
            </View>
          </View>
          <Icon name="chevron-down" size={13} color={th.inkFaint} />
        </View>

        <View style={styles.flex1} />

        <View
          style={[styles.fab, styles.glass, { backgroundColor: th.glass, borderColor: th.glassBorder, opacity: 0.55 }]}
        >
          <Icon name="pen" size={17} color={th.inkFaint} />
        </View>
      </View>

      <View style={styles.stage}>
        <PetView state={petState} scale={3} />
        <Text style={[styles.stageTitle, { color: th.ink }]}>本机 AGENT 还在装修</Text>
        <Text style={[styles.stageSub, { color: th.inkSub }]}>
          内核 Phase C 挂起中。启动后，在这里直接跟它说话、派任务、收文件。
        </Text>
        <View style={[styles.badge, { backgroundColor: th.panel }]}>
          <Text style={[styles.badgeText, { color: th.inkFaint }]}>数据不出机</Text>
        </View>
      </View>

      <View
        style={[
          styles.composer,
          styles.glass,
          { backgroundColor: th.glass, borderColor: th.glassBorder, marginBottom: insets.bottom + space(4) },
        ]}
      >
        <View style={[styles.plus, { backgroundColor: th.panel }]}>
          <Icon name="plus" size={13} color={th.inkSub} />
        </View>
        <View style={styles.flex1}>
          <Text style={[styles.placeholder, { color: th.inkFaint }]}>给 NIBI 发消息…</Text>
          <Text style={[styles.placeholderHint, { color: th.inkGhost }]}>内核挂起中 · 暂不能对话</Text>
        </View>
        <View style={[styles.send, { backgroundColor: th.brand, opacity: 0.45 }]}>
          <Icon name="arrow-up" size={16} color={th.brandFg} />
        </View>
      </View>

      <GoDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} petState={petState} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex1: { flex: 1 },
  glass: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(4),
    paddingBottom: space(1.5),
  },
  fab: { width: 40, height: 40, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingLeft: space(3.5),
    paddingRight: space(3),
    paddingVertical: 7,
    borderRadius: radius.chip,
    maxWidth: "64%",
  },
  chipBody: { gap: 1 },
  chipTitle: { fontSize: 13.5, fontWeight: "700" },
  chipStatus: { flexDirection: "row", alignItems: "center", gap: 4 },
  chipSub: { fontSize: 10 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", gap: space(2.5), paddingHorizontal: space(8) },
  stageTitle: { fontSize: t.heading, fontWeight: "700", marginTop: space(1) },
  stageSub: { fontSize: t.small, textAlign: "center", lineHeight: 20 },
  badge: { paddingHorizontal: space(3), paddingVertical: 4, borderRadius: radius.chip },
  badgeText: { fontSize: 11, fontWeight: "600" },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    marginHorizontal: space(4),
    paddingLeft: space(3),
    paddingRight: space(2),
    paddingVertical: space(2),
    borderRadius: radius.chip,
    minHeight: 52,
  },
  plus: { width: 26, height: 26, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
  placeholder: { fontSize: 14 },
  placeholderHint: { fontSize: 10.5, marginTop: 1 },
  send: { width: 38, height: 38, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
});
