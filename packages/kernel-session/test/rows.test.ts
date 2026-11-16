import { describe, expect, it } from "vitest";
import type { ConversationSnapshot } from "@nibi-go/shared-extract";

import { deriveRows } from "../src/index";

const base = { turnId: "turn_1", createdAt: 1000, createdAtSeq: 1 };

function snapshotWith(
  window: unknown[],
  pendingInteractions: unknown[] = [],
): ConversationSnapshot {
  return {
    rows: { window, totalCount: window.length, firstRowId: null },
    pendingInteractions,
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
          output: { text: "file-a\nfile-b" },
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
    expect(rows[2]).toMatchObject({
      kind: "tool",
      name: "bash",
      status: "success",
      output: "file-a\nfile-b",
    });
  });

  it("工具行透传 display（GO 插件工具卡从 MCP ui 元数据来）", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "toolCall",
          toolCallId: "call_weather",
          toolName: "mcp__nibigo_weather__weather_get",
          status: "success",
          inputText: '{"city":"北京"}',
          output: { text: "北京 晴 24°C" },
          display: {
            kind: "mcp_tool",
            serverName: "nibigo_weather",
            toolName: "weather_get",
            ui: {
              pluginId: "nibigo_weather",
              resourceUri: "nibi-go://plugin/nibigo.weather/tool-card",
              structuredContent: '{"city":"北京","temperature":24}',
              widgetMeta: '{"nibiGo":{"card":"forecast"}}',
            },
          },
        },
      ]),
    );
    expect(rows[0]).toMatchObject({
      kind: "tool",
      name: "mcp__nibigo_weather__weather_get",
      display: {
        kind: "mcp_tool",
        serverName: "nibigo_weather",
        toolName: "weather_get",
        ui: {
          pluginId: "nibigo_weather",
          structuredContent: '{"city":"北京","temperature":24}',
          widgetMeta: '{"nibiGo":{"card":"forecast"}}',
        },
      },
    });
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

  it("正常结束的轮折叠：过程收进 process 行，最终回答留在外面", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "turnHeader",
          origin: "userInput",
          state: "completedSuccess",
          startedAt: 1000,
          endedAt: 2000,
        },
        { ...base, rowId: 2, kind: "userInput", text: "改个文件", origin: "realUser" },
        {
          ...base,
          rowId: 3,
          kind: "toolCall",
          assistantResponseId: "resp_1",
          toolCallId: "call_1",
          toolName: "Write",
          status: "success",
          inputText: "{}",
        },
        {
          ...base,
          rowId: 4,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "改好了",
          state: "complete",
          model: "mock-model",
        },
      ]),
    );

    expect(rows.map((row) => row.kind)).toEqual(["user", "process", "assistant", "turn"]);
    expect(rows[1]).toMatchObject({ kind: "process", toolCalls: 1, messages: 0 });
    if (rows[1]?.kind === "process") {
      expect(rows[1].rows.map((row) => row.kind)).toEqual(["tool"]);
    }
    expect(rows[2]).toMatchObject({ kind: "assistant", text: "改好了", reasoning: "" });
    expect(rows[3]).toMatchObject({ kind: "turn", folded: true, toolCalls: 1 });
  });

  it("普通问答不折叠（一段思考 + 一段回答）", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "turnHeader",
          origin: "userInput",
          state: "completedSuccess",
          startedAt: 1000,
          endedAt: 2000,
        },
        { ...base, rowId: 2, kind: "userInput", text: "你好", origin: "realUser" },
        {
          ...base,
          rowId: 3,
          kind: "reasoning",
          assistantResponseId: "resp_1",
          text: "想一下",
          state: "complete",
        },
        {
          ...base,
          rowId: 4,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text: "你好呀",
          state: "complete",
        },
      ]),
    );

    expect(rows.map((row) => row.kind)).toEqual(["user", "assistant", "turn"]);
    expect(rows[1]).toMatchObject({
      kind: "assistant",
      text: "你好呀",
      reasoning: "想一下",
    });
    expect(rows[2]).toMatchObject({ kind: "turn" });
    if (rows[2]?.kind === "turn") expect(rows[2].folded).toBeUndefined();
  });

  it("失败/中断的轮不折叠", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "turnHeader",
          origin: "userInput",
          state: "failed",
          startedAt: 1000,
          endedAt: 2000,
        },
        { ...base, rowId: 2, kind: "userInput", text: "跑一下", origin: "realUser" },
        {
          ...base,
          rowId: 3,
          kind: "toolCall",
          assistantResponseId: "resp_1",
          toolCallId: "call_1",
          toolName: "Bash",
          status: "error",
          inputText: "{}",
        },
      ]),
    );

    expect(rows.map((row) => row.kind)).toEqual(["user", "tool", "turn"]);
    expect(rows[2]).toMatchObject({ kind: "turn", state: "failed" });
  });

  it("pending 提示追加在末尾", () => {
    const rows = deriveRows(snapshotWith([]), [{ id: "p1", text: "刚发出的" }]);
    expect(rows).toEqual([{ kind: "pending", key: "p1", text: "刚发出的" }]);
  });

  it("快照窗口重复 rowId 只派生一次（防止列表撞 key）", () => {
    const user = {
      ...base,
      rowId: 12,
      kind: "userInput",
      text: "TOOLTEST",
      origin: "realUser",
    };
    const rows = deriveRows(snapshotWith([user, user]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "user", key: "r12", text: "TOOLTEST" });
  });

  it("subagent 行映射为子智能体卡（带子会话可下钻）", () => {
    const rows = deriveRows(
      snapshotWith([
        {
          ...base,
          rowId: 1,
          kind: "subagent",
          subagentType: "general-purpose",
          status: "success",
          summaryText: "查完了",
          childSessionId: "child_1",
          startedAt: 1000,
          endedAt: 2000,
        },
      ]),
    );
    expect(rows).toEqual([
      {
        kind: "subagent",
        key: "s1",
        subagentType: "general-purpose",
        status: "success",
        summary: "查完了",
        childSessionId: "child_1",
      },
    ]);
  });

  it("pendingInteractions 派生审批/提问行，排在消息之后、乐观气泡之前", () => {
    const rows = deriveRows(
      snapshotWith(
        [
          { ...base, rowId: 1, kind: "userInput", text: "跑一下测试", origin: "realUser" },
          {
            ...base,
            rowId: 2,
            kind: "toolCall",
            assistantResponseId: "resp_1",
            toolCallId: "call_1",
            toolName: "bash",
            status: "pendingApproval",
            inputText: '{"command":"flutter test test/auth"}',
          },
        ],
        [
          {
            interactionId: "int_1",
            kind: "permission",
            anchorRowId: 2,
            createdAt: 1000,
            autoResolution: {
              state: "visibleCountdown",
              startedAt: 1000,
              visibleAt: 1060,
              deadlineAt: 1300,
            },
            payload: {
              kind: "permission",
              toolCallId: "call_1",
              toolName: "bash",
              summary: "运行登录相关测试",
              detail: { command: "flutter test test/auth" },
              freeText: true,
              options: [
                { optionId: "allowOnce", label: "允许本次", kind: "allowOnce" },
                { optionId: "allowAlways", label: "本对话都允许", kind: "allowAlways" },
                { optionId: "deny", label: "拒绝", kind: "deny" },
              ],
              fullAccessOption: {
                optionId: "fullAccess",
                label: "完全访问（本会话不再询问）",
                kind: "custom",
              },
            },
          },
          {
            interactionId: "int_2",
            kind: "userInput",
            anchorRowId: null,
            createdAt: 1100,
            payload: {
              kind: "userInput",
              prompt: "选一个方案",
              freeText: true,
              questions: [
                {
                  question: "用哪个方案？",
                  header: "方案",
                  options: [
                    { value: "a", label: "方案 A", description: "快" },
                    { value: "b", label: "方案 B" },
                  ],
                  multiSelect: false,
                },
              ],
            },
          },
          {
            interactionId: "int_3",
            kind: "workspaceHookReview",
            anchorRowId: null,
            createdAt: 1200,
            payload: { kind: "workspaceHookReview" },
          },
        ],
      ),
      [{ id: "p1", text: "刚发出的" }],
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "tool",
      "approval",
      "question",
      "notice",
      "pending",
    ]);
    expect(rows[2]).toMatchObject({
      kind: "approval",
      interactionId: "int_1",
      toolName: "bash",
      summary: "运行登录相关测试",
      detail: "flutter test test/auth",
      freeText: true,
    });
    if (rows[2]?.kind === "approval") {
      expect(rows[2].options).toHaveLength(3);
      expect(rows[2].fullAccess?.optionId).toBe("fullAccess");
      expect(rows[2].autoResolution?.state).toBe("visibleCountdown");
    }
    expect(rows[3]).toMatchObject({
      kind: "question",
      interactionId: "int_2",
      prompt: "选一个方案",
      freeText: true,
      questions: [
        {
          question: "用哪个方案？",
          header: "方案",
          multiSelect: false,
          options: [
            { value: "a", label: "方案 A", description: "快" },
            { value: "b", label: "方案 B" },
          ],
        },
      ],
    });
    expect(rows[4]).toMatchObject({ kind: "notice", tone: "warning" });
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
