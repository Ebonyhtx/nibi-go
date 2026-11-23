// 窗口尺寸类与栏位计划（Material 3 compact/medium/expanded + 矮窗横屏规则 + 平板/宽屏辅助尺寸）。
//
// 两条核心几何判断：
// 1. 断点用短边：compact (<600) / medium (600–839) / expanded (>=840)，**并且**
//    窗口高度 < 480 时一律当 compact（手机横屏 915×412 虽然宽，但状态栏 + 顶栏 + 输入栏 +
//    键盘吃掉一半高度，单列居中才留得住可视区）。
// 2. 侧栏能不能常驻看正文还剩多少：正文必须保留 bodyComfort (=600)，否则退成 rail，
//    并由 overlay 抽屉承接会话列表（绝不出现 840–919dp 死胡同）。
//
// 纯函数部分无 RN 依赖，单测直接穷举所有断点；钩子辅助留在底部便于二级页复用。

export type WindowClass = "compact" | "medium" | "expanded";

/** 所有 Modal 共用的支持方向列表（确保 iPadOS / Android 平板与横屏不锁竖屏）。 */
export const SUPPORTED_MODAL_ORIENTATIONS = [
  "portrait",
  "portrait-upside-down",
  "landscape",
  "landscape-left",
  "landscape-right",
] as const;

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

/** 栏宽与边距（逻辑像素）。 */
export const METRICS = {
  key: 44,
  edge: 12,
  gap: 8,
  /** 12 + 44 + 12 */
  railWidth: 68,
  /** 侧栏与抽屉统一宽度，跨形态阅读密度一致 */
  sidebarWidth: 320,
  /** 正文最窄不能低于一台手机 */
  bodyMin: 400,
  /** 侧栏常驻后正文仍要有这个宽度 */
  bodyComfort: 600,
  /** 正文阅读上限（居中留白，别让输入栏横跨 1000px） */
  bodyMax: 760,
  /** 宽屏底部弹层最大宽（平板居中，不贴全屏 1200dp） */
  sheetMax: 600,
  /** 二级页（市场/插件/设置）平板居中最大宽 */
  secondaryMax: 820,
} as const;

export interface AdaptiveLayout {
  windowClass: WindowClass;
  /** 手机横屏：宽够但矮，版式要横向摊开并在键盘弹出时收起次要浮层 */
  landscapeCompact: boolean;
  /** 平板或宽屏桌面形态 */
  isWide: boolean;
  left: LeftPane;
  menuAction: MenuAction;
  /** 左栏占位（含系统 inset 之前的逻辑宽度） */
  leftWidth: number;
  /** 正文可用宽度 */
  bodyWidth: number;
  /** 正文内容最大宽度（居中） */
  bodyMaxWidth: number;
  /** 抽屉建议宽度 */
  drawerWidth: number;
  /** 右侧工作区面板建议宽度 */
  workspacePanelWidth: number;
  /** 底部弹层建议最大宽 */
  sheetMaxWidth: number;
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
  const isWide = width >= 700 && height >= BREAKPOINTS.compactHeightMax;

  const bodyMaxWidth = Math.min(METRICS.bodyMax, width);
  const drawerWidth = Math.min(METRICS.sidebarWidth, Math.round(width * 0.82));
  const workspacePanelWidth =
    windowClass === "expanded"
      ? Math.min(440, Math.round(width * 0.44))
      : width >= BREAKPOINTS.mediumMin
        ? Math.min(400, Math.round(width * 0.62))
        : Math.min(360, Math.round(width * 0.88));
  const sheetMaxWidth = width >= 700 ? Math.min(METRICS.sheetMax, width - 32) : width;

  if (windowClass !== "expanded") {
    return {
      windowClass,
      landscapeCompact,
      isWide,
      left: "none",
      menuAction: "overlay",
      leftWidth: 0,
      bodyWidth: width,
      bodyMaxWidth,
      drawerWidth,
      workspacePanelWidth,
      sheetMaxWidth,
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
    isWide,
    left,
    menuAction: left === "sidebar" ? "collapse" : sidebarFits ? "expand" : "overlay",
    leftWidth,
    bodyWidth: width - leftWidth,
    bodyMaxWidth,
    drawerWidth,
    workspacePanelWidth,
    sheetMaxWidth,
    sidebarFits,
  };
}
