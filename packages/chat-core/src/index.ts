// @nibi-go/chat-core 公共入口（A2：协议层状态机；App 聊天 UI 与 sendText 在 A2 后续切片接入）。
export { ConversationStore } from "./state";
export {
  ReplaySession,
  type ReplayDegradeReason,
  type ReplaySessionOptions,
  type ReplayState,
} from "./replay";
export {
  ApprovalBoard,
  type ApprovalBoardOptions,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResolutionVia,
  type PendingApproval,
  type PresentResult,
  type ResolveResult,
} from "./approvals";
export {
  PulseTracker,
  type AgentPulseEvent,
  type AgentSustainedState,
  type PulseSnapshot,
} from "./pulse";
