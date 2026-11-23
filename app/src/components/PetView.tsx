// NIBI 像素桌宠 · 图集播放器（Skia 最近邻 + UI 线程帧驱动 + 全局按需共享缓存）。
// 素材真源：assets/pet/pack.json + sheets/*.png + sheets-dark/*.png。
//
// 关键修复与性能优化（2.1）：
//   1. 彻底消除 thinking 等高帧顶部裁切：crop=1 时容器 box === cell（exact 64*M / density），
//      inset === 0，整格 [0..63] 完整落在物理像素网格上，既不裁切顶部思考云也不发糊；
//   2. 全局共享按需 SkImage 缓存：同一张图集全 App 只解码一次（静态缩略图仅解码 idle 1 张，
//      不再每个 PetView 重复解码 17 张）；
//   3. UI 线程帧驱动：用 Reanimated useFrameCallback + useDerivedValue 直接在 UI 线程推进帧偏移，
//      稳态循环期间 0 次 React 重渲染（原方案 20 次/秒 React setState + Skia 树 diff）；
//   4. 后台/抽屉/失焦自动停帧：共享全局 AppState 监听与 motion/appear 单例 useReducedMotion，
//      恢复时无缝续播，不再错播 enter-*；状态切换同步切入 enter，消除首帧闪烁。

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Image, PixelRatio, StyleSheet, View } from "react-native";
import {
  Canvas,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  rect,
  Skia,
  type SkImage,
} from "@shopify/react-native-skia";
import {
  runOnJS,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

import petPackRaw from "../../assets/pet/pack.json";
import { useReducedMotion } from "../motion/appear";
import { useNibiScheme } from "../theme";
import { computePetGeometry } from "./petMachine";

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
const NEAREST_SAMPLING = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;

/** 图集键 → 本地资源（浅色套）。 */
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

/** 图集键 → 墨夜套资源（与浅色套一一对应）。 */
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
type Scheme = "light" | "dark";

interface PrecomputedSchedule {
  ends: number[];
  indices: number[];
  totalMs: number;
}

const STATE_ENTER_MAP: Record<PetStateId, string | null> = Object.fromEntries(
  petPack.states.map((s) => [s.id, s.enter ?? null]),
) as Record<PetStateId, string | null>;

const SCHEDULE_MAP: Record<string, PrecomputedSchedule> = Object.fromEntries(
  Object.entries(petPack.animations).map(([key, anim]) => {
    const ends: number[] = [];
    const indices: number[] = [];
    let acc = 0;
    for (const f of anim.frames) {
      acc += f.ms;
      ends.push(acc);
      indices.push(f.i);
    }
    return [key, { ends, indices, totalMs: Math.max(1, anim.totalMs || acc) }];
  }),
);

function sheetKeyOf(anim: PetAnim): SheetKey {
  return anim.sheet.replace(/^(sheets|sheets-dark)\//u, "").replace(/\.png$/u, "") as SheetKey;
}

// ─── 模块级全局共享 SkImage 缓存（按需解码，零重复加载） ─────────────────────

const decodedSheets = new Map<string, SkImage>();
const loadingSheets = new Set<string>();
const sheetListeners = new Set<() => void>();
let cacheVersion = 0;

function notifySheetListeners(): void {
  cacheVersion += 1;
  for (const listener of sheetListeners) listener();
}

function subscribeSheetCache(listener: () => void): () => void {
  sheetListeners.add(listener);
  return () => {
    sheetListeners.delete(listener);
  };
}

function cacheKeyOf(scheme: Scheme, key: SheetKey): string {
  return `${scheme}:${key}`;
}

function ensureSheetLoaded(scheme: Scheme, key: SheetKey): void {
  const ck = cacheKeyOf(scheme, key);
  if (decodedSheets.has(ck) || loadingSheets.has(ck)) return;
  const sources = scheme === "dark" ? SHEET_SOURCES_DARK : SHEET_SOURCES;
  const asset = sources[key] ?? SHEET_SOURCES[key];
  const resolved = Image.resolveAssetSource(asset);
  const uri = resolved?.uri;
  if (!uri) return;
  loadingSheets.add(ck);
  void Skia.Data.fromURI(uri)
    .then((data) => {
      const img = Skia.Image.MakeImageFromEncoded(data);
      if (img) {
        decodedSheets.set(ck, img);
        notifySheetListeners();
      }
    })
    .catch(() => undefined)
    .finally(() => {
      loadingSheets.delete(ck);
    });
}

function useCachedSheet(scheme: Scheme, key: SheetKey | null): SkImage | null {
  useSyncExternalStore(
    subscribeSheetCache,
    () => cacheVersion,
    () => 0,
  );
  useEffect(() => {
    if (key) ensureSheetLoaded(scheme, key);
  }, [scheme, key]);
  if (!key) return null;
  return decodedSheets.get(cacheKeyOf(scheme, key)) ?? null;
}

/** 活跃桌宠首次挂起后温和预热高频状态，避免首次切态等待解码；静态缩略图绝不触发。 */
const HOT_PRELOAD_KEYS: readonly SheetKey[] = [
  "thinking",
  "enter-thinking",
  "working",
  "enter-working",
  "waiting",
  "done",
  "enter-done",
];

// ─── 模块级共享 AppState 活跃态（全应用单一订阅，后台自动停帧） ───────────────

let appActiveState = AppState.currentState === "active";
let appStateInitialized = false;
const appActiveListeners = new Set<() => void>();

function ensureAppStateSubscription(): void {
  if (appStateInitialized) return;
  appStateInitialized = true;
  AppState.addEventListener("change", (next) => {
    const active = next === "active";
    if (active !== appActiveState) {
      appActiveState = active;
      for (const listener of appActiveListeners) listener();
    }
  });
}

function useAppActive(): boolean {
  return useSyncExternalStore(
    (listener) => {
      ensureAppStateSubscription();
      appActiveListeners.add(listener);
      return () => {
        appActiveListeners.delete(listener);
      };
    },
    () => appActiveState,
    () => true,
  );
}

/**
 * 目标 dp → 设备像素整数倍 → 实际 dp。
 * crop >= 1 时返回 box === dp 且 inset === 0（整格零裁切）。
 */
export function petDisplaySize(
  targetDp: number,
  crop = 1,
): { dp: number; box: number; inset: number; multiple: number } {
  const g = computePetGeometry(targetDp, PixelRatio.get() || 1, CELL, crop);
  return { dp: g.cell, box: g.box, inset: g.inset, multiple: g.multiple };
}

export interface PetViewProps {
  /** 桌宠状态（语义映射见 petStates.ts / petMachine.ts）。 */
  state: PetStateId;
  /** 目标显示尺寸（dp）；实际尺寸会按设备像素取整数倍微调。 */
  targetSize?: number;
  /** false = 只画静止首帧（侧栏小图标、列表缩略图、抽屉打开或离焦时停帧省电）。 */
  animated?: boolean;
  /**
   * 只显示原格中间的 crop 比例（0–1，默认 1 = 整格零裁切）。
   * 缩略图场景用 crop < 1 放大居中，仍按物理像素网格对齐不发糊。
   */
  crop?: number;
}

export const PetView = memo(function PetView({
  state,
  targetSize = 96,
  animated = true,
  crop = 1,
}: PetViewProps) {
  const scheme = useNibiScheme();
  const systemReduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const reduceMotion = systemReduceMotion || !animated;
  const shouldTick = !reduceMotion && appActive;

  const { dp: cell, box, inset } = petDisplaySize(targetSize, crop);
  const clipRect = useMemo(() => rect(0, 0, box, box), [box]);

  const enterId = STATE_ENTER_MAP[state] ?? null;
  const enterAnim = enterId ? petPack.animations[enterId] : undefined;
  const loopAnim = petPack.animations[state] as PetAnim | undefined;

  // 同步派生相位：状态切换当帧即落到 enter（若有），消除切换瞬间的 1 帧 loop[0] 闪烁；
  // 仅暂停/恢复（抽屉开合、切后台）不改变 state，绝不重播 enter-*。
  const [phaseRecord, setPhaseRecord] = useState<{
    state: PetStateId;
    phase: "enter" | "loop";
  }>(() => ({ state, phase: !reduceMotion && enterAnim ? "enter" : "loop" }));

  const effectivePhase: "enter" | "loop" =
    reduceMotion || !enterAnim
      ? "loop"
      : phaseRecord.state === state
        ? phaseRecord.phase
        : "enter";

  useEffect(() => {
    setPhaseRecord((prev) => {
      const targetPhase: "enter" | "loop" = !reduceMotion && enterAnim ? "enter" : "loop";
      if (prev.state === state && prev.phase === targetPhase) return prev;
      // 仅当 state 真变化、或因 reduceMotion 必须退回 loop 时才更新；解除暂停不重播 enter。
      if (prev.state === state && !reduceMotion) return prev;
      return { state, phase: targetPhase };
    });
  }, [state, enterAnim, reduceMotion]);

  const anim = effectivePhase === "enter" && enterAnim ? enterAnim : loopAnim;
  const animId = effectivePhase === "enter" && enterId ? enterId : state;
  const activeSheetKey = anim ? sheetKeyOf(anim) : null;
  const loopSheetKey = loopAnim ? sheetKeyOf(loopAnim) : null;

  // 当前播放页按需加载；处于 enter 阶段时同步预解码紧随其后的 loop 页。
  const currentImage = useCachedSheet(scheme, activeSheetKey);
  useCachedSheet(scheme, effectivePhase === "enter" ? loopSheetKey : null);

  // 活跃主桌宠温和预热高频图集（每次间隔 120ms 错峰解码，不抢首屏帧预算）。
  const preloadedSchemeRef = useRef<Scheme | null>(null);
  useEffect(() => {
    if (!animated || preloadedSchemeRef.current === scheme) return;
    preloadedSchemeRef.current = scheme;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    HOT_PRELOAD_KEYS.forEach((key, idx) => {
      timers.push(
        setTimeout(() => {
          if (alive) ensureSheetLoaded(scheme, key);
        }, 250 + idx * 120),
      );
    });
    return () => {
      alive = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [animated, scheme]);

  // 兜底帧：首次遇到冷门图集尚未解码完成的 ~2ms 窗口内沿用上一帧，避免闪空。
  const lastReadyRef = useRef<{ image: SkImage; frameCount: number } | null>(null);
  if (currentImage && anim) {
    lastReadyRef.current = { image: currentImage, frameCount: anim.frameCount };
  }
  const renderImage = currentImage ?? lastReadyRef.current?.image ?? null;
  const renderFrameCount = currentImage
    ? (anim?.frameCount ?? 1)
    : (lastReadyRef.current?.frameCount ?? 1);
  const usingFallback = !currentImage && renderImage !== null;

  const schedule = SCHEDULE_MAP[animId] ?? { ends: [100], indices: [0], totalMs: 100 };

  // ── UI 线程帧驱动（0 React 重渲染 / 帧） ──
  const elapsedSv = useSharedValue(0);
  const frameIdxSv = useSharedValue(0);
  const cellSv = useSharedValue(cell);
  const insetSv = useSharedValue(inset);
  const endsSv = useSharedValue<number[]>(schedule.ends);
  const indicesSv = useSharedValue<number[]>(schedule.indices);
  const totalMsSv = useSharedValue(schedule.totalMs);
  const isEnterSv = useSharedValue(effectivePhase === "enter" ? 1 : 0);
  const enterDoneSv = useSharedValue(0);
  const usingFallbackSv = useSharedValue(usingFallback ? 1 : 0);

  useEffect(() => {
    cellSv.value = cell;
    insetSv.value = inset;
  }, [cell, inset, cellSv, insetSv]);

  useEffect(() => {
    usingFallbackSv.value = usingFallback ? 1 : 0;
  }, [usingFallback, usingFallbackSv]);

  useEffect(() => {
    elapsedSv.value = 0;
    frameIdxSv.value = 0;
    endsSv.value = schedule.ends;
    indicesSv.value = schedule.indices;
    totalMsSv.value = schedule.totalMs;
    isEnterSv.value = effectivePhase === "enter" ? 1 : 0;
    enterDoneSv.value = 0;
  }, [
    animId,
    effectivePhase,
    schedule,
    elapsedSv,
    frameIdxSv,
    endsSv,
    indicesSv,
    totalMsSv,
    isEnterSv,
    enterDoneSv,
  ]);

  const finishEnter = useCallback(
    (forState: PetStateId) => {
      setPhaseRecord((prev) =>
        prev.state === forState && prev.phase === "loop"
          ? prev
          : { state: forState, phase: "loop" },
      );
    },
    [],
  );

  const stateSv = useSharedValue<PetStateId>(state);
  useEffect(() => {
    stateSv.value = state;
  }, [state, stateSv]);

  const frameCallback = useFrameCallback((info) => {
    "worklet";
    const dt = info.timeSincePreviousFrame;
    // 钳制单帧步进（<= 100ms），避免从挂起恢复瞬间连跳多帧。
    const step = dt !== null && dt > 0 ? Math.min(dt, 100) : 16;
    const nextElapsed = elapsedSv.value + step;
    elapsedSv.value = nextElapsed;

    const total = totalMsSv.value;
    if (isEnterSv.value === 1 && nextElapsed >= total) {
      if (enterDoneSv.value === 0) {
        enterDoneSv.value = 1;
        runOnJS(finishEnter)(stateSv.value);
      }
      return;
    }

    const ms = isEnterSv.value === 1 ? Math.min(nextElapsed, total - 1) : nextElapsed % total;
    const ends = endsSv.value;
    const indices = indicesSv.value;
    let picked = indices.length > 0 ? indices[indices.length - 1]! : 0;
    for (let k = 0; k < ends.length; k++) {
      if (ms < ends[k]!) {
        picked = indices[k]!;
        break;
      }
    }
    if (frameIdxSv.value !== picked) {
      frameIdxSv.value = picked;
    }
  }, false);

  useEffect(() => {
    frameCallback.setActive(shouldTick && !usingFallback);
  }, [frameCallback, shouldTick, usingFallback]);

  const imageX = useDerivedValue(() => {
    const idx = usingFallbackSv.value === 1 ? 0 : frameIdxSv.value;
    return insetSv.value - idx * cellSv.value;
  });

  if (!anim) return null;

  return (
    <View style={[styles.cell, { width: box, height: box }]}>
      <Canvas style={styles.canvas}>
        <Group clip={clipRect}>
          {renderImage ? (
            <SkiaImage
              image={renderImage}
              x={imageX}
              y={inset}
              width={renderFrameCount * cell}
              height={cell}
              fit="fill"
              sampling={NEAREST_SAMPLING}
            />
          ) : null}
        </Group>
      </Canvas>
    </View>
  );
});

/** 素材基线（脚线 y=58，所有状态共用）——跨状态摆放时对齐用。 */
export const PET_BASELINE = BASELINE;
/** 原生格尺寸（64）。 */
export const PET_CELL = CELL;

const styles = StyleSheet.create({
  cell: { overflow: "hidden" },
  canvas: { flex: 1 },
});
