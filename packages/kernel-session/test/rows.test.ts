import { describe, expect, it } from "vitest";
import type { ConversationSnapshot } from "@nibi-go/shared-extract";

import { deriveRows } from "../src/index";

const base = { turnId: "turn_1", createdAt: 1000, createdAtSeq: 1 };

function snapshotWith(window: unknown[]): ConversationSnapshot {
  return {
    rows: { window, totalCount: window.length, firstRowId: null },
  } as unknown as ConversationSnapshot;
}

describe("deriveRows（对齐 dsh-Go ChatRow）", () => {
  it("用户 → 助手（正文+推理+模型）→ 工具，同一 response 收成一个助手行", () => {
    const rows = deriveRows(
      snapshotWith([
        { ...base, rowId: 1, kind: "userInput", text: "你好", origin: "realUser" },
        {
          ...base,
          rowId: 2,
          kind: "reasoning",
          assistantResponseId: "resp_1",
          text: "想一下",
          state: "complete",
        },
        {
          ...base,
          rowId: 3,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "我在",
          state: "complete",
          model: "mock-model",
        },
        {
          ...base,
          rowId: 4,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "手机里",
          state: "complete",
        },
        {
          ...base,
          rowId: 5,
          kind: "toolCall",
          assistantResponseId: "resp_1",
          toolCallId: "call_1",
          toolName: "bash",
          status: "success",
          inputText: '{"command":"ls"}',
        },
      ]),
    );

    expect(rows.map((row) => row.kind)).toEqual(["user", "assistant", "tool"]);
    expect(rows[0]).toMatchObject({ kind: "user", text: "你好" });
    expect(rows[1]).toMatchObject({
      kind: "assistant",
      text: "我在手机里",
      reasoning: "想一下",
      model: "mock-model",
      streaming: false,
    });
    expect(rows[2]).toMatchObject({ kind: "tool", name: "bash", status: "success" });
  });

  it("streaming 状态跟着 assistantText/reasoning 的 state", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "半句",
          state: "streaming",
        },
      ]),
    );
    expect(rows[0]).toMatchObject({ kind: "assistant", streaming: true, text: "半句" });
  });

  it("不同 response 的正文不合并；空快照返回空", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "A",
          state: "complete",
        },
        {
          ...base,
          rowId: 2,
          kind: "assistantText",
          assistantResponseId: "resp_2",
          text: "B",
          state: "complete",
        },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(deriveRows(null)).toEqual([]);
  });
});
