// 设计 token 单一真源（纸上鸟 / 墨夜）。
// 取值对齐 nibi-client packages/ui/src/styles.css（桌面主题真源），
// 结构规则吸收 dsh-Go app/lib/ui/theme/palette.dart：极淡渐变纸面、
// 玻璃面、70/25/≤5 强调色用量纪律（橙只给主 CTA/发送键/选中态/进度）。
// 纪律：屏幕里不再写硬编码色值，一律从 theme 取。
import { useColorScheme } from "react-native";

export interface NibiTheme {
  /** 页面底（无法铺渐变时的中值） */
  bg: string;
  /** 页面竖向渐变（顶 → 底） */
  bgGradient: [string, string];
  /** 顶部暖光（渐变上的极淡染色） */
  glow: string;
  /** 次级面 */
  panel: string;
  /** 卡片 / 玻璃底的实色回退 */
  card: string;
  /** 玻璃面（半透明 + 发丝线，模拟 backdrop blur） */
  glass: string;
  glassBorder: string;

  ink: string;
  inkSub: string;
  inkFaint: string;
  inkGhost: string;

  hairline: string;

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
}

const LIGHT: NibiTheme = {
  bg: "#f9f2e4",
  bgGradient: ["#fef8ec", "#f3e8d3"],
  glow: "rgba(224,138,62,0.10)",
  panel: "#f3ead8",
  card: "#fffdf9",
  glass: "rgba(255,252,246,0.80)",
  glassBorder: "rgba(255,255,255,0.65)",

  ink: "#1c2f4e",
  inkSub: "rgba(28,47,78,0.62)",
  inkFaint: "rgba(28,47,78,0.42)",
  inkGhost: "rgba(28,47,78,0.25)",

  hairline: "rgba(28,47,78,0.10)",

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
};

// 墨夜：深色不用蓝（运营者既定口径），明度取 dsh-Go 的 0.23–0.25 档，不用纯黑。
const DARK: NibiTheme = {
  bg: "#1b1b1c",
  bgGradient: ["#202022", "#141415"],
  glow: "rgba(232,196,145,0.07)",
  panel: "#101011",
  card: "#1b1b1c",
  glass: "rgba(27,27,28,0.86)",
  glassBorder: "rgba(228,230,235,0.10)",

  ink: "#cdced2",
  inkSub: "rgba(205,206,210,0.62)",
  inkFaint: "rgba(205,206,210,0.40)",
  inkGhost: "rgba(205,206,210,0.22)",

  hairline: "rgba(228,230,235,0.13)",

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
};

/** 圆角阶梯（卡片 → 控件 → 胶囊） */
export const radius = {
  card: 18,
  control: 14,
  chip: 999,
} as const;

/** 间距阶梯（4 的倍数） */
export const space = (n: number): number => n * 4;

/** 字号阶梯 */
export const type = {
  title: 20,
  heading: 16,
  body: 14,
  small: 12.5,
  micro: 11,
} as const;

/**
 * 当前主题。App 目前锁浅色（app.json userInterfaceStyle: light），
 * 墨夜随 Phase C 一起开放；这里已按系统偏好返回，切换只需放开 app.json。
 */
export function useNibiTheme(): NibiTheme {
  return useColorScheme() === "dark" ? DARK : LIGHT;
}

export const themes = { light: LIGHT, dark: DARK } as const;
