// 极简线性图标（Skia 路径手绘，不引图标字体/新原生依赖）。
// 24×24 设计网格，round cap；只覆盖 GO 主体 + 抽屉用到的集合。
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  vec,
} from "@shopify/react-native-skia";

export type IconName =
  | "menu"
  | "plus"
  | "arrow-up"
  | "chevron-right"
  | "chevron-down"
  | "monitor"
  | "phone"
  | "sliders"
  | "puzzle"
  | "search"
  | "pen";

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
        ) : name === "chevron-down" ? (
          <Path path="M6 9.5L12 15.5L18 9.5" {...paint} />
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

/**
 * 页面背景：竖向极淡渐变 + 顶部暖光（dsh-Go palette.dart 的页面渐变口径）。
 * 用 Skia 画，避免为一个背景再引 expo-linear-gradient。
 */
export function ScreenBackground({
  width,
  height,
  top,
  bottom,
  glow,
}: {
  width: number;
  height: number;
  top: string;
  bottom: string;
  glow: string;
}) {
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }}>
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[top, bottom]} />
      </Rect>
      <Rect x={0} y={0} width={width} height={height * 0.45}>
        <RadialGradient
          c={vec(width / 2, 0)}
          r={width * 0.9}
          colors={[glow, "rgba(0,0,0,0)"]}
        />
      </Rect>
    </Canvas>
  );
}
