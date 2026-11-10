// @nibi-go/chat-core —— A0 骨架占位。
//
// A2 按 packages/chat-core/README.md 实现：V4 事件 reducer / replay（gap 恢复）/
// approvals（两条不变量：generation 绑定 + 30s 默认拒绝）/ pulse（AgentPulse 投影）。
//
// 纪律：禁止 import react-native / expo / react（AGENTS 规则 4，UI 框架可替换的退出保险 D12）；
//       @nibi/shared 契约只走 @nibi-go/shared-extract 抽取件（规则 6，决议 P2/P3a）。
export const PACKAGE_NAME = '@nibi-go/chat-core' as const;
