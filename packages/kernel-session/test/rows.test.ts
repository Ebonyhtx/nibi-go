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

  it("连续 ≥3 次工具调用收成 toolGroup", () => {
    const tools = [1, 2, 3].map((n) => ({
      ...base,
      rowId: 10 + n,
      kind: "toolCall",
      assistantResponseId: "resp_9",
      toolCallId: `call_${n}`,
      toolName: "bash",
      status: "success",
      inputText: "{}",
    }));
    const rows = deriveRows(snapshotWith(tools));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "toolGroup" });
    if (rows[0]?.kind === "toolGroup") expect(rows[0].tools).toHaveLength(3);
  });

  it("turnHeader 结束时在末尾挂脚注（用时/工具数/token/文件）", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "turnHeader",
          origin: "userInput",
          state: "completedSuccess",
          startedAt: 1000,
          endedAt: 2500,
          activeMs: 1200,
          outputTokens: 24,
          fileChanges: { additions: 3, deletions: 1, files: 2 },
        },
        {
          ...base,
          rowId: 2,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "done",
          state: "complete",
        },
      ]),
    );
    expect(rows.map((row) => row.kind)).toEqual(["assistant", "turn"]);
    expect(rows[1]).toMatchObject({
      kind: "turn",
      state: "completedSuccess",
      durationMs: 1200,
      tokens: 24,
      files: { additions: 3, deletions: 1, files: 2 },
    });
  });

  it("pending 提示追加在末尾", () => {
    const rows = deriveRows(snapshotWith([]), [{ id: "p1", text: "刚发出的" }]);
    expect(rows).toEqual([{ kind: "pending", key: "p1", text: "刚发出的" }]);
  });

  it("running 的 turnHeader 不出脚注", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "turnHeader",
          origin: "userInput",
          state: "running",
          startedAt: 1000,
        },
      ]),
    );
    expect(rows).toEqual([]);
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
