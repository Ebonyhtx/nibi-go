// NIBI 像素桌宠 · 图集播放器（Skia 最近邻渲染）。
// 素材真源：nibi-pixel-pet 仓（单一数据源 out/pack.json，本仓随 assets/pet/ 快照）。
// 播放纪律（素材规格）：64×64 原生格；显示只允许 2×/3×/4× 整数倍（非整数会把
// 1px 高光吃掉）；基线 y=58（所有状态共用，调用方把容器底边对齐摆放即可）；
// 逐帧时长以 pack.json 为准（连续同帧已合并、ms 不相等，不能匀速 steps）。
// 状态机：states[x].enter 过渡先播一遍（终点帧已对齐目标状态首帧），随后循环
// 状态本身；flying 是唯一没有过渡的状态（直接切）。
// 渲染必须走 Skia 且 sampling=Nearest：RN 核心 Image 在 Android 上恒为双线性，
// 整数倍放大也会糊边（2026-11-13 模拟器实拍确认）。
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Canvas,
  FilterMode,
  Image as SkiaImage,
  MipmapMode,
  useImage,
} from "@shopify/react-native-skia";

import petPackRaw from "../../assets/pet/pack.json";

interface PetAnimFrames {
  i: number;
  ms: number;
}

interface PetAnim {
  sheet: string;
  sheetDark: string;
  frames: PetAnimFrames[];
  frameCount: number;
  totalMs: number;
  loop: boolean;
}

interface PetPack {
  spec: {
    canvas: { w: number; h: number };
    cell: { w: number; h: number };
    baseline: number;
    allowedScales: number[];
  };
  states: { id: PetStateId; label: string; enter: string | null }[];
  animations: Record<string, PetAnim>;
}

export type PetStateId =
  | "idle"
  | "working"
  | "done"
  | "waiting"
  | "sleeping"
  | "thinking"
  | "error"
  | "carrying"
  | "flying";

const petPack = petPackRaw as PetPack;
const CELL = petPack.spec.cell.w;
const BASELINE = petPack.spec.baseline;

const SHEETS: Record<string, { light: number; dark: number }> = {
  idle: {
    light: require("../../assets/pet/sheets/idle.png"),
    dark: require("../../assets/pet/sheets-dark/idle.png"),
  },
  working: {
    light: require("../../assets/pet/sheets/working.png"),
    dark: require("../../assets/pet/sheets-dark/working.png"),
  },
  done: {
    light: require("../../assets/pet/sheets/done.png"),
    dark: require("../../assets/pet/sheets-dark/done.png"),
  },
  waiting: {
    light: require("../../assets/pet/sheets/waiting.png"),
    dark: require("../../assets/pet/sheets-dark/waiting.png"),
  },
  sleeping: {
    light: require("../../assets/pet/sheets/sleeping.png"),
    dark: require("../../assets/pet/sheets-dark/sleeping.png"),
  },
  thinking: {
    light: require("../../assets/pet/sheets/thinking.png"),
    dark: require("../../assets/pet/sheets-dark/thinking.png"),
  },
  error: {
    light: require("../../assets/pet/sheets/error.png"),
    dark: require("../../assets/pet/sheets-dark/error.png"),
  },
  carrying: {
    light: require("../../assets/pet/sheets/carrying.png"),
    dark: require("../../assets/pet/sheets-dark/carrying.png"),
  },
  flying: {
    light: require("../../assets/pet/sheets/flying.png"),
    dark: require("../../assets/pet/sheets-dark/flying.png"),
  },
  "enter-idle": {
    light: require("../../assets/pet/sheets/enter-idle.png"),
    dark: require("../../assets/pet/sheets-dark/enter-idle.png"),
  },
  "enter-working": {
    light: require("../../assets/pet/sheets/enter-working.png"),
    dark: require("../../assets/pet/sheets-dark/enter-working.png"),
  },
  "enter-done": {
    light: require("../../assets/pet/sheets/enter-done.png"),
    dark: require("../../assets/pet/sheets-dark/enter-done.png"),
  },
  "enter-waiting": {
    light: require("../../assets/pet/sheets/enter-waiting.png"),
    dark: require("../../assets/pet/sheets-dark/enter-waiting.png"),
  },
  "enter-sleeping": {
    light: require("../../assets/pet/sheets/enter-sleeping.png"),
    dark: require("../../assets/pet/sheets-dark/enter-sleeping.png"),
  },
  "enter-thinking": {
    light: require("../../assets/pet/sheets/enter-thinking.png"),
    dark: require("../../assets/pet/sheets-dark/enter-thinking.png"),
  },
  "enter-error": {
    light: require("../../assets/pet/sheets/enter-error.png"),
    dark: require("../../assets/pet/sheets-dark/enter-error.png"),
  },
  "enter-carrying": {
    light: require("../../assets/pet/sheets/enter-carrying.png"),
    dark: require("../../assets/pet/sheets-dark/enter-carrying.png"),
  },
};

/** ms 时刻落在图集第几帧（frames 的 ms 是合并后的真实时长）。 */
function frameAt(anim: PetAnim, ms: number): number {
  let acc = 0;
  for (const f of anim.frames) {
    acc += f.ms;
    if (ms < acc) return f.i;
  }
  return anim.frames[anim.frames.length - 1]!.i;
}

export interface PetViewProps {
  /** 桌宠状态（语义映射见 petStates.ts）。 */
  state: PetStateId;
  /** 显示倍率：只允许 2 / 3 / 4（整数倍最近邻，素材规格硬约束）。 */
  scale?: 2 | 3 | 4;
  /** 深色图集（应用当前锁浅色，Phase C 墨夜启用）。 */
  dark?: boolean;
}

export function PetView({ state, scale = 3, dark = false }: PetViewProps) {
  if (!petPack.spec.allowedScales.includes(scale)) {
    throw new Error(`PetView scale 必须是素材规格允许的整数倍 ${petPack.spec.allowedScales.join("/")}`);
  }

  const stateDef = petPack.states.find((s) => s.id === state);
  const enterId = stateDef?.enter ?? null;
  const enterAnim = enterId ? petPack.animations[enterId] : undefined;
  const loopAnim = petPack.animations[state] as PetAnim | undefined;

  // 状态切换回到过渡相位；flying（无过渡）直接进循环。
  const [phase, setPhase] = useState<"enter" | "loop">(enterAnim ? "enter" : "loop");
  useEffect(() => {
    setPhase(enterAnim ? "enter" : "loop");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const anim = phase === "enter" && enterAnim ? enterAnim : loopAnim;

  const [frameIdx, setFrameIdx] = useState(0);
  const startRef = useRef(-1);
  const frameRef = useRef(0);
  useEffect(() => {
    if (!anim) return;
    // 图集/相位切换：帧序号归零（不同图集的帧空间互不连续）
    frameRef.current = 0;
    setFrameIdx(0);
    let raf = 0;
    startRef.current = -1;
    const tick = (t: number) => {
      if (startRef.current < 0) startRef.current = t;
      const elapsed = t - startRef.current;
      if (phase === "enter" && enterAnim && elapsed >= enterAnim.totalMs) {
        // 过渡播完（总时长一次），切目标状态循环
        setPhase("loop");
        return;
      }
      const anim_ = anim as PetAnim;
      const ms = anim_.loop ? elapsed % anim_.totalMs : Math.min(elapsed, anim_.totalMs - 1);
      // 只在帧序号真变化时 setState：源动画 20fps，避免每个 vsync 都触发 React 重渲染
      const next = frameAt(anim_, ms);
      if (next !== frameRef.current) {
        frameRef.current = next;
        setFrameIdx(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim, phase, enterAnim]);

  const source = useMemo(() => {
    if (!anim) return undefined;
    const pair = SHEETS[anim.sheet.replace(/^(sheets|sheets-dark)\//u, "").replace(/\.png$/u, "")];
    return dark ? pair?.dark : pair?.light;
  }, [anim, dark]);

  const skImage = useImage(source);

  if (!anim || !skImage) return null;

  return (
    <View style={[styles.cell, { width: CELL * scale, height: CELL * scale }]}>
      <Canvas style={styles.canvas}>
        <SkiaImage
          image={skImage}
          x={-frameIdx * CELL * scale}
          y={0}
          width={anim.frameCount * CELL * scale}
          height={CELL * scale}
          fit="cover"
          sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
        />
      </Canvas>
    </View>
  );
}

/** 素材基线（脚线 y=58，所有状态共用）——跨状态摆放时对齐用。 */
export const PET_BASELINE = BASELINE;
/** 原生格尺寸（64）。 */
export const PET_CELL = CELL;

const styles = StyleSheet.create({
  cell: { overflow: "hidden" },
  canvas: { flex: 1 },
});
