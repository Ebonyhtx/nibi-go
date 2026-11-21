// 极简线性图标（Skia 路径手绘，不引图标字体/新原生依赖）—— 2.0 重绘版。
// 纪律：24×24 设计网格、默认 2px 圆头笔画（小尺寸按比例加粗做光学补偿）、
// 全集同一套几何语言（圆角方框、统一 chevron 张角、统一端点留白）。
// 语义纪律（运营者 2026-11-21：设置与管理不能混）：设置=gear、项目/管理=folder、
// 调节类=sliders、通用工具=wrench、插件=plug；同一字形不承担两种语义。
// 集合只覆盖 GO 主体 + 抽屉/弹层用到的图标；新图标先加进 IconName 再画路径。
import { Canvas, Circle, Group, Path } from "@shopify/react-native-skia";

export type IconName =
  | "menu"
  | "plus"
  | "arrow-up"
  | "stop"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "refresh"
  | "monitor"
  | "phone"
  | "sliders"
  | "gear"
  | "folder"
  | "terminal"
  | "checklist"
  | "wrench"
  | "plug"
  | "puzzle"
  | "search"
  | "pen"
  | "archive"
  | "trash"
  | "ellipsis"
  | "shield"
  | "question"
  | "x"
  | "sparkles"
  | "globe"
  | "doc"
  | "image"
  | "clock"
  | "quote"
  | "copy"
  | "check"
  | "sun"
  | "moon"
  | "download"
  | "alert"
  | "info"
  | "bell"
  | "user"
  | "external";

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  /** 显示像素的笔画宽（小尺寸自动在网格上加粗做光学补偿） */
  strokeWidth?: number;
}

/** 每个图标的几何（24 网格坐标系）。统一 2px 圆头笔画；圆圈单独标注。 */
const GLYPHS: Record<
  IconName,
  { paths: string[]; circles?: { cx: number; cy: number; r: number; filled?: boolean }[] }
> = {
  menu: { paths: ["M4 7H20M4 12H20M4 17H20"] },
  plus: { paths: ["M12 5V19M5 12H19"] },
  "arrow-up": { paths: ["M12 19V6M6.5 11.5L12 6L17.5 11.5"] },
  stop: {
    paths: [
      "M8.5 7.5H15.5C16.05 7.5 16.5 7.95 16.5 8.5V15.5C16.5 16.05 16.05 16.5 15.5 16.5H8.5C7.95 16.5 7.5 16.05 7.5 15.5V8.5C7.5 7.95 7.95 7.5 8.5 7.5Z",
    ],
  },
  "chevron-right": { paths: ["M9.5 6L15.5 12L9.5 18"] },
  "chevron-left": { paths: ["M14.5 6L8.5 12L14.5 18"] },
  "chevron-down": { paths: ["M6 9.5L12 15.5L18 9.5"] },
  refresh: {
    paths: ["M20 12a8 8 0 11-2.3-5.7", "M20.5 3.5V8H16"],
  },
  monitor: {
    paths: [
      "M4 5.5H20C20.3 5.5 20.5 5.7 20.5 6V15.5C20.5 15.8 20.3 16 20 16H4C3.7 16 3.5 15.8 3.5 15.5V6C3.5 5.7 3.7 5.5 4 5.5Z",
      "M12 16V20M8 20H16",
    ],
  },
  phone: {
    paths: [
      "M8.5 3.5H15.5C16 3.5 16.5 4 16.5 4.5V19.5C16.5 20 16 20.5 15.5 20.5H8.5C8 20.5 7.5 20 7.5 19.5V4.5C7.5 4 8 3.5 8.5 3.5Z",
      "M10.5 17.5H13.5",
    ],
  },
  sliders: {
    paths: ["M4 8H20M4 16H20"],
    circles: [
      { cx: 9, cy: 8, r: 2.3 },
      { cx: 15, cy: 16, r: 2.3 },
    ],
  },
  /** 设置：齿轮（中心圆孔 + 单线齿圈）。 */
  gear: {
    paths: [
      "M12.22 3h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38c.36.63 1.14.94 1.86.7l.15-.05a2 2 0 012 .28l.28.24a2 2 0 01.73 1.95v.17a2 2 0 002 2h.44a2 2 0 002-2v-.17a2 2 0 01.73-1.95l.28-.24a2 2 0 012-.28l.15.05c.72.24 1.5-.07 1.86-.7l.22-.38a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V5a2 2 0 00-2-2z",
    ],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  /** 项目/管理：文件夹。 */
  folder: {
    paths: [
      "M20 20a2 2 0 002-2V8a2 2 0 00-2-2h-7.9a2 2 0 01-1.69-.9L9.6 3.9A2 2 0 007.93 3H4a2 2 0 00-2 2v13a2 2 0 002 2Z",
    ],
  },
  /** 终端（Bash/PowerShell）。 */
  terminal: { paths: ["M4.5 17L10.5 11L4.5 5", "M12.5 19H19.5"] },
  /** 待办清单（TodoWrite）：两条勾选项。 */
  checklist: {
    paths: ["M3.5 6.5L5 8L7.8 5.2", "M3.5 13.5L5 15L7.8 12.2", "M10.5 6.5H20.5M10.5 13.5H20.5"],
  },
  /** 通用工具（无专属图标的工具兜底）。 */
  wrench: {
    paths: [
      "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
    ],
  },
  /** 插件：插头（原来画成菱形，读不出「插件」）。 */
  plug: {
    paths: [
      "M6.5 8.5H17.5V12.5A4.5 4.5 0 0113 17H11A4.5 4.5 0 016.5 12.5V8.5Z",
      "M9.5 8.5V3.5M14.5 8.5V3.5",
      "M12 17V21",
    ],
  },
  puzzle: { paths: ["M12 3.5L20.5 12L12 20.5L3.5 12Z"] },
  search: {
    paths: ["M15.6 15.6L20 20"],
    circles: [{ cx: 11, cy: 11, r: 6.2 }],
  },
  pen: { paths: ["M16.8 3.6L20.4 7.2L8.6 19L4 20L5 15.4Z"] },
  archive: {
    paths: ["M3.5 4.5H20.5V7.5H3.5Z", "M5 7.5V19.5H19V7.5", "M9.5 11.5H14.5"],
  },
  trash: {
    paths: ["M4.5 7H19.5M9.5 3.8H14.5M6.5 7L7.6 20H16.4L17.5 7", "M10.4 10.8V16.6M13.6 10.8V16.6"],
  },
  ellipsis: {
    paths: [],
    circles: [
      { cx: 6, cy: 12, r: 1.3, filled: true },
      { cx: 12, cy: 12, r: 1.3, filled: true },
      { cx: 18, cy: 12, r: 1.3, filled: true },
    ],
  },
  shield: { paths: ["M12 3.2L19 6V11.4C19 15.8 16 19 12 20.8C8 19 5 15.8 5 11.4V6Z"] },
  question: {
    paths: ["M9.6 9.3A2.6 2.6 0 0114.7 11.4C14.7 13 12 13 12 14.6"],
    circles: [
      { cx: 12, cy: 12, r: 8.5 },
      { cx: 12, cy: 17.4, r: 0.9, filled: true },
    ],
  },
  x: { paths: ["M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5"] },
  sparkles: {
    paths: [
      "M12 3.5L13.6 8.4L18.5 10L13.6 11.6L12 16.5L10.4 11.6L5.5 10L10.4 8.4Z",
      "M18.5 15.2L19.2 17.3L21.3 18L19.2 18.7L18.5 20.8L17.8 18.7L15.7 18L17.8 17.3Z",
    ],
  },
  globe: {
    paths: ["M3.5 12H20.5", "M12 3.5C15.5 6 15.5 18 12 20.5C8.5 18 8.5 6 12 3.5Z"],
    circles: [{ cx: 12, cy: 12, r: 8.5 }],
  },
  image: {
    paths: [
      "M4 5H20C20.3 5 20.5 5.2 20.5 5.5V18.5C20.5 18.8 20.3 19 20 19H4C3.7 19 3.5 18.8 3.5 18.5V5.5C3.5 5.2 3.7 5 4 5Z",
      "M5.5 17L10 12.5L13.5 16L16 13.5L19 16.5",
    ],
    circles: [{ cx: 9, cy: 9.5, r: 1.6 }],
  },
  doc: {
    paths: ["M6 3.5H14L18 7.5V20.5H6Z", "M14 3.5V7.5H18M9 12H15M9 15.5H15"],
  },
  clock: {
    paths: ["M12 7.5V12L15.2 14"],
    circles: [{ cx: 12, cy: 12, r: 8.5 }],
  },
  quote: {
    paths: [
      "M5 11.5C5 8.5 7 6.5 10 6.5M5 11.5H9.5V16H5ZM14.5 11.5C14.5 8.5 16.5 6.5 19.5 6.5M14.5 11.5H19V16H14.5Z",
    ],
  },
  copy: {
    paths: ["M8.5 8.5H19V19H8.5Z", "M15.5 8.5V5.5H5V15.5H8.5"],
  },
  check: { paths: ["M5 12.5L10 17.5L19 7.5"] },
  sun: {
    paths: [
      "M12 2.8V4.6M12 19.4V21.2M21.2 12H19.4M4.6 12H2.8M18.5 5.5L17.2 6.8M6.8 17.2L5.5 18.5M18.5 18.5L17.2 17.2M6.8 6.8L5.5 5.5",
    ],
    circles: [{ cx: 12, cy: 12, r: 4.2 }],
  },
  moon: { paths: ["M20 14.5A8.5 8.5 0 019.5 4A8.5 8.5 0 1020 14.5Z"] },
  download: { paths: ["M12 4V15M7.5 10.5L12 15L16.5 10.5", "M4.5 19.5H19.5"] },
  info: {
    paths: ["M12 11.2V16.4", "M12 7.8V7.9"],
    circles: [{ cx: 12, cy: 12, r: 8.3 }],
  },
  bell: {
    paths: [
      "M12 4.2A5.3 5.3 0 0117.3 9.5V13.2L19 16H5L6.7 13.2V9.5A5.3 5.3 0 0112 4.2Z",
      "M9.8 18.6A2.3 2.3 0 0014.2 18.6",
    ],
  },
  alert: {
    paths: ["M12 4L21 19H3Z", "M12 10V14.5"],
    circles: [{ cx: 12, cy: 17, r: 0.9, filled: true }],
  },
  user: {
    paths: ["M5.5 20C5.5 16.5 8.3 14.5 12 14.5C15.7 14.5 18.5 16.5 18.5 20"],
    circles: [{ cx: 12, cy: 8, r: 3.6 }],
  },
  external: {
    paths: [
      "M14 4.5H19.5V10M19.5 4.5L11 13",
      "M18 13.5V18.5C18 19 17.7 19.5 17 19.5H5.5C5 19.5 4.5 19 4.5 18.5V7C4.5 6.3 5 6 5.5 6H10.5",
    ],
  },
};

export function Icon({ name, size = 20, color, strokeWidth = 2 }: IconProps) {
  const s = size / 24; // 24 网格 → 目标尺寸
  const paint = {
    color,
    style: "stroke" as const,
    strokeWidth: strokeWidth / s,
    strokeCap: "round" as const,
    strokeJoin: "round" as const,
  };
  const glyph = GLYPHS[name];
  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: s }]}>
        {glyph.paths.map((path, index) => (
          <Path key={index} path={path} {...paint} />
        ))}
        {glyph.circles?.map((circle, index) =>
          circle.filled ? (
            <Circle key={`f${index}`} cx={circle.cx} cy={circle.cy} r={circle.r} color={color} />
          ) : (
            <Circle
              key={`s${index}`}
              cx={circle.cx}
              cy={circle.cy}
              r={circle.r}
              color={color}
              style="stroke"
              strokeWidth={strokeWidth / s}
            />
          ),
        )}
      </Group>
    </Canvas>
  );
}

/** 状态点（实心小圆，可选镂空描边表示"离线/挂起"） */
export function Dot({ size = 7, color, ring }: { size?: number; color: string; ring?: string }) {
  return (
    <Canvas style={{ width: size, height: size }}>
      {ring ? (
        <Circle cx={size / 2} cy={size / 2} r={size / 2 - 0.8} color={ring} style="stroke" strokeWidth={1.5} />
      ) : (
        <Circle cx={size / 2} cy={size / 2} r={size / 2} color={color} />
      )}
    </Canvas>
  );
}
