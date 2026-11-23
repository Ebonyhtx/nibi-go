// 回合完成提示的纯判定（useKernelConversation 的通知 effect 调用）。
//
// 背景：内核的 `control.phase` 可能先回到 idle、最后一条 turn 行才落成 completed；
// 只看 running→idle 的边沿会漏掉“完成没声音”。这里同时认「见过 running 的那一行」
// 变成 completed/failed，并保证每个 rowId 只提示一次。

export type TurnPhase = "idle" | "running";

export interface LastTurnMarker {
  /** 行的稳定 key（rowId 优先）。 */
  key: string;
  state: string;
}

/**
 * 回合行的终态 → 提示类别。
 *
 * 内核成功态的 state 是 **`completedSuccess`**（不是 `completed`）：
 * `projection/mod.rs` 里 `TurnOutcome::Success => ("completedSuccess", "complete", …)`。
 * 历史/兼容写法 completed/success 一并认；中断（completedInterrupted）不提示。
 */
export function turnFinishedState(state: string | null | undefined): "complete" | "error" | null {
  if (state === "completedSuccess" || state === "completed" || state === "success") {
    return "complete";
  }
  if (state === "failed" || state === "error") return "error";
  return null;
}

export function completionAlert(params: {
  previousTurn: TurnPhase;
  turn: TurnPhase;
  lastTurn: LastTurnMarker | null;
  /** 见过 running 的 turn 行 key。 */
  armedRow: string | null;
  /** 已经提示过的 turn 行 key。 */
  doneRow: string | null;
}): { kind: "complete" | "error"; rowKey: string } | null {
  const { previousTurn, turn, lastTurn, armedRow, doneRow } = params;
  if (!lastTurn) return null;
  const finished = turnFinishedState(lastTurn.state);
  if (!finished) return null;
  const rowKey = lastTurn.key;
  const armed = armedRow === rowKey;
  const edge = previousTurn === "running" && turn === "idle";
  if ((!armed && !edge) || doneRow === rowKey) return null;
  return { kind: finished, rowKey };
}
