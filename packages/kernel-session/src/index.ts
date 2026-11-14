// @nibi-go/kernel-session：进程内内核的会话协议客户端（纯 TS，Node 可测）。
//
// 与 `@nibi-go/chat-core` 的分工：chat-core 是桌面 V4 中继的行模型；本包只负责
// 与内核 app-server 的请求/应答与通知，UI 行模型由上层适配。
export {
  KernelProtocolError,
  KernelSessionClient,
  type KernelSessionClientOptions,
} from "./client";
export { KERNEL_METHODS } from "./protocol";
export type {
  KernelMessage,
  KernelMessagePart,
  KernelNotification,
  KernelSessionCreateResult,
  KernelTransport,
  KernelWorkspaceRef,
} from "./protocol";
