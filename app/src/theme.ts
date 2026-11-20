// 设计 token 单一真源（纸上鸟 2.0 / 墨夜 2.0）。
// 色值对齐 nibi-client packages/ui/src/styles.css（桌面主题真源），
// 结构纪律承自 v4 重设计：70/25/≤5 强调色用量（橙只给主 CTA/发送键/选中态/进度）、
// 极淡渐变纸面、玻璃面 + 发丝线、深色不用蓝/橙、不引入字体、纸纹理不做。
// 2.0 新增：字阶/控件尺寸/圆角 xs、投影阶梯、统一遮罩、动效契约（150/220/320ms），
// 并把外观偏好（跟随系统/浅/深）接进 useNibiTheme——墨夜从「锁浅色」变为可用。
// 纪律：屏幕里不再写硬编码色值/字号/圆角/投影，一律从 theme 取。
import { useColorScheme } from "react-native";

import { useAppearanceMode } from "./appearance/preferences";

export interface NibiTheme {
  /** 页面底（无法铺渐变时的中值） */
  bg: string;
  /** 页面竖向渐变（顶 → 底） */
  bgGradient: [string, string];
  /** 顶部暖光（页面渐变顶端的极淡染色，直接作为 LinearGradient 首段） */
  glowTop: string;
  /** 次级面 */
  panel: string;
  /** 卡片 / 玻璃底的实色回退 */
  card: string;
  /** 比卡片更低一档的实色面（分组内嵌面、输入井） */
  surfaceSoft: string;
  /** 玻璃面（半透明 + 发丝线，模拟 backdrop blur） */
  glass: string;
  glassBorder: string;
  /** 触控悬停面（行按压、chip 按下的底色） */
  hover: string;
  /** 弹层/遮罩（全屏 backdrop，统一一处） */
  backdrop: string;
  /** 弹层遮罩的加深档（沉浸 sheet / 危险确认） */
  backdropStrong: string;

  ink: string;
  inkSub: string;
  inkFaint: string;
  inkGhost: string;

  hairline: string;
  hairlineStrong: string;

  /** 主强调（橙 / 沙金）：只给主 CTA、发送键、选中态 */
  brand: string;
  brandFg: string;
  brandSoft: string;
  /** 次要强调（钢蓝 / 沙金）：WORK 入口、链接、进度 */
  steel: string;
  steelSoft: string;

  ok: string;
  okSoft: string;
  amber: string;
  amberSoft: string;
  red: string;
  redSoft: string;
  violet: string;

  /** 投影阶梯（浅色暖墨投影 / 深色中性投影；Android 走 elevation） */
  elevation: {
    card: ShadowSpec;
    menu: ShadowSpec;
    float: ShadowSpec;
  };
}

/** 一档投影的完整参数（iOS 用 shadow*，Android 用 elevation 数值）。 */
export interface ShadowSpec {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

const LIGHT: NibiTheme = {
  bg: "#f9f2e4",
  bgGradient: ["#fef8ec", "#f3e8d3"],
  glowTop: "#fdf6ea",
  panel: "#f3ead8",
  card: "#fffdf9",
  surfaceSoft: "rgba(28,47,78,0.045)",
  glass: "rgba(255,252,246,0.80)",
  glassBorder: "rgba(255,255,255,0.65)",
  hover: "rgba(28,47,78,0.05)",
  backdrop: "rgba(20,26,36,0.22)",
  backdropStrong: "rgba(20,26,36,0.34)",

  ink: "#1c2f4e",
  inkSub: "rgba(28,47,78,0.62)",
  inkFaint: "rgba(28,47,78,0.42)",
  inkGhost: "rgba(28,47,78,0.25)",

  hairline: "rgba(28,47,78,0.10)",
  hairlineStrong: "rgba(28,47,78,0.18)",

  brand: "#e08a3e",
  brandFg: "#fff9ef",
  brandSoft: "rgba(224,138,62,0.14)",
  steel: "#4a79b8",
  steelSoft: "rgba(74,121,184,0.14)",

  ok: "#3f8f5f",
  okSoft: "rgba(63,143,95,0.14)",
  amber: "#c98a2c",
  amberSoft: "rgba(201,138,44,0.13)",
  red: "#c25b4e",
  redSoft: "rgba(194,91,78,0.12)",
  violet: "#8a6fb0",

  elevation: {
    card: {
      shadowColor: "#1c2f4e",
      shadowOpacity: 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    menu: {
      shadowColor: "#1c2f4e",
      shadowOpacity: 0.14,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    float: {
      shadowColor: "#1c2f4e",
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
  },
};

// 墨夜：深色不用蓝（运营者既定口径），明度取 dsh-Go 的 0.23–0.25 档，不用纯黑。
// 2.0 校准：卡片相对底色抬升一档形成可读层级，投影改中性黑（暖色投影在深色下无效）。
const DARK: NibiTheme = {
  bg: "#1b1b1c",
  bgGradient: ["#202022", "#141415"],
  glowTop: "#232221",
  panel: "#101011",
  card: "#212224",
  surfaceSoft: "rgba(228,230,235,0.05)",
  glass: "rgba(30,31,33,0.86)",
  glassBorder: "rgba(228,230,235,0.10)",
  hover: "rgba(228,230,235,0.07)",
  backdrop: "rgba(0,0,0,0.45)",
  backdropStrong: "rgba(0,0,0,0.62)",

  ink: "#cdced2",
  inkSub: "rgba(205,206,210,0.62)",
  inkFaint: "rgba(205,206,210,0.40)",
  inkGhost: "rgba(205,206,210,0.22)",

  hairline: "rgba(228,230,235,0.13)",
  hairlineStrong: "rgba(228,230,235,0.22)",

  brand: "#e8c491",
  brandFg: "#2a1d0a",
  brandSoft: "rgba(232,196,145,0.16)",
  steel: "#cfa87e",
  steelSoft: "rgba(232,196,145,0.16)",

  ok: "#74b98a",
  okSoft: "rgba(116,185,138,0.16)",
  amber: "#d9a24a",
  amberSoft: "rgba(217,162,74,0.15)",
  red: "#cf7b6e",
  redSoft: "rgba(207,123,110,0.15)",
  violet: "#b79ade",

  elevation: {
    card: {
      shadowColor: "#000000",
      shadowOpacity: 0.30,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    menu: {
      shadowColor: "#000000",
      shadowOpacity: 0.42,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    float: {
      shadowColor: "#000000",
      shadowOpacity: 0.50,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
  },
};

/** 圆角阶梯（xs 小件 → 控件 → 卡片 → 胶囊）。字面量圆角一律收敛到这里。 */
export const radius = {
  xs: 8,
  control: 14,
  card: 18,
  chip: 999,
} as const;

/** 间距阶梯（4 的倍数；允许 0.5 步进用于微调） */
export const space = (n: number): number => n * 4;

/** 字号阶梯（2.0 起屏幕里不再随手写 9–15.5，一律从这里取） */
export const type = {
  title: 20,
  heading: 16,
  bodyLg: 15.5,
  body: 14,
  small: 12.5,
  micro: 11,
} as const;

/** 与字号配对的可读行高 */
const TYPE_LINE: Record<keyof typeof type, number> = {
  title: 26,
  heading: 22,
  bodyLg: 21,
  body: 20,
  small: 17,
  micro: 15,
};

/** 取「字号 + 行高」对：`...text("body")` 展开进 Text 样式。 */
export const text = (name: keyof typeof type): { fontSize: number; lineHeight: number } => ({
  fontSize: type[name],
  lineHeight: TYPE_LINE[name],
});

/** 控件尺寸（顶栏/胶囊/按钮/行——高度字面量一律收敛到这里） */
export const size = {
  topbar: 44,
  chip: 28,
  chipLg: 32,
  button: 38,
  buttonLg: 44,
  row: 52,
} as const;

/** 动效契约（对齐桌面 motion contract：150/220/320ms + standard 贝塞尔；450 只给整页转场） */
export const motion = {
  duration: { fast: 150, base: 220, slow: 320, page: 450 },
  /** 贝塞尔控制点（RN Animated 与 Reanimated 的 Easing.bezier 都吃这组数值） */
  easing: {
    standard: [0.22, 1, 0.36, 1] as const,
    enter: [0.2, 0, 0, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  spring: {
    /** 常规展开（面板/弹层） */
    gentle: { damping: 18, stiffness: 230, mass: 0.6 },
    /** 轻快响应（按钮/小件） */
    snappy: { damping: 18, stiffness: 260, mass: 0.7 },
    /** 明显弹性（宠物/大件入场） */
    bouncy: { damping: 15, stiffness: 210, mass: 0.7 },
  },
} as const;

/**
 * 当前解析后的色板名（"light" | "dark"）：外观偏好优先，其次系统深色。
 * 需要按主题换资源（宠物的 sheets-dark、图标底色）而不仅是取色值时用它。
 */
export function useNibiScheme(): "light" | "dark" {
  const mode = useAppearanceMode();
  const system = useColorScheme();
  if (mode === "light" || mode === "dark") return mode;
  return system === "dark" ? "dark" : "light";
}

/**
 * 当前主题：外观偏好（跟随系统/浅/深）优先，其次系统深色。
 * 墨夜 2.0 起可用——「外观」设置写入偏好，这里即时响应。
 */
export function useNibiTheme(): NibiTheme {
  return useNibiScheme() === "dark" ? DARK : LIGHT;
}

export const themes = { light: LIGHT, dark: DARK } as const;
