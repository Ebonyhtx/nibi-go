// 桌宠纯状态机：覆盖 pack.json 全部 9 种状态，无 React/RN 依赖，方便单测穷举验证。
//
// 状态语义与优先级（高 → 低）：
//   1. dragging               → flying   （用户横拖小鸟时展翅飞行）
//   2. statusKind === "error" → error    （链路错误；排除未配置模型的 setupIssue）
//   3. approval / question    → waiting  （等用户审批或回答提问）
//   4. turn === "running" | pendingSend：
//      - 有进行中的文件/文档交付工具 → carrying（搬运文档/文件）
//      - 有其他进行中的工具         → working （敲代码/执行）
//      - 助手已开始流式输出正文     → working （写作输出）
//      - 其余（等待首 token / 纯推理思考 / 工具间停顿）→ thinking（思考云）
//   5. 后台子代理仍在运行     → working
//   6. 刚结束回合的结果窗口：
//      - completed → done（庆祝 2.4s，新回合或换会话立刻清掉）
//      - failed    → error（短暂提示 3.5s）
//   7. 重连中                 → flying
//   8. 内核未就绪             → sleeping
//   9. 空闲且草稿挂着附件/注释 → carrying（捧好材料准备发）
//  10. 长时间静置（>90s 无互动）→ sleeping（打盹，输入/点按立刻醒）
//  11. 默认                   → idle

import type { ChatRow } from "@nibi-go/kernel-session";

import type { PetStateId } from "./PetView";
import { PET_STATE } from "./petStates";

export type RecentTurnOutcome = "completed" | "failed" | null;

export interface PetMachineInput {
  dragging: boolean;
  statusKind: "ok" | "busy" | "error";
  setupIssue: boolean;
  reconnecting?: boolean;
  ready: boolean;
  turn: "idle" | "running";
  pendingSend: boolean;
  rows: readonly ChatRow[];
  recentOutcome: RecentTurnOutcome;
  hasQueuedPayloads: boolean;
  idleSleeping: boolean;
}

const DELIVERY_TOOL_RE =
  /(?:^|[._:/-])(write|edit|patch|create|save|export|docx|xlsx|pptx|pdf|chart|diagram|upload|deliver|artifact)/iu;

/** 判断工具名是否属于文件/文档写入与交付类（用于切换 carrying 搬运态）。 */
export function isDeliveryToolName(name: string): boolean {
  return DELIVERY_TOOL_RE.test(name);
}

interface RowSignals {
  hasPendingInteraction: boolean;
  activeToolName: string | null;
  hasRunningSubagent: boolean;
  streamingAssistantHasText: boolean;
}

/** 单遍扫描当前会话行，提取宠物状态机所需信号（避免多次数组拷贝与 reverse）。 */
export function extractPetRowSignals(rows: readonly ChatRow[]): RowSignals {
  let hasPendingInteraction = false;
  let activeToolName: string | null = null;
  let hasRunningSubagent = false;
  let streamingAssistantHasText = false;

  const visit = (list: readonly ChatRow[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const row = list[i]!;
      if (row.kind === "approval" || row.kind === "question") {
        hasPendingInteraction = true;
      } else if (row.kind === "tool") {
        if (!activeToolName && row.status === "running") {
          activeToolName = row.name;
        }
      } else if (row.kind === "toolGroup") {
        visit(row.tools);
      } else if (row.kind === "process") {
        visit(row.rows);
      } else if (row.kind === "subagent") {
        if (row.status === "running" || (!row.status && row.backgrounded)) {
          hasRunningSubagent = true;
        }
      } else if (row.kind === "assistant" && row.streaming) {
        if (row.text.trim().length > 0) {
          streamingAssistantHasText = true;
        }
      }
    }
  };

  visit(rows);
  return {
    hasPendingInteraction,
    activeToolName,
    hasRunningSubagent,
    streamingAssistantHasText,
  };
}

/** 派生当前时刻的宠物状态（纯函数）。 */
export function derivePetState(input: PetMachineInput): PetStateId {
  if (input.dragging) return PET_STATE.flying;
  if (input.statusKind === "error" && !input.setupIssue) return PET_STATE.error;

  const signals = extractPetRowSignals(input.rows);
  if (signals.hasPendingInteraction) return PET_STATE.waiting;

  if (input.turn === "running" || input.pendingSend) {
    if (signals.activeToolName) {
      return isDeliveryToolName(signals.activeToolName)
        ? PET_STATE.carrying
        : PET_STATE.working;
    }
    if (signals.streamingAssistantHasText) {
      return PET_STATE.working;
    }
    return PET_STATE.thinking;
  }

  if (signals.hasRunningSubagent) return PET_STATE.working;
  if (input.recentOutcome === "completed") return PET_STATE.done;
  if (input.recentOutcome === "failed") return PET_STATE.error;
  if (input.reconnecting) return PET_STATE.flying;
  if (!input.ready) return PET_STATE.sleeping;
  if (input.hasQueuedPayloads) return PET_STATE.carrying;
  if (input.idleSleeping) return PET_STATE.sleeping;
  return PET_STATE.idle;
}

const ALL_PET_STATES: readonly PetStateId[] = Object.values(PET_STATE);

/** dev 调试点按循环：完整走完 9 个状态后自动归零回到实时状态机（null）。 */
export function nextDevPreviewState(current: PetStateId | null): PetStateId | null {
  if (current === null) return ALL_PET_STATES[0]!;
  const idx = ALL_PET_STATES.indexOf(current);
  if (idx < 0 || idx === ALL_PET_STATES.length - 1) return null;
  return ALL_PET_STATES[idx + 1]!;
}

/**
 * 宠物整数倍显示尺寸计算（纯数学，单测可直接断言不同 dpi 下无裁切）：
 *   · crop >= 1（正常整格显示）：容器 box === cell（exact 64*M / density），inset === 0，绝不裁切！
 *   · crop < 1（缩略图裁切）：box === targetDp，inset 对齐设备物理像素边界。
 */
export function computePetGeometry(
  targetDp: number,
  density: number,
  cellPx = 64,
  crop = 1,
): { box: number; cell: number; inset: number; multiple: number } {
  const safeDensity = density > 0 ? density : 1;
  const safeCrop = crop > 0 && crop <= 1 ? crop : 1;
  const wanted = (targetDp * safeDensity) / (cellPx * safeCrop);
  const multiple = Math.max(2, Math.min(6, Math.round(wanted)));
  const cell = (cellPx * multiple) / safeDensity;
  if (safeCrop >= 1) {
    return { box: cell, cell, inset: 0, multiple };
  }
  const box = targetDp;
  // 把偏移量吸附到设备物理像素网格，防止缩略图裁切时跨半像素发糊。
  const inset = Math.round(((box - cell) / 2) * safeDensity) / safeDensity;
  return { box, cell, inset, multiple };
}
