// NIBI 像素桌宠 · 图集播放器（Skia 最近邻渲染）。
// 素材真源：nibi-pixel-pet 仓（单一数据源 out/pack.json，本仓随 assets/pet/ 快照）。
//
// 播放纪律（素材规格）：
//   · 64×64 原生格；逐帧时长以 pack.json 为准（连续同帧已合并、ms 不相等，不能匀速 steps）
//   · 基线 y=58（所有状态共用）
//   · 状态切换先播 enter-* 过渡（终点帧已对齐目标首帧），再循环目标状态；flying 无过渡
//
// 尺寸：**按设备像素取整数倍**。素材要求整数倍最近邻，但 dp×density 通常不是整数
// （1080×2400@420dpi = 2.625），所以这里反过来算：先定目标 dp，再取最接近的整数倍
// M，实际 dp 尺寸 = 64·M / density —— 这样设备像素上每格正好 M 个像素，既不糊也不虚胖。
//
// 渲染：Skia + sampling=Nearest（RN 核心 Image 在 Android 恒双线性，整数倍也糊边），
// 并用 Group clip 收死到当前格（否则相邻帧从图集漏出）。
// 全部图集一次性预加载：useImage 跟着 state 走时，换状态新图未解码会返回 null，
// 宠物会先消失半拍再出现（"一卡一卡"的来源之一）。
// 省电/无障碍：系统开启"降低动画"时只画静态帧，不持续重绘。
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, PixelRatio, StyleSheet, View } from "react-native";
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
import { useNibiScheme } from "../theme";

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

/** 图集键 → 本地资源（浅色套）。墨夜套在 SHEET_SOURCES_DARK，按当前色板选。 */
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

/** 图集键 → 墨夜套资源（与浅色套一一对应；缺项回落到浅色套）。 */
const SHEET_SOURCES_DARK = {
  idle: require("../../assets/pet/sheets-dark/idle.png"),
  working: require("../../assets/pet/sheets-dark/working.png"),
  done: require("../../assets/pet/sheets-dark/done.png"),
  waiting: require("../../assets/pet/sheets-dark/waiting.png"),
  sleeping: require("../../assets/pet/sheets-dark/sleeping.png"),
  thinking: require("../../assets/pet/sheets-dark/thinking.png"),
  error: require("../../assets/pet/sheets-dark/error.png"),
  carrying: require("../../assets/pet/sheets-dark/carrying.png"),
  flying: require("../../assets/pet/sheets-dark/flying.png"),
  "enter-idle": require("../../assets/pet/sheets-dark/enter-idle.png"),
  "enter-working": require("../../assets/pet/sheets-dark/enter-working.png"),
  "enter-done": require("../../assets/pet/sheets-dark/enter-done.png"),
  "enter-waiting": require("../../assets/pet/sheets-dark/enter-waiting.png"),
  "enter-sleeping": require("../../assets/pet/sheets-dark/enter-sleeping.png"),
  "enter-thinking": require("../../assets/pet/sheets-dark/enter-thinking.png"),
  "enter-error": require("../../assets/pet/sheets-dark/enter-error.png"),
  "enter-carrying": require("../../assets/pet/sheets-dark/enter-carrying.png"),
} as const;

type SheetKey = keyof typeof SHEET_SOURCES;

/** 全部图集一次性预加载（hooks 顺序固定，必须逐条写）——切换不卡的关键。 */
function useAllSheets(sources: typeof SHEET_SOURCES) {
  const idle = useImage(sources.idle);
  const working = useImage(sources.working);
  const done = useImage(sources.done);
  const waiting = useImage(sources.waiting);
  const sleeping = useImage(sources.sleeping);
  const thinking = useImage(sources.thinking);
  const error = useImage(sources.error);
  const carrying = useImage(sources.carrying);
  const flying = useImage(sources.flying);
  const enterIdle = useImage(sources["enter-idle"]);
  const enterWorking = useImage(sources["enter-working"]);
  const enterDone = useImage(sources["enter-done"]);
  const enterWaiting = useImage(sources["enter-waiting"]);
  const enterSleeping = useImage(sources["enter-sleeping"]);
  const enterThinking = useImage(sources["enter-thinking"]);
  const enterError = useImage(sources["enter-error"]);
  const enterCarrying = useImage(sources["enter-carrying"]);

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

function sheetKeyOf(anim: PetAnim): SheetKey {
  return anim.sheet.replace(/^(sheets|sheets-dark)\//u, "").replace(/\.png$/u, "") as SheetKey;
}

/**
 * 目标 dp → 设备像素整数倍 → 实际 dp。
 * 例：density 2.625、目标 96dp → 96×2.625=252px → /64=3.94 → M=4 → 64×4/2.625=97.5dp。
 */
export function petDisplaySize(targetDp: number, crop = 1): { dp: number; multiple: number } {
  const density = PixelRatio.get() || 1;
  // crop<1 表示只显示中间那一块，等价于把原格放大 → 一个原格落在更多设备像素上
  const wanted = (targetDp * density) / (CELL * crop);
  const multiple = Math.max(2, Math.min(6, Math.round(wanted)));
  return { dp: (CELL * multiple) / density, multiple };
}

/** 系统"降低动画"：开着就只画静态帧（省电 + 无障碍）。 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export interface PetViewProps {
  /** 桌宠状态（语义映射见 petStates.ts）。 */
  state: PetStateId;
  /** 目标显示尺寸（dp）；实际尺寸会按设备像素取整数倍微调。 */
  targetSize?: number;
  /** false = 只画静止首帧（侧栏小图标、列表缩略图用，不占动画预算）。 */
  animated?: boolean;
  /**
   * 只显示原格中间的 crop 比例（0–1，默认 1 = 整格）。
   * 素材每格含月亮/蜡烛等道具，缩略图里整体缩会显零碎；crop 时仍按设备像素
   * 整数倍绘制再居中裁切，所以不会糊。
   */
  crop?: number;
}

export function PetView({ state, targetSize = 96, animated = true, crop = 1 }: PetViewProps) {
  // 图集按当前色板选（墨夜套已随 assets 快照）；useImage 在换源时重新解码一次。
  const scheme = useNibiScheme();
  const sheets = useAllSheets(scheme === "dark" ? SHEET_SOURCES_DARK : SHEET_SOURCES);
  const systemReduceMotion = useReduceMotion();
  const reduceMotion = systemReduceMotion || !animated;
  const box = targetSize;
  const { dp: cell } = petDisplaySize(targetSize, crop);
  // 整格比视窗大：把当前格居中，视窗只露出中间 crop 那块
  const inset = (box - cell) / 2;

  const stateDef = petPack.states.find((s) => s.id === state);
  const enterId = stateDef?.enter ?? null;
  const enterAnim = enterId ? petPack.animations[enterId] : undefined;
  const loopAnim = petPack.animations[state] as PetAnim | undefined;

  // 状态切换回到过渡相位；flying（无过渡）直接进循环；降低动画时直接画首帧。
  const [phase, setPhase] = useState<"enter" | "loop">(enterAnim ? "enter" : "loop");
  useEffect(() => {
    setPhase(reduceMotion ? "loop" : enterAnim ? "enter" : "loop");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, reduceMotion]);

  const anim = phase === "enter" && enterAnim ? enterAnim : loopAnim;

  const [frameIdx, setFrameIdx] = useState(0);
  const startRef = useRef(-1);
  const frameRef = useRef(0);
  useEffect(() => {
    if (!anim) return;
    frameRef.current = 0;
    setFrameIdx(0);

    // 降低动画：只画一帧，不启动 RAF（不持续重绘 = 不跟交互抢帧预算）
    if (reduceMotion) return;

    let raf = 0;
    startRef.current = -1;
    const tick = (t: number) => {
      if (startRef.current < 0) startRef.current = t;
      const elapsed = t - startRef.current;
      if (phase === "enter" && enterAnim && elapsed >= enterAnim.totalMs) {
        setPhase("loop");
        return;
      }
      const anim_ = anim as PetAnim;
      const ms = anim_.loop ? elapsed % anim_.totalMs : Math.min(elapsed, anim_.totalMs - 1);
      // 只在帧序号真变化时 setState：源动画 20fps，避免每 vsync 都触发 React 重渲染
      const next = frameAt(anim_, ms);
      if (next !== frameRef.current) {
        frameRef.current = next;
        setFrameIdx(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim, phase, enterAnim, reduceMotion]);

  if (!anim) return null;

  const skImage = sheets[sheetKeyOf(anim)] ?? null;

  return (
    <View style={[styles.cell, { width: box, height: box }]}>
      <Canvas style={styles.canvas}>
        <Group clip={rect(0, 0, box, box)}>
          {skImage ? (
            <SkiaImage
              image={skImage}
              x={inset - frameIdx * cell}
              y={inset}
              width={anim.frameCount * cell}
              height={cell}
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
