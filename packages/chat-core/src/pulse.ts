// pulse：AgentPulse 状态投影（D14 桌宠 / A4 通知 / D15 伴侣的共同上游协议）。
// A 阶段定协议：**持续态（sustained）** 与 **一次性事件（one-shot）** 分离——
//   - 持续态只表达"现在是什么"，UI/桌宠据此渲染动画，去重按状态迁移；
//   - 一次性事件表达"刚刚发生了什么"，通知/音效据此触发，按 key 去重防重复提醒。
export type AgentSustainedState = "idle" | "working" | "awaiting-user" | "offline";

export type AgentPulseEvent =
  | { kind: "task-started"; taskId: string }
  | { kind: "task-finished"; taskId: string; outcome: "success" | "failed" | "cancelled" }
  | { kind: "approval-requested"; requestId: string }
  | { kind: "question-asked"; requestId: string };

export interface PulseSnapshot {
  sustained: AgentSustainedState;
  /** 最近一次一次性事件（供晚挂载的 UI 补一次投影；持续态变化不写这里）。 */
  lastEvent: AgentPulseEvent | null;
}

export class PulseTracker {
  private sustained: AgentSustainedState = "idle";
  private lastEvent: AgentPulseEvent | null = null;
  private readonly seen = new Set<string>();

  constructor(
    private readonly emit: (pulse: { kind: "sustained"; state: AgentSustainedState } | AgentPulseEvent) => void,
  ) {}

  get snapshot(): PulseSnapshot {
    return { sustained: this.sustained, lastEvent: this.lastEvent };
  }

  /** 持续态迁移才发事件（同值重复调用静默）。 */
  setSustained(state: AgentSustainedState): void {
    if (this.sustained === state) return;
    this.sustained = state;
    this.emit({ kind: "sustained", state });
  }

  taskStarted(taskId: string): void {
    this.emitOnce(`task-started:${taskId}`, { kind: "task-started", taskId });
  }

  taskFinished(taskId: string, outcome: "success" | "failed" | "cancelled"): void {
    this.emitOnce(`task-finished:${taskId}:${outcome}`, { kind: "task-finished", taskId, outcome });
  }

  approvalRequested(requestId: string): void {
    this.emitOnce(`approval:${requestId}`, { kind: "approval-requested", requestId });
  }

  questionAsked(requestId: string): void {
    this.emitOnce(`question:${requestId}`, { kind: "question-asked", requestId });
  }

  private emitOnce(key: string, event: AgentPulseEvent): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.lastEvent = event;
    this.emit(event);
  }
}
