// NIBI 像素桌宠 · 图集播放器（Skia 最近邻渲染）。
// 素材真源：nibi-pixel-pet 仓（单一数据源 out/pack.json，本仓随 assets/pet/ 快照）。
// 播放纪律（素材规格）：
//   · 64×64 原生格；显示只允许 2×/3×/4× 整数倍（非整数会把 1px 高光吃掉）
//   · 基线 y=58（所有状态共用）
//   · 逐帧时长以 pack.json 为准（连续同帧已合并、ms 不相等，不能匀速 steps）
//   · 状态切换先播 enter-* 过渡（终点帧已对齐目标首帧），再循环目标状态；
//     flying 是唯一没有过渡的状态
// 渲染：必须 Skia + sampling=Nearest——RN 核心 Image 在 Android 恒为双线性，
// 整数倍放大也糊边（2026-11-13 模拟器实拍确认）。绘制区用 clip 收死到当前格，
// 否则相邻帧会从图集里漏出来（同轮实拍：鸟周围出现多余的月亮/碎片）。
// 切换不卡：**全部图集预加载**——原来 useImage 跟着 state 走，换状态时新图未解码
// 会先返回 null（宠物消失半拍再出现），这就是"一卡一卡"的来源。
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Canvas,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  rect,
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

/**
 * 图集键 → 本地资源。
 * 只用浅色一套（app 当前锁 light）；墨夜启用时在这里补 sheets-dark 分支。
 */
const SHEET_SOURCES = {
  idle: require("../../assets/pet/sheets/idle.png"),
  working: require("../../assets/pet/sheets/working.png"),
  done: require("../../assets/pet/sheets/done.png"),
  waiting: require("../../assets/pet/sheets/waiting.png"),
  sleeping: require("../../assets/pet/sheets/sleeping.png"),
  thinking: require("../../assets/pet/sheets/thinking.png"),
  error: require("../../assets/pet/sheets/error.png"),
  carrying: require("../../assets/pet/sheets/carrying.png"),
  flying: require("../../assets/pet/sheets/flying.png"),
  "enter-idle": require("../../assets/pet/sheets/enter-idle.png"),
  "enter-working": require("../../assets/pet/sheets/enter-working.png"),
  "enter-done": require("../../assets/pet/sheets/enter-done.png"),
  "enter-waiting": require("../../assets/pet/sheets/enter-waiting.png"),
  "enter-sleeping": require("../../assets/pet/sheets/enter-sleeping.png"),
  "enter-thinking": require("../../assets/pet/sheets/enter-thinking.png"),
  "enter-error": require("../../assets/pet/sheets/enter-error.png"),
  "enter-carrying": require("../../assets/pet/sheets/enter-carrying.png"),
} as const;

type SheetKey = keyof typeof SHEET_SOURCES;

/**
 * 全部图集一次性预加载（hooks 顺序固定，17 个 useImage 必须逐条写）。
 * 这是"切换不卡"的关键：任何状态下图都已解码，切换只改绘制偏移。
 */
function useAllSheets() {
  const idle = useImage(SHEET_SOURCES.idle);
  const working = useImage(SHEET_SOURCES.working);
  const done = useImage(SHEET_SOURCES.done);
  const waiting = useImage(SHEET_SOURCES.waiting);
  const sleeping = useImage(SHEET_SOURCES.sleeping);
  const thinking = useImage(SHEET_SOURCES.thinking);
  const error = useImage(SHEET_SOURCES.error);
  const carrying = useImage(SHEET_SOURCES.carrying);
  const flying = useImage(SHEET_SOURCES.flying);
  const enterIdle = useImage(SHEET_SOURCES["enter-idle"]);
  const enterWorking = useImage(SHEET_SOURCES["enter-working"]);
  const enterDone = useImage(SHEET_SOURCES["enter-done"]);
  const enterWaiting = useImage(SHEET_SOURCES["enter-waiting"]);
  const enterSleeping = useImage(SHEET_SOURCES["enter-sleeping"]);
  const enterThinking = useImage(SHEET_SOURCES["enter-thinking"]);
  const enterError = useImage(SHEET_SOURCES["enter-error"]);
  const enterCarrying = useImage(SHEET_SOURCES["enter-carrying"]);

  return {
    idle,
    working,
    done,
    waiting,
    sleeping,
    thinking,
    error,
    carrying,
    flying,
    "enter-idle": enterIdle,
    "enter-working": enterWorking,
    "enter-done": enterDone,
    "enter-waiting": enterWaiting,
    "enter-sleeping": enterSleeping,
    "enter-thinking": enterThinking,
    "enter-error": enterError,
    "enter-carrying": enterCarrying,
  } as Record<SheetKey, ReturnType<typeof useImage>>;
}

/** ms 时刻落在图集第几帧（frames 的 ms 是合并后的真实时长）。 */
function frameAt(anim: PetAnim, ms: number): number {
  let acc = 0;
  for (const f of anim.frames) {
    acc += f.ms;
    if (ms < acc) return f.i;
  }
  return anim.frames[anim.frames.length - 1]!.i;
}

/** animations 的 key 与图集文件名一一对应（out/pack.json 的 sheet 字段）。 */
function sheetKeyOf(anim: PetAnim): SheetKey {
  return anim.sheet.replace(/^(sheets|sheets-dark)\//u, "").replace(/\.png$/u, "") as SheetKey;
}

export interface PetViewProps {
  /** 桌宠状态（语义映射见 petStates.ts）。 */
  state: PetStateId;
  /** 显示倍率：只允许 2 / 3 / 4（整数倍最近邻，素材规格硬约束）。 */
  scale?: 2 | 3 | 4;
}

export function PetView({ state, scale = 2 }: PetViewProps) {
  if (!petPack.spec.allowedScales.includes(scale)) {
    throw new Error(`PetView scale 必须是素材规格允许的整数倍 ${petPack.spec.allowedScales.join("/")}`);
  }

  const sheets = useAllSheets();

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

  if (!anim) return null;

  const skImage = sheets[sheetKeyOf(anim)] ?? null;
  // 图已预加载；理论上不会为空，兜底保留一个空占位避免布局跳动
  const w = CELL * scale;
  const h = CELL * scale;

  return (
    <View style={[styles.cell, { width: w, height: h }]}>
      <Canvas style={styles.canvas}>
        <Group clip={rect(0, 0, w, h)}>
          {skImage ? (
            <SkiaImage
              image={skImage}
              x={-frameIdx * w}
              y={0}
              width={anim.frameCount * w}
              height={h}
              fit="cover"
              sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
            />
          ) : null}
        </Group>
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
