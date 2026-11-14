import { describe, expect, it } from "vitest";
import type {
  ConversationDelta,
  ConversationSnapshot,
  ConversationTopicFrame,
} from "@nibi-go/shared-extract";

import { applyConversationFrame } from "../src/index";

const base = { turnId: "turn_1", createdAt: 1000, createdAtSeq: 1 };

function snapshot(text: string, state: "streaming" | "complete"): ConversationSnapshot {
  return {
    rows: {
      window: [
        {
          ...base,
          rowId: 7,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text,
          state,
        },
      ],
      totalCount: 1,
      firstRowId: 7,
    },
  } as unknown as ConversationSnapshot;
}

function frame(payload: ConversationTopicFrame["payload"]): ConversationTopicFrame {
  return {
    topic: "conversation/sess_1",
    subscriptionId: "sub_1",
    fromSeq: 0,
    toSeq: 1,
    sentAt: 1000,
    payload,
  } as unknown as ConversationTopicFrame;
}

describe("applyConversationFrame", () => {
  it("snapshot 帧整体替换", () => {
    const next = applyConversationFrame(null, frame({ kind: "snapshot", snapshot: snapshot("hi", "complete") }));
    expect(next?.rows.window[0]).toMatchObject({ text: "hi" });
  });

  it("row.delta 追加流式文本（dsh-Go 的 row.delta 同一条协议）", () => {
    const current = snapshot("he", "streaming");
    const delta: ConversationDelta = { op: "row.delta", rowId: 7, path: "text", append: "llo" };
    const next = applyConversationFrame(current, frame({ kind: "deltas", deltas: [delta] }));
    expect((next?.rows.window[0] as { text?: string }).text).toBe("hello");
  });

  it("没有快照时增量丢弃（返回 null）", () => {
    const delta: ConversationDelta = { op: "row.delta", rowId: 7, path: "text", append: "x" };
    expect(applyConversationFrame(null, frame({ kind: "deltas", deltas: [delta] }))).toBeNull();
  });
});
