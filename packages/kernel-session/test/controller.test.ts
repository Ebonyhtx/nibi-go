import { describe, expect, it } from "vitest";
import type { ConversationSnapshot } from "@nibi-go/shared-extract";

import { ConversationController, type ConversationSource } from "../src/index";

class FakeSource implements ConversationSource {
  private current: ConversationSnapshot | null = null;
  private readonly listeners = new Set<() => void>();

  get snapshot(): ConversationSnapshot | null {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(snapshot: ConversationSnapshot | null): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function streamingSnapshot(): ConversationSnapshot {
  return {
    rows: {
      window: [
        {
          rowId: 1,
          turnId: "turn_1",
          createdAt: 1,
          createdAtSeq: 1,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "半句",
          state: "streaming",
        },
      ],
      totalCount: 1,
      firstRowId: 1,
    },
  } as unknown as ConversationSnapshot;
}

describe("ConversationController", () => {
  it("快照变化 → 行与 turn 状态更新，并通知订阅者", () => {
    const source = new FakeSource();
    const controller = new ConversationController(source);
    const listener = () => {
      calls++;
    };
    let calls = 0;
    controller.subscribe(listener);

    source.set(streamingSnapshot());

    expect(controller.rows).toHaveLength(1);
    expect(controller.rows[0]).toMatchObject({ kind: "assistant", streaming: true });
    expect(controller.turn).toBe("running");
    expect(calls).toBe(1);
    controller.dispose();
  });

  it("空快照 → 空行、idle", () => {
    const source = new FakeSource();
    const controller = new ConversationController(source);
    expect(controller.rows).toEqual([]);
    expect(controller.turn).toBe("idle");
    controller.dispose();
  });

  it("dispose 后不再跟随快照", () => {
    const source = new FakeSource();
    const controller = new ConversationController(source);
    controller.dispose();
    source.set(streamingSnapshot());
    expect(controller.rows).toEqual([]);
    expect(controller.turn).toBe("idle");
  });

  it("优先认权威 control.phase：回合已 completedSuccess 时不再被孤立 streaming 行卡在 running", () => {
    const source = new FakeSource();
    const controller = new ConversationController(source);
    source.set({
      ...streamingSnapshot(),
      control: {
        phase: "completedSuccess",
        sessionEnded: true,
        canStop: false,
        stopState: "idle",
        stopTargetKind: "unknown",
        activeWorks: [],
        lastError: null,
        apiRetry: null,
      },
    } as unknown as ConversationSnapshot);
    expect(controller.turn).toBe("idle");
    controller.dispose();
  });

  it("流式增量期间未变化的历史行保持同一引用（结构共享）", () => {
    const source = new FakeSource();
    const controller = new ConversationController(source);
    const makeSnap = (tailText: string) =>
      ({
        rows: {
          window: [
            {
              rowId: 1,
              turnId: "turn_1",
              createdAt: 1,
              createdAtSeq: 1,
              kind: "userInput",
              origin: "realUser",
              text: "你好",
            },
            {
              rowId: 2,
              turnId: "turn_1",
              createdAt: 2,
              createdAtSeq: 2,
              kind: "assistantText",
              assistantResponseId: "resp_1",
              text: tailText,
              state: "streaming",
            },
          ],
          totalCount: 2,
          firstRowId: 1,
        },
      }) as unknown as ConversationSnapshot;

    source.set(makeSnap("第"));
    const firstUser = controller.rows[0];
    source.set(makeSnap("第一句"));
    expect(controller.rows[0]).toBe(firstUser);
    expect(controller.rows[1]).toMatchObject({ kind: "assistant", text: "第一句" });
    controller.dispose();
  });
});
