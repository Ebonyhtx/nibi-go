// GO 主体首页 = 会话即首页（D2 修订）。版式对齐 dsh-Go home_shell / adaptive_scaffold：
//   compact（手机竖屏 / 任何矮窗）→ 浮动 pill 顶栏 + 滑出抽屉
//   medium（600–840）              → 同 compact，正文限宽居中（平板竖屏不至于拉成一条）
//   expanded（≥840）                → 常驻侧栏（或折叠成 rail）+ 居中正文列
// 手机横屏（高 <480）按 compact 处理，但空态舞台横向摊开（鸟左文右），不纵向堆叠。
// Phase C 挂起：空态 + 睡着的鸟 + 灰态输入栏，如实标注。
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GoDrawer, GoRail, GoSidebar } from "../components/GoDrawer";
import { Dot, Icon, ScreenBackground } from "../components/Icon";
import { PetView } from "../components/PetView";
import { PET_STATE } from "../components/petStates";
import { METRICS, resolveAdaptiveLayout } from "../layout/adaptive";
import { radius, space, type as t, useNibiTheme } from "../theme";

export default function GoHomeScreen() {
  const th = useNibiTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const layout = resolveAdaptiveLayout({ width, height, sidebarOpen });
  const petState = PET_STATE.sleeping; // Phase C 挂起：AGENT 无活可干

  const hasSidebar = layout.left === "sidebar";
  const hasRail = layout.left === "rail";
  const inShell = hasSidebar || hasRail;

  // 顶栏 ≡ 键：有侧栏时折叠，有 rail 时展开，否则开抽屉
  const onMenu = () => {
    if (layout.menuAction === "collapse") setSidebarOpen(false);
    else if (layout.menuAction === "expand") setSidebarOpen(true);
    else setDrawerOpen(true);
  };

  const bodyMax = Math.min(layout.bodyMaxWidth, hasSidebar ? layout.bodyWidth - space(8) : layout.bodyMaxWidth);

  return (
    <View style={[styles.root, { backgroundColor: th.bg }]}>
      <ScreenBackground
        width={width}
        height={height}
        top={th.bgGradient[0]}
        bottom={th.bgGradient[1]}
        glow={th.glow}
      />

      <View style={styles.shell}>
        {hasSidebar ? <GoSidebar petState={petState} /> : null}
        {hasRail ? (
          <GoRail
            petState={petState}
            onMenu={() => setSidebarOpen(true)}
            onSearch={() => undefined}
            onSettings={() => undefined}
          />
        ) : null}

        <View style={[styles.body, { paddingRight: insets.right }]}>
          <View style={[styles.bodyInner, { maxWidth: bodyMax }]}>
            {/* 顶栏：rail 模式下 ≡ 由 rail 自带，其余情况给折叠/抽屉键 */}
            <View style={[styles.topbar, { paddingTop: insets.top + space(1) }]}>
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
                    新对话
                  </Text>
                  <View style={styles.chipStatus}>
                    <Dot size={6} color={th.inkGhost} ring={th.inkGhost} />
                    <Text style={[styles.chipSub, { color: th.inkFaint }]}>本机 · 挂起</Text>
                  </View>
                </View>
                <Icon name="chevron-down" size={13} color={th.inkFaint} />
              </View>

              <View style={[styles.modelChip, { backgroundColor: th.glass, borderColor: th.glassBorder }]}>
                <Text style={[styles.modelText, { color: th.inkFaint }]}>NIBI-4 · 高</Text>
                <Icon name="chevron-down" size={12} color={th.inkGhost} />
              </View>

              <View style={styles.flex1} />

              <View
                style={[
                  styles.fab,
                  { backgroundColor: th.glass, borderColor: th.glassBorder, opacity: 0.5 },
                ]}
              >
                <Icon name="pen" size={17} color={th.inkFaint} />
              </View>
            </View>

            {/* 舞台：竖屏纵向、横屏横向摊开 */}
            <View style={[styles.stage, layout.landscapeCompact && styles.stageLandscape]}>
              <View style={[styles.petWrap, layout.landscapeCompact && styles.petWrapLandscape]}>
                <PetView state={petState} scale={layout.landscapeCompact ? 2 : layout.windowClass === "compact" ? 3 : 4} />
                <View style={[styles.petGround, { backgroundColor: th.inkGhost }]} />
              </View>
              <View style={[styles.stageText, layout.landscapeCompact && styles.stageTextLandscape]}>
                <Text style={[styles.stageTitle, { color: th.ink }]}>本机 AGENT 还在装修</Text>
                <Text style={[styles.stageSub, { color: th.inkSub }]}>
                  内核 Phase C 挂起中。启动后，在这里直接跟它说话、派任务、收文件。
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
            </View>

            {/* 输入栏：常规双行（输入 + 控制行）；矮窗（手机横屏）压成单行省高度 */}
            <View
              style={[
                styles.composer,
                layout.landscapeCompact && styles.composerCompact,
                { backgroundColor: th.glass, borderColor: th.glassBorder, marginBottom: insets.bottom + space(2) },
              ]}
            >
              {layout.landscapeCompact ? null : (
                <View style={styles.composerInput}>
                  <Text style={[styles.placeholder, { color: th.inkFaint }]}>给 NIBI 发消息…</Text>
                  <Text style={[styles.placeholderHint, { color: th.inkGhost }]}>内核挂起中 · 暂不能对话</Text>
                </View>
              )}
              <View style={styles.composerRow}>
                <View style={[styles.plus, { backgroundColor: th.panel }]}>
                  <Icon name="plus" size={13} color={th.inkSub} />
                </View>
                {layout.landscapeCompact ? (
                  <Text style={[styles.placeholder, { color: th.inkFaint, flex: 1 }]}>给 NIBI 发消息…</Text>
                ) : null}
                <View style={styles.controlChip}>
                  <Text style={[styles.controlText, { color: th.inkGhost }]}>完全访问</Text>
                  <Icon name="chevron-down" size={11} color={th.inkGhost} />
                </View>
                <View style={styles.controlChip}>
                  <Text style={[styles.controlText, { color: th.inkGhost }]}>NIBI-4 · 高</Text>
                  <Icon name="chevron-down" size={11} color={th.inkGhost} />
                </View>
                {layout.landscapeCompact ? null : <View style={styles.flex1} />}
                <View style={[styles.send, { backgroundColor: th.brand, opacity: 0.4 }]}>
                  <Icon name="arrow-up" size={16} color={th.brandFg} />
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>

      {!inShell ? (
        <GoDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} petState={petState} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  shell: { flex: 1, flexDirection: "row" },
  body: { flex: 1, alignItems: "center" },
  bodyInner: { flex: 1, width: "100%", paddingHorizontal: space(4) },
  flex1: { flex: 1 },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingBottom: space(1.5),
  },
  fab: {
    width: 40,
    height: 40,
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
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingLeft: space(3.5),
    paddingRight: space(3),
    paddingVertical: 7,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "56%",
  },
  chipBody: { gap: 1 },
  chipTitle: { fontSize: 13.5, fontWeight: "700" },
  chipStatus: { flexDirection: "row", alignItems: "center", gap: 4 },
  chipSub: { fontSize: 10 },
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space(3),
    paddingVertical: 8,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modelText: { fontSize: 11.5, fontWeight: "600" },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space(3),
    paddingHorizontal: space(6),
  },
  stageLandscape: {
    flexDirection: "row",
    justifyContent: "center",
    gap: space(8),
    paddingHorizontal: space(4),
  },
  petWrap: { alignItems: "center" },
  petWrapLandscape: { justifyContent: "center" },
  petGround: {
    width: 74,
    height: 6,
    borderRadius: radius.chip,
    opacity: 0.12,
    marginTop: -4,
  },
  stageText: { alignItems: "center", gap: space(2) },
  stageTextLandscape: { alignItems: "flex-start", maxWidth: 340, gap: space(1.5) },
  stageTitle: { fontSize: t.heading, fontWeight: "700" },
  stageSub: { fontSize: t.small, textAlign: "center", lineHeight: 20 },
  stageChips: { flexDirection: "row", gap: space(2), marginTop: space(1) },
  badge: { paddingHorizontal: space(3), paddingVertical: 4, borderRadius: radius.chip },
  badgeText: { fontSize: 11, fontWeight: "600" },
  composer: {
    marginHorizontal: space(1),
    paddingHorizontal: space(3),
    paddingTop: space(2.5),
    paddingBottom: space(2),
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space(2),
    shadowColor: "#1c2f4e",
    shadowOpacity: 0.09,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  composerInput: { gap: 1, paddingHorizontal: space(1) },
  composerCompact: { paddingTop: space(1.5), paddingBottom: space(1.5), gap: 0 },
  placeholder: { fontSize: 14 },
  placeholderHint: { fontSize: 10.5 },
  composerRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  plus: { width: 28, height: 28, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
  controlChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  controlText: { fontSize: 11.5, fontWeight: "600" },
  send: { width: 34, height: 34, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" },
});
