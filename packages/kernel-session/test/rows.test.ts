import { describe, expect, it } from "vitest";

import { mapKernelMessages, type KernelMessage } from "../src/index";

function message(partial: Partial<KernelMessage["info"]> & { role: string }, parts: KernelMessage["parts"]): KernelMessage {
  return {
    info: { messageId: "msg_1", ...partial } as KernelMessage["info"],
    parts,
  };
}

describe("mapKernelMessages", () => {
  it("用户/助手/系统消息各自成行，文本 part 拼接", () => {
    const rows = mapKernelMessages([
      message({ role: "user", time: { created: 1 } }, [{ type: "text", text: "你好" }]),
      message({ role: "assistant", time: { created: 2, completed: 3 }, model: { providerId: "anthropic", modelId: "m" } }, [
        { type: "text", text: "我在" },
        { type: "text", text: "手机里" },
      ]),
      message({ role: "system" }, [{ type: "text", text: "系统提示" }]),
    ]);

    expect(rows).toEqual([
      { kind: "user", id: "msg_1", text: "你好", createdAt: 1 },
      {
        kind: "assistant",
        id: "msg_1",
        text: "我在手机里",
        createdAt: 2,
        completedAt: 3,
        model: { providerId: "anthropic", modelId: "m" },
      },
      { kind: "system", id: "msg_1", text: "系统提示" },
    ]);
  });

  it("非文本 part 先丢弃；未知角色跳过；空 messageId 跳过", () => {
    const rows = mapKernelMessages([
      message({ role: "assistant" }, [
        { type: "reasoning", text: "想一想" },
        { type: "text", text: "答案" },
      ]),
      message({ role: "tool" }, [{ type: "text", text: "不该出现" }]),
      { info: { messageId: "", role: "user" }, parts: [{ type: "text", text: "空 id" }] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "assistant", text: "答案" });
  });

  it("没有 model 时不带 model 字段", () => {
    const rows = mapKernelMessages([message({ role: "assistant" }, [{ type: "text", text: "x" }])]);
    expect(rows[0]).not.toHaveProperty("model");
  });
});
