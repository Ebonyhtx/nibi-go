// 审批卡决策 → resolveInteraction answer。
//
// 根因：桌面按 answer.optionId 精确匹配 pendingInteractions[].payload.options[].optionId；
// 权限卡没有 optionId 时一律 deny（Node interaction-broker v4AnswerToPermissionResponse /
// Rust commands.rs resolve）。所以 allow/deny 必须从快照选项里按 kind 取真实 optionId，
// 不能再发 {action:"accept"}。
// 兼容：没有 options 的旧载荷（userInput/旧快照）或 cancel 退回 action（command.ts 闭集）。
import type { PendingInteraction } from "@nibi-go/shared-extract";

import type { ApprovalDecision } from "./approvals";

export type InteractionDecision = ApprovalDecision | "cancel";

export type InteractionAnswer =
  | { optionId: string }
  | { action: "accept" | "decline" | "cancel" };

/**
 * 从快照 pendingInteraction 选 answer：
 * - allow → 优先 allowOnce（最小授权），没有则 allowAlways；
 * - deny → kind=deny 的选项；
 * - cancel / 无 options / 非 permission → 旧 action 路径。
 */
export function interactionAnswerForDecision(
  interaction: PendingInteraction | undefined,
  decision: InteractionDecision,
): InteractionAnswer {
  if (decision !== "cancel" && interaction?.payload.kind === "permission") {
    const kinds =
      decision === "allow" ? (["allowOnce", "allowAlways"] as const) : (["deny"] as const);
    for (const kind of kinds) {
      const option = interaction.payload.options.find((candidate) => candidate.kind === kind);
      if (option) return { optionId: option.optionId };
    }
  }
  return {
    action: decision === "allow" ? "accept" : decision === "deny" ? "decline" : "cancel",
  };
}
