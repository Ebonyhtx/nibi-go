import { describe, expect, it } from "vitest";
import type { ChatRow } from "@nibi-go/kernel-session";

import {
  computePetGeometry,
  derivePetState,
  isDeliveryToolName,
  nextDevPreviewState,
  type PetMachineInput,
} from "../src/components/petMachine";
import { PET_STATE } from "../src/components/petStates";

function baseInput(overrides: Partial<PetMachineInput> = {}): PetMachineInput {
  return {
    dragging: false,
    statusKind: "ok",
    setupIssue: false,
    reconnecting: false,
    ready: true,
    turn: "idle",
    pendingSend: false,
    rows: [],
    recentOutcome: null,
    hasQueuedPayloads: false,
    idleSleeping: false,
    ...overrides,
  };
}

describe("pet state machine & geometry", () => {
  it("never clips sprite top or bottom when crop=1 across all Android densities", () => {
    for (const density of [1.5, 2, 2.625, 2.75, 3, 3.5, 4]) {
      for (const target of [72, 88, 96, 104]) {
        const g = computePetGeometry(target, density, 64, 1);
        expect(g.inset).toBe(0);
        expect(g.box).toBe(g.cell);
        expect(Math.round(g.cell * density)).toBe(64 * g.multiple);
      }
    }
  });

  it("snaps inset to physical pixel grid for cropped thumbnails", () => {
    const g = computePetGeometry(40, 2.625, 64, 0.72);
    expect(g.box).toBe(40);
    expect(Math.abs(g.inset * 2.625 - Math.round(g.inset * 2.625))).toBeLessThan(1e-6);
  });

  it("enters thinking immediately on pendingSend, pre-first-token, and reasoning-only streaming", () => {
    expect(derivePetState(baseInput({ pendingSend: true }))).toBe(PET_STATE.thinking);
    expect(derivePetState(baseInput({ turn: "running", rows: [] }))).toBe(PET_STATE.thinking);
    const reasoningOnly: ChatRow = {
      kind: "assistant",
      key: "a1",
      text: "   ",
      reasoning: "analyzing...",
      streaming: true,
    };
    expect(derivePetState(baseInput({ turn: "running", rows: [reasoningOnly] }))).toBe(
      PET_STATE.thinking,
    );
  });

  it("distinguishes working, carrying, waiting, flying, done, error, sleeping, and idle", () => {
    expect(derivePetState(baseInput({ dragging: true, turn: "running" }))).toBe(PET_STATE.flying);
    expect(derivePetState(baseInput({ statusKind: "error", setupIssue: false }))).toBe(
      PET_STATE.error,
    );
    expect(derivePetState(baseInput({ statusKind: "error", setupIssue: true }))).toBe(
      PET_STATE.idle,
    );

    const approvalRow: ChatRow = {
      kind: "approval",
      key: "ap1",
      interactionId: "i1",
      toolName: "shell",
      summary: "Allow?",
      options: [],
      freeText: false,
    };
    expect(derivePetState(baseInput({ turn: "running", rows: [approvalRow] }))).toBe(
      PET_STATE.waiting,
    );

    const bashTool: ChatRow = {
      kind: "tool",
      key: "t1",
      name: "bash",
      status: "running",
      detail: "ls",
    };
    expect(derivePetState(baseInput({ turn: "running", rows: [bashTool] }))).toBe(
      PET_STATE.working,
    );

    const writeTool: ChatRow = {
      kind: "tool",
      key: "t2",
      name: "create_docx",
      status: "running",
      detail: "report.docx",
    };
    expect(isDeliveryToolName("create_docx")).toBe(true);
    expect(derivePetState(baseInput({ turn: "running", rows: [writeTool] }))).toBe(
      PET_STATE.carrying,
    );

    const textStreaming: ChatRow = {
      kind: "assistant",
      key: "a2",
      text: "Here is the answer",
      reasoning: "",
      streaming: true,
    };
    expect(derivePetState(baseInput({ turn: "running", rows: [textStreaming] }))).toBe(
      PET_STATE.working,
    );

    expect(derivePetState(baseInput({ recentOutcome: "completed" }))).toBe(PET_STATE.done);
    expect(derivePetState(baseInput({ recentOutcome: "failed" }))).toBe(PET_STATE.error);
    expect(derivePetState(baseInput({ reconnecting: true, ready: false }))).toBe(PET_STATE.flying);
    expect(derivePetState(baseInput({ ready: false }))).toBe(PET_STATE.sleeping);
    expect(derivePetState(baseInput({ hasQueuedPayloads: true }))).toBe(PET_STATE.carrying);
    expect(derivePetState(baseInput({ idleSleeping: true }))).toBe(PET_STATE.sleeping);
    expect(derivePetState(baseInput())).toBe(PET_STATE.idle);
  });

  it("cycles through all 9 dev preview states and returns to null live mode", () => {
    let cur = nextDevPreviewState(null);
    const seen: string[] = [];
    while (cur !== null) {
      seen.push(cur);
      cur = nextDevPreviewState(cur);
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    expect(cur).toBeNull();
  });
});
