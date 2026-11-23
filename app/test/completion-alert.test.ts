import { describe, expect, it } from "vitest";

import { completionAlert } from "../src/kernel/completionAlert";

describe("completionAlert（回合完成提示）", () => {
  const completed = { key: "turn-7", state: "completedSuccess" };

  it("见过 running 后变 completedSuccess：提示一次", () => {
    expect(
      completionAlert({
        previousTurn: "running",
        turn: "idle",
        lastTurn: completed,
        armedRow: "turn-7",
        doneRow: null,
      }),
    ).toEqual({ kind: "complete", rowKey: "turn-7" });
  });

  it("错过 running→idle 边沿、但行已 armed：仍然提示", () => {
    expect(
      completionAlert({
        previousTurn: "idle",
        turn: "idle",
        lastTurn: completed,
        armedRow: "turn-7",
        doneRow: null,
      }),
    ).toEqual({ kind: "complete", rowKey: "turn-7" });
  });

  it("同一行已经提示过：不再响", () => {
    expect(
      completionAlert({
        previousTurn: "running",
        turn: "idle",
        lastTurn: completed,
        armedRow: "turn-7",
        doneRow: "turn-7",
      }),
    ).toBeNull();
  });

  it("失败回合用 error 音", () => {
    expect(
      completionAlert({
        previousTurn: "running",
        turn: "idle",
        lastTurn: { key: "turn-8", state: "failed" },
        armedRow: "turn-8",
        doneRow: null,
      }),
    ).toEqual({ kind: "error", rowKey: "turn-8" });
  });

  it("没 armed、也没有边沿（例如压缩控制轮）：不提示", () => {
    expect(
      completionAlert({
        previousTurn: "idle",
        turn: "idle",
        lastTurn: completed,
        armedRow: null,
        doneRow: null,
      }),
    ).toBeNull();
  });

  it("running 中的行不提示", () => {
    expect(
      completionAlert({
        previousTurn: "running",
        turn: "running",
        lastTurn: { key: "turn-9", state: "running" },
        armedRow: "turn-9",
        doneRow: null,
      }),
    ).toBeNull();
  });

  it("用户中断（completedInterrupted）不提示", () => {
    expect(
      completionAlert({
        previousTurn: "running",
        turn: "idle",
        lastTurn: { key: "turn-10", state: "completedInterrupted" },
        armedRow: "turn-10",
        doneRow: null,
      }),
    ).toBeNull();
  });

  it("兼容历史 completed/success 写法", () => {
    for (const state of ["completed", "success"]) {
      expect(
        completionAlert({
          previousTurn: "running",
          turn: "idle",
          lastTurn: { key: `turn-${state}`, state },
          armedRow: `turn-${state}`,
          doneRow: null,
        }),
      ).toEqual({ kind: "complete", rowKey: `turn-${state}` });
    }
  });
});
