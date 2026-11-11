import { describe, expect, it } from "vitest";

import { PulseTracker, type AgentPulseEvent, type AgentSustainedState } from "../src/pulse";

describe("PulseTracker（持续态 vs 一次性事件）", () => {
  it("持续态只在迁移时发事件", () => {
    const emitted: Array<{ kind: "sustained"; state: AgentSustainedState } | AgentPulseEvent> = [];
    const tracker = new PulseTracker((p) => emitted.push(p));
    tracker.setSustained("working");
    tracker.setSustained("working");
    tracker.setSustained("awaiting-user");
    expect(emitted).toEqual([
      { kind: "sustained", state: "working" },
      { kind: "sustained", state: "awaiting-user" },
    ]);
    expect(tracker.snapshot.sustained).toBe("awaiting-user");
  });

  it("一次性事件按 key 去重（重复通知不重复提醒）", () => {
    const emitted: AgentPulseEvent[] = [];
    const tracker = new PulseTracker((p) => {
      if (p.kind !== "sustained") emitted.push(p);
    });
    tracker.taskStarted("t1");
    tracker.taskStarted("t1");
    tracker.taskFinished("t1", "success");
    tracker.taskFinished("t1", "success");
    tracker.approvalRequested("a1");
    tracker.approvalRequested("a1");
    tracker.questionAsked("q1");
    expect(emitted).toEqual([
      { kind: "task-started", taskId: "t1" },
      { kind: "task-finished", taskId: "t1", outcome: "success" },
      { kind: "approval-requested", requestId: "a1" },
      { kind: "question-asked", requestId: "q1" },
    ]);
    expect(tracker.snapshot.lastEvent).toEqual({ kind: "question-asked", requestId: "q1" });
  });

  it("同一任务不同结局视为不同事件", () => {
    const emitted: AgentPulseEvent[] = [];
    const tracker = new PulseTracker((p) => {
      if (p.kind !== "sustained") emitted.push(p);
    });
    tracker.taskFinished("t1", "success");
    tracker.taskFinished("t1", "failed");
    expect(emitted).toHaveLength(2);
  });
});
