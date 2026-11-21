// 子代理的瓦片脸（对齐桌面 workflow-timeline/WorkflowAgentFace）：应用图标的
// 圆角方块去掉 Z，加上两只眼。消息流的子代理卡共用这一张脸。
//
// 身份是机身色：九个固定 HEX 按名字散列取（31 进制取模映射到九色板，与桌面
// avatarColor 同一算法）。状态定义表情（眼型），运行中每 1.6s 眨一次眼。
// 桌面是 SVG；这里用 Skia 画近似几何（20 格网格，眼在 cx 7/13，宽 4），
// 表情用直线折线近似（视觉读感一致，避免椭圆弧的平台差异）。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Canvas,
  Circle,
  Group,
  Path,
  RoundedRect,
  Skia,
} from "@shopify/react-native-skia";

/** 九色机身（桌面 FACE_COLORS 原样）。 */
export const FACE_COLORS = [
  "#54B9A6",
  "#F19D38",
  "#6464EF",
  "#885CF5",
  "#3C82F6",
  "#ED712E",
  "#EB4699",
  "#5BC67A",
  "#EA4045",
] as const;

/** 名字散列选色（与桌面 avatarColor 同算法：31 进制取模 360 后映射九色板）。 */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return FACE_COLORS[hash % FACE_COLORS.length]!;
}

export type AgentFaceStatus = "running" | "completed" | "failed" | "cancelled" | "waiting";

type Expression = "dots" | "happy" | "sleepy" | "focused" | "sad" | "confused";

/** 状态 → 眼型（桌面 EXPRESSIONS 的子集映射）。 */
function expressionOf(status: AgentFaceStatus): Expression {
  switch (status) {
    case "running":
      return "focused";
    case "completed":
      return "happy";
    case "failed":
      return "sad";
    case "cancelled":
      return "sleepy";
    case "waiting":
      return "confused";
  }
}

/** 折线点列（cx 为眼的左缘，20 格坐标系）。 */
function eyePoints(cx: number, expression: Expression): [number, number][] {
  switch (expression) {
    case "happy":
      // 笑眼：^ 形上凸。
      return [
        [cx, 10],
        [cx + 1, 7.5],
        [cx + 3, 7.5],
        [cx + 4, 10],
      ];
    case "sleepy":
      // 困眼：v 形下凸。
      return [
        [cx, 7.5],
        [cx + 1, 9],
        [cx + 3, 9],
        [cx + 4, 7.5],
      ];
    case "sad":
      // 垂眼：倒 v。
      return [
        [cx, 9],
        [cx + 1, 7.5],
        [cx + 3, 7.5],
        [cx + 4, 9],
      ];
    default:
      return [
        [cx, 6],
        [cx + 4, 6],
        [cx + 4, 10],
        [cx, 10],
      ];
  }
}

interface EyeProps {
  cx: number;
  closed: boolean;
  expression: Expression;
  eye: string;
}

/** 一只眼：闭眼画一条细线；dots 是圆点；focused/confused 是竖圆角矩形；其余折线实心。 */
function Eye({ cx, closed, expression, eye }: EyeProps) {
  if (closed) {
    const lid = Skia.PathBuilder.Make()
      .moveTo(cx, 8)
      .lineTo(cx + 4, 8)
      .build();
    return <Path path={lid} color={eye} style="fill" />;
  }
  if (expression === "dots") {
    return <Circle cx={cx + 2} cy={8} r={1.6} color={eye} />;
  }
  if (expression === "focused" || expression === "confused") {
    const short = expression === "confused";
    return (
      <RoundedRect
        x={cx}
        y={short ? 8 : 6}
        width={4}
        height={short ? 4 : 6}
        r={2}
        color={eye}
        style="fill"
      />
    );
  }
  const points = eyePoints(cx, expression);
  let builder = Skia.PathBuilder.Make().moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) builder = builder.lineTo(x, y);
  return <Path path={builder.close().build()} color={eye} style="fill" />;
}

/** 状态徽标的填充色（语义色，与悬浮气泡 done/failed 同源）。 */
const BADGE_COLORS = {
  running: "#f19d38",
  completed: "#34c26b",
  failed: "#ea4045",
  cancelled: "#8a8f98",
  waiting: "#f19d38",
} as const;

/** 白色小记号（✓ / ✕ / 一）的笔画路径；运行中不画记号只有一个点。 */
function badgeGlyph(cx: number, cy: number, r: number, status: AgentFaceStatus) {
  const builder = Skia.PathBuilder.Make();
  if (status === "completed") {
    builder.moveTo(cx - r * 0.42, cy + r * 0.05).lineTo(cx - r * 0.08, cy + r * 0.42).lineTo(cx + r * 0.5, cy - r * 0.38);
  } else if (status === "failed") {
    builder.moveTo(cx - r * 0.4, cy - r * 0.4).lineTo(cx + r * 0.4, cy + r * 0.4);
    builder.moveTo(cx + r * 0.4, cy - r * 0.4).lineTo(cx - r * 0.4, cy + r * 0.4);
  } else {
    builder.moveTo(cx - r * 0.42, cy).lineTo(cx + r * 0.42, cy);
  }
  return builder.build();
}

/**
 * 右下角状态徽标：完成后打绿勾、失败打红叉、取消打灰杠、运行中是琥珀点
 * （带脉动）。白描边把徽标从任何机身色/卡片底上剥出来。
 */
function StatusBadge({
  status,
  size,
  pulse,
}: {
  status: AgentFaceStatus;
  size: number;
  pulse: number;
}) {
  const cx = size * 0.8;
  const cy = size * 0.8;
  const r = size * 0.21;
  const dot = status === "running" || status === "waiting";
  const glyph = dot ? undefined : badgeGlyph(cx, cy, r, status);
  return (
    <Group
      transform={
        dot && pulse > 1 ? [{ translate: [cx, cy] }, { scale: pulse }, { translate: [-cx, -cy] }] : undefined
      }
    >
      <Circle cx={cx} cy={cy} r={r + size * 0.045} color="#ffffff" opacity={0.92} />
      <Circle cx={cx} cy={cy} r={r} color={BADGE_COLORS[status]} />
      {glyph ? (
        <Path path={glyph} color="#ffffff" style="stroke" strokeWidth={r * 0.34} strokeCap="round" strokeJoin="round" />
      ) : null}
    </Group>
  );
}

/**
 * 瓦片脸：size 是显示像素（脸本体 20 格按比例缩放）。running 时眨眼
 * （180ms 闭 / 1.4s 开循环）并轻微呼吸（三档缩放循环）；其余状态睁眼。
 * badge=true 时右下角画状态徽标（完成勾/失败叉/运行脉动点）——小尺寸下
 * 只靠眼型读不出完成与否，徽标让状态一眼可辨。
 */
export function AgentFace({
  name,
  status,
  size = 20,
  badge = false,
}: {
  name: string;
  status: AgentFaceStatus;
  size?: number;
  /** 右下角状态徽标（子代理卡与 Agent 工具行开；悬浮球等纯脸场景不开）。 */
  badge?: boolean;
}) {
  const body = useMemo(() => avatarColor(name), [name]);
  const expression = expressionOf(status);
  const [blink, setBlink] = useState(false);
  const [breath, setBreath] = useState(0);
  const running = status === "running";
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!running) {
      setBlink(false);
      setBreath(0);
      return;
    }
    timer.current = setInterval(() => {
      // 一拍 = 眨一次眼 + 呼吸档位推进（1→1.04→1.08→1.04→1）。
      setBlink(true);
      setTimeout(() => setBlink(false), 180);
      setBreath((value) => (value + 1) % 4);
    }, 1_400);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running]);
  const closed = blink || expression === "sleepy";
  const eye = "#ffffff";
  const scale = running ? [1, 1.03, 1.06, 1.03][breath] ?? 1 : 1;
  // 运行中徽标跟呼吸错拍脉动（幅度更大，远处也读得到「还在跑」）。
  const pulse = running ? [1, 1.16, 1.3, 1.16][breath] ?? 1 : 1;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: (size / 20) * scale }, { translate: [10 * (1 - scale), 10 * (1 - scale)] }]}>
        <RoundedRect x={0} y={0} width={20} height={20} r={4} color={body} style="fill" />
        <Eye cx={7} closed={closed} expression={expression} eye={eye} />
        <Eye cx={13} closed={closed} expression={expression} eye={eye} />
      </Group>
      {badge ? <StatusBadge status={status} size={size} pulse={pulse} /> : null}
    </Canvas>
  );
}
