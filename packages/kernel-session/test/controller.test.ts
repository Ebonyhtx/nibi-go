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
});
