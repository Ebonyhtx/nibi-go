// 图标层：@expo/vector-icons 正经图标库（Feather 为主力集，Ionicons/MaterialCommunity
// 补 Feather 缺的语义）。运营者 2026-11-22 明确否决自绘路径——「简陋不好看」；
// 这里只做一件事：把 GO 的语义名映射到库图标，调用方 API（name/size/color）不变。
// 语义纪律不变：设置=gear(settings)、项目/管理=folder、插件=plug、调节=sliders、
// 通用工具=wrench——同一字形不承担两种语义。
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Canvas, Circle } from "@shopify/react-native-skia";

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
  | "eye"
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

type FeatherName = ComponentProps<typeof Feather>["name"];
type IonName = ComponentProps<typeof Ionicons>["name"];
type MciName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/** GO 语义名 → 库图标。feather 为主（24 网格 2px 单线，与原设计语言同源）。 */
const GLYPHS: Record<IconName, { set: "feather" | "ion" | "mci"; name: string }> = {
  menu: { set: "feather", name: "menu" },
  plus: { set: "feather", name: "plus" },
  "arrow-up": { set: "feather", name: "arrow-up" },
  stop: { set: "feather", name: "square" },
  "chevron-right": { set: "feather", name: "chevron-right" },
  "chevron-left": { set: "feather", name: "chevron-left" },
  "chevron-down": { set: "feather", name: "chevron-down" },
  refresh: { set: "feather", name: "refresh-cw" },
  monitor: { set: "feather", name: "monitor" },
  phone: { set: "feather", name: "smartphone" },
  sliders: { set: "feather", name: "sliders" },
  gear: { set: "feather", name: "settings" },
  folder: { set: "feather", name: "folder" },
  terminal: { set: "feather", name: "terminal" },
  checklist: { set: "mci", name: "format-list-checks" },
  wrench: { set: "feather", name: "tool" },
  plug: { set: "mci", name: "power-plug-outline" },
  puzzle: { set: "mci", name: "puzzle-outline" },
  search: { set: "feather", name: "search" },
  pen: { set: "feather", name: "edit-2" },
  eye: { set: "feather", name: "eye" },
  archive: { set: "feather", name: "archive" },
  trash: { set: "feather", name: "trash-2" },
  ellipsis: { set: "feather", name: "more-horizontal" },
  shield: { set: "feather", name: "shield" },
  question: { set: "feather", name: "help-circle" },
  x: { set: "feather", name: "x" },
  sparkles: { set: "ion", name: "sparkles-outline" },
  globe: { set: "feather", name: "globe" },
  doc: { set: "feather", name: "file-text" },
  image: { set: "feather", name: "image" },
  clock: { set: "feather", name: "clock" },
  quote: { set: "mci", name: "format-quote-close" },
  copy: { set: "feather", name: "copy" },
  check: { set: "feather", name: "check" },
  sun: { set: "feather", name: "sun" },
  moon: { set: "feather", name: "moon" },
  download: { set: "feather", name: "download" },
  alert: { set: "feather", name: "alert-triangle" },
  info: { set: "feather", name: "info" },
  bell: { set: "feather", name: "bell" },
  user: { set: "feather", name: "user" },
  external: { set: "feather", name: "external-link" },
};

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  /** 兼容旧调用；字形库的笔画粗细由字体决定，此参数仅占位。 */
  strokeWidth?: number;
}

export function Icon({ name, size = 20, color }: IconProps) {
  const glyph = GLYPHS[name];
  if (glyph.set === "ion") {
    return <Ionicons name={glyph.name as IonName} size={size} color={color} />;
  }
  if (glyph.set === "mci") {
    return <MaterialCommunityIcons name={glyph.name as MciName} size={size} color={color} />;
  }
  return <Feather name={glyph.name as FeatherName} size={size} color={color} />;
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
