import { describe, expect, it } from "vitest";

import { ApprovalBoard, type ApprovalDecision, type ApprovalResolutionVia } from "../src/approvals";

function makeBoard() {
  let generation = 1;
  let now = 1_000;
  const decisions: Array<{
    requestId: string;
    decision: ApprovalDecision;
    via: ApprovalResolutionVia;
  }> = [];
  const board = new ApprovalBoard({
    generation: () => generation,
    timeoutMs: 30_000,
    now: () => now,
    onDecision: (request, decision, via) =>
      decisions.push({ requestId: request.requestId, decision, via }),
  });
  return {
    board,
    decisions,
    setGeneration: (g: number) => (generation = g),
    advance: (ms: number) => (now += ms),
  };
}

describe("ApprovalBoard（两条不变量）", () => {
  it("不变量 1a：请求绑定 generation——旧代次请求直接拒收", () => {
    const { board } = makeBoard();
    expect(board.present({ requestId: "r1", generation: 2 })).toBe("stale-generation");
    expect(board.present({ requestId: "r1", generation: 1 })).toBe("accepted");
    expect(board.list()).toHaveLength(1);
  });

  it("不变量 1b：连接重建 → 旧卡作废，迟到允许不算数", () => {
    const { board, decisions, setGeneration } = makeBoard();
    board.present({ requestId: "r1", generation: 1 });
    setGeneration(2);
    board.voidAll();
    expect(board.resolve("r1", "allow")).toBe("late");
    expect(decisions).toEqual([]);
    // 作废后同 id 不能复活
    expect(board.present({ requestId: "r1", generation: 2 })).toBe("duplicate");
  });

  it("不变量 1c：代次漂移未及时 voidAll 时 resolve 仍判 late（防御）", () => {
    const { board, decisions, setGeneration } = makeBoard();
    board.present({ requestId: "r1", generation: 1 });
    setGeneration(2);
    expect(board.resolve("r1", "allow")).toBe("late");
    expect(decisions).toEqual([]);
  });

  it("不变量 2：30s 超时默认拒绝（sweep 驱动）", () => {
    const { board, decisions, advance } = makeBoard();
    board.present({ requestId: "r1", generation: 1 });
    advance(29_999);
    expect(board.sweep()).toBe(0);
    advance(1);
    expect(board.sweep()).toBe(1);
    expect(decisions).toEqual([{ requestId: "r1", decision: "deny", via: "timeout" }]);
    // 超时后再作答 → late
    expect(board.resolve("r1", "allow")).toBe("late");
  });

  it("窗口内用户作答生效（allow/deny 均落决策）", () => {
    const { board, decisions } = makeBoard();
    board.present({ requestId: "r1", generation: 1 });
    expect(board.resolve("r1", "allow")).toBe("resolved");
    board.present({ requestId: "r2", generation: 1 });
    expect(board.resolve("r2", "deny")).toBe("resolved");
    expect(decisions).toEqual([
      { requestId: "r1", decision: "allow", via: "user" },
      { requestId: "r2", decision: "deny", via: "user" },
    ]);
    expect(board.sweep()).toBe(0);
  });

  it("重复 present 幂等；未知 requestId resolve 返回 unknown", () => {
    const { board } = makeBoard();
    board.present({ requestId: "r1", generation: 1 });
    expect(board.present({ requestId: "r1", generation: 1 })).toBe("duplicate");
    expect(board.resolve("nope", "allow")).toBe("unknown");
  });

  it("drop：外部已解决的卡静默移除，不发决策；之后作答为 late", () => {
    const { board, decisions } = makeBoard();
    board.present({ requestId: "r1", generation: 1 });
    expect(board.drop("r1")).toBe(true);
    expect(board.drop("r1")).toBe(false);
    expect(decisions).toEqual([]);
    expect(board.resolve("r1", "allow")).toBe("late");
    expect(board.list()).toEqual([]);
  });
});
