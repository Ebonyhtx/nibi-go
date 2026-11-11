import { describe, expect, it } from "vitest";

import {
  pendingInteractionSchema,
  type PendingInteraction,
} from "@nibi-go/shared-extract";

import { interactionAnswerForDecision } from "../src/interaction-answer";

type PermissionOption = {
  optionId: string;
  label: string;
  kind: "allowOnce" | "allowAlways" | "deny" | "custom";
};

function permissionInteraction(options: PermissionOption[]): PendingInteraction {
  return pendingInteractionSchema.parse({
    interactionId: "int-1",
    kind: "permission",
    anchorRowId: null,
    createdAt: 1_700_000_000_000,
    payload: {
      kind: "permission",
      toolCallId: "tool-1",
      toolName: "Bash",
      summary: "run ls",
      detail: {},
      options,
    },
  });
}

const STANDARD_OPTIONS: PermissionOption[] = [
  { optionId: "allowOnce", label: "Allow once", kind: "allowOnce" },
  { optionId: "allowAlways", label: "Always allow", kind: "allowAlways" },
  { optionId: "deny", label: "Deny", kind: "deny" },
];

describe("interactionAnswerForDecision（optionId 映射）", () => {
  it("allow → allowOnce（最小授权），deny → deny 选项", () => {
    const interaction = permissionInteraction(STANDARD_OPTIONS);
    expect(interactionAnswerForDecision(interaction, "allow")).toEqual({
      optionId: "allowOnce",
    });
    expect(interactionAnswerForDecision(interaction, "deny")).toEqual({
      optionId: "deny",
    });
  });

  it("没有 allowOnce 时 allow 退回 allowAlways，并保留真实 optionId（如 allowSession）", () => {
    const interaction = permissionInteraction([
      { optionId: "allowSession", label: "Always allow in this session", kind: "allowAlways" },
      { optionId: "deny", label: "Deny", kind: "deny" },
    ]);
    expect(interactionAnswerForDecision(interaction, "allow")).toEqual({
      optionId: "allowSession",
    });
  });

  it("cancel → action:cancel（桌面 command.ts 的 answer.action 闭集）", () => {
    const interaction = permissionInteraction(STANDARD_OPTIONS);
    expect(interactionAnswerForDecision(interaction, "cancel")).toEqual({
      action: "cancel",
    });
  });

  it("无 options / 非 permission 的旧载荷 → 退回 action 兼容路径", () => {
    const userInput = pendingInteractionSchema.parse({
      interactionId: "int-q",
      kind: "userInput",
      anchorRowId: null,
      createdAt: 1_700_000_000_000,
      payload: {
        kind: "userInput",
        prompt: "continue?",
        freeText: true,
      },
    });
    expect(interactionAnswerForDecision(userInput, "allow")).toEqual({ action: "accept" });
    expect(interactionAnswerForDecision(userInput, "deny")).toEqual({ action: "decline" });
    expect(interactionAnswerForDecision(undefined, "allow")).toEqual({ action: "accept" });
    expect(interactionAnswerForDecision(undefined, "deny")).toEqual({ action: "decline" });
  });
});
