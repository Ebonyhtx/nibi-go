// 自适应断点与栏位计划的契约测试。
// 规则来源 dsh-Go app/lib/ui/shell/adaptive/adaptive_layout.dart（见 src/layout/adaptive.ts 注释）：
// 短边判类、矮窗一律 compact、侧栏常驻需正文保留 bodyComfort。
import { describe, expect, it } from "vitest";

import { METRICS, resolveAdaptiveLayout, windowClassOf } from "../src/layout/adaptive";

describe("windowClassOf", () => {
  it("手机竖屏 / 平板竖屏 / 平板横屏 分档", () => {
    expect(windowClassOf(400, 800)).toBe("compact");
    expect(windowClassOf(800, 1280)).toBe("medium");
    expect(windowClassOf(1280, 800)).toBe("expanded");
  });

  it("矮窗一律 compact：手机横屏 915×412 不算 expanded", () => {
    expect(windowClassOf(915, 412)).toBe("compact");
    // 即便宽到平板级，高度不足也按手机横屏处理
    expect(windowClassOf(1600, 400)).toBe("compact");
  });
});

describe("resolveAdaptiveLayout", () => {
  it("手机横屏标记 landscapeCompact，便于版式横向摊开", () => {
    const layout = resolveAdaptiveLayout({ width: 915, height: 412 });
    expect(layout.windowClass).toBe("compact");
    expect(layout.landscapeCompact).toBe(true);
    expect(layout.left).toBe("none");
    expect(layout.menuAction).toBe("overlay");
  });

  it("手机竖屏不误判横屏", () => {
    expect(resolveAdaptiveLayout({ width: 400, height: 800 }).landscapeCompact).toBe(false);
  });

  it("medium 档不出现常驻栏，正文仍限宽", () => {
    const layout = resolveAdaptiveLayout({ width: 800, height: 1280 });
    expect(layout.windowClass).toBe("medium");
    expect(layout.left).toBe("none");
    expect(layout.menuAction).toBe("overlay");
    expect(layout.bodyMaxWidth).toBeLessThanOrEqual(METRICS.bodyMax);
  });

  it("expanded 且空间够 → 常驻侧栏 + 折叠动作", () => {
    const layout = resolveAdaptiveLayout({ width: 1280, height: 800 });
    expect(layout.windowClass).toBe("expanded");
    expect(layout.sidebarFits).toBe(true);
    expect(layout.left).toBe("sidebar");
    expect(layout.leftWidth).toBe(METRICS.sidebarWidth);
    expect(layout.menuAction).toBe("collapse");
    expect(layout.bodyWidth).toBe(1280 - METRICS.sidebarWidth);
  });

  it("expanded 但正文保不住 bodyComfort → 退成 rail，≡ 改为开抽屉（上游规则：放不下就不展开）", () => {
    // 900 - 320 = 580 < 600
    const layout = resolveAdaptiveLayout({ width: 900, height: 700 });
    expect(layout.windowClass).toBe("expanded");
    expect(layout.sidebarFits).toBe(false);
    expect(layout.left).toBe("rail");
    expect(layout.leftWidth).toBe(METRICS.railWidth);
    expect(layout.menuAction).toBe("overlay");
  });

  it("expanded 下用户折叠侧栏 → rail", () => {
    const layout = resolveAdaptiveLayout({ width: 1280, height: 800, sidebarOpen: false });
    expect(layout.left).toBe("rail");
    expect(layout.menuAction).toBe("expand");
    expect(layout.sidebarFits).toBe(true);
  });

  it("正文限宽：宽窗不把内容拉满", () => {
    const wide = resolveAdaptiveLayout({ width: 1800, height: 1000 });
    expect(wide.bodyMaxWidth).toBe(METRICS.bodyMax);
    const narrow = resolveAdaptiveLayout({ width: 360, height: 800 });
    expect(narrow.bodyMaxWidth).toBe(360);
  });
});
