// 极简线性图标（Skia 路径手绘，不引图标字体/新原生依赖）。
// 24×24 设计网格，round cap；只覆盖 GO 主体 + 抽屉用到的集合。
import { Canvas, Circle, Group, Path } from "@shopify/react-native-skia";

export type IconName =
  | "menu"
  | "plus"
  | "arrow-up"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "refresh"
  | "monitor"
  | "phone"
  | "sliders"
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
  | "check";

export interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, color, strokeWidth = 1.8 }: IconProps) {
  const s = size / 24; // 24 网格 → 目标尺寸
  const paint = {
    color,
    style: "stroke" as const,
    strokeWidth: strokeWidth / s,
    strokeCap: "round" as const,
    strokeJoin: "round" as const,
  };
  const ring = { color, style: "stroke" as const, strokeWidth: strokeWidth / s };

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: s }]}>
        {name === "menu" ? (
          <Path path="M4 7H20M4 12H20M4 17H20" {...paint} />
        ) : name === "plus" ? (
          <Path path="M12 5V19M5 12H19" {...paint} />
        ) : name === "arrow-up" ? (
          <Path path="M12 19V6M6.5 11.5L12 6L17.5 11.5" {...paint} />
        ) : name === "chevron-right" ? (
          <Path path="M9.5 6L15.5 12L9.5 18" {...paint} />
        ) : name === "chevron-left" ? (
          <Path path="M14.5 6L8.5 12L14.5 18" {...paint} />
        ) : name === "chevron-down" ? (
          <Path path="M6 9.5L12 15.5L18 9.5" {...paint} />
        ) : name === "refresh" ? (
          <>
            <Path path="M20 12a8 8 0 11-2.3-5.7" {...paint} />
            <Path path="M20.5 3.5V8H16" {...paint} />
          </>
        ) : name === "monitor" ? (
          <>
            <Path path="M3.5 5.5H20.5V16.5H3.5Z" {...paint} />
            <Path path="M12 16.5V20M8 20H16" {...paint} />
          </>
        ) : name === "phone" ? (
          <Path path="M8.5 3.5H15.5V20.5H8.5Z" {...paint} />
        ) : name === "sliders" ? (
          <>
            <Path path="M4 8H20M4 16H20" {...paint} />
            <Circle cx={9} cy={8} r={2.3} {...ring} />
            <Circle cx={15} cy={16} r={2.3} {...ring} />
          </>
        ) : name === "puzzle" ? (
          <Path path="M12 3.5L20.5 12L12 20.5L3.5 12Z" {...paint} />
        ) : name === "search" ? (
          <>
            <Circle cx={11} cy={11} r={6.2} {...ring} />
            <Path path="M15.6 15.6L20 20" {...paint} />
          </>
        ) : name === "x" ? (
          <Path path="M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5" {...paint} />
        ) : name === "archive" ? (
          <>
            <Path path="M3.5 4.5H20.5V7.5H3.5Z" {...paint} />
            <Path path="M5 7.5V19.5H19V7.5" {...paint} />
            <Path path="M9.5 11.5H14.5" {...paint} />
          </>
        ) : name === "trash" ? (
          <>
            <Path path="M4.5 7H19.5M9.5 3.8H14.5M6.5 7L7.6 20H16.4L17.5 7" {...paint} />
            <Path path="M10.4 10.8V16.6M13.6 10.8V16.6" {...paint} />
          </>
        ) : name === "ellipsis" ? (
          <>
            <Circle cx={6} cy={12} r={1.25} color={color} />
            <Circle cx={12} cy={12} r={1.25} color={color} />
            <Circle cx={18} cy={12} r={1.25} color={color} />
          </>
        ) : name === "shield" ? (
          <Path path="M12 3.2L19 6V11.4C19 15.8 16 19 12 20.8C8 19 5 15.8 5 11.4V6Z" {...paint} />
        ) : name === "question" ? (
          <>
            <Circle cx={12} cy={12} r={8.5} {...ring} />
            <Path path="M9.6 9.3A2.6 2.6 0 0114.7 11.4C14.7 13 12 13 12 14.6" {...paint} />
            <Circle cx={12} cy={17.4} r={0.9} color={color} />
          </>
        ) : name === "sparkles" ? (
          <>
            <Path path="M12 3.5L13.6 8.4L18.5 10L13.6 11.6L12 16.5L10.4 11.6L5.5 10L10.4 8.4Z" {...paint} />
            <Path path="M18.5 15.2L19.2 17.3L21.3 18L19.2 18.7L18.5 20.8L17.8 18.7L15.7 18L17.8 17.3Z" {...paint} />
          </>
        ) : name === "globe" ? (
          <>
            <Circle cx={12} cy={12} r={8.5} {...ring} />
            <Path path="M3.5 12H20.5" {...paint} />
            <Path path="M12 3.5C15.5 6 15.5 18 12 20.5C8.5 18 8.5 6 12 3.5Z" {...paint} />
          </>
        ) : name === "image" ? (
          <>
            <Path path="M4 5H20V19H4Z" {...paint} />
            <Circle cx={9} cy={9.5} r={1.6} {...paint} />
            <Path path="M5.5 17L10 12.5L13.5 16L16 13.5L19 16.5" {...paint} />
          </>
        ) : name === "doc" ? (
          <>
            <Path path="M6 3.5H14L18 7.5V20.5H6Z" {...paint} />
            <Path path="M14 3.5V7.5H18M9 12H15M9 15.5H15" {...paint} />
          </>
        ) : name === "clock" ? (
          <>
            <Circle cx={12} cy={12} r={8.5} {...ring} />
            <Path path="M12 7.5V12L15.2 14" {...paint} />
          </>
        ) : name === "check" ? (
          <Path path="M5 12.5L10 17.5L19 7.5" {...paint} />
        ) : name === "quote" ? (
          <>
            <Path path="M5 11.5C5 8.5 7 6.5 10 6.5M5 11.5H9.5V16H5ZM14.5 11.5C14.5 8.5 16.5 6.5 19.5 6.5M14.5 11.5H19V16H14.5Z" {...paint} />
          </>
        ) : (
          <Path path="M16.8 3.6L20.4 7.2L8.6 19L4 20L5 15.4Z" {...paint} />
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
