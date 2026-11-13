// 窗口尺寸类与栏位计划（移植 dsh-Go app/lib/ui/shell/adaptive/adaptive_layout.dart
// 的几何规则，裁剪掉本项目还没有的「会话详情右栏」）。
//
// 两条来自上游的关键判断，别改：
// 1. 断点用短边：Material 3 的 compact/medium/expanded（600 / 840），**并且**
//    窗口高度 < 480 时一律当 compact——手机横屏（915×412）虽然宽，但状态栏 +
//    顶栏 + 输入栏 + 键盘吃掉一半，并排两栏每栏只剩一条缝；单列居中才留得住宽度。
// 2. 侧栏能不能常驻看正文还剩多少：正文必须保留 chatComfort(=600)，否则退成 rail。
//    面板让位优先于正文（本项目暂无面板，规则保留给将来的对话详情）。
//
// 纯函数：同一份 (宽, 高, 用户折叠选择) 必得同一份计划，UI 各层读同一个值。

export type WindowClass = "compact" | "medium" | "expanded";

/** Material 3 断点 + 矮窗规则。 */
export const BREAKPOINTS = {
  mediumMin: 600,
  expandedMin: 840,
  /** 低于此高度 = 手机横屏，无论多宽都按 compact 处理。 */
  compactHeightMax: 480,
} as const;

export function windowClassOf(width: number, height: number): WindowClass {
  if (height < BREAKPOINTS.compactHeightMax) return "compact";
  if (width >= BREAKPOINTS.expandedMin) return "expanded";
  if (width >= BREAKPOINTS.mediumMin) return "medium";
  return "compact";
}

/** 宽窗左缘放什么。 */
export type LeftPane = "none" | "rail" | "sidebar";

/** ≡ 键在当前布局下的语义。 */
export type MenuAction = "overlay" | "expand" | "collapse";

/** 栏宽与边距（逻辑像素，取值对齐上游 AdaptiveMetrics）。 */
export const METRICS = {
  key: 44,
  edge: 12,
  gap: 8,
  /** 12 + 44 + 12 */
  railWidth: 68,
  /** 与手机抽屉同宽，列表读起来一致 */
  sidebarWidth: 320,
  /** 正文最窄不能低于一台手机 */
  bodyMin: 400,
  /** 侧栏常驻后正文仍要有这个宽度 */
  bodyComfort: 600,
  /** 正文阅读上限（居中留白，别让输入栏横跨 1000px） */
  bodyMax: 760,
} as const;

export interface AdaptiveLayout {
  windowClass: WindowClass;
  /** 手机横屏：宽够但矮，版式要横向摊开而不是纵向堆叠 */
  landscapeCompact: boolean;
  left: LeftPane;
  menuAction: MenuAction;
  /** 左栏占位（含系统 inset 之前的逻辑宽度） */
  leftWidth: number;
  /** 正文可用宽度 */
  bodyWidth: number;
  /** 正文内容最大宽度（居中） */
  bodyMaxWidth: number;
  sidebarFits: boolean;
}

/**
 * 解析当前窗口的栏位计划。
 * @param sidebarOpen 宽窗下用户是否展开侧栏（默认展开；折叠后成 rail）
 */
export function resolveAdaptiveLayout(input: {
  width: number;
  height: number;
  sidebarOpen?: boolean;
}): AdaptiveLayout {
  const { width, height, sidebarOpen = true } = input;
  const windowClass = windowClassOf(width, height);
  const landscapeCompact =
    windowClass === "compact" && width > height && height < BREAKPOINTS.compactHeightMax;

  const bodyMaxWidth = Math.min(METRICS.bodyMax, width);

  if (windowClass !== "expanded") {
    return {
      windowClass,
      landscapeCompact,
      left: "none",
      menuAction: "overlay",
      leftWidth: 0,
      bodyWidth: width,
      bodyMaxWidth,
      sidebarFits: false,
    };
  }

  // 展开档：侧栏常驻的前提是正文还留得住 bodyComfort
  const sidebarFits = width - METRICS.sidebarWidth >= METRICS.bodyComfort;
  const left: LeftPane = sidebarOpen && sidebarFits ? "sidebar" : "rail";
  const leftWidth = left === "sidebar" ? METRICS.sidebarWidth : METRICS.railWidth;

  return {
    windowClass,
    landscapeCompact: false,
    left,
    menuAction: left === "sidebar" ? "collapse" : sidebarFits ? "expand" : "overlay",
    leftWidth,
    bodyWidth: width - leftWidth,
    bodyMaxWidth,
    sidebarFits,
  };
}
