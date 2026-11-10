// @nibi-go/phone-tools —— A0 骨架占位。
//
// 接口层：PhoneToolsAdapter（D13 工具面 13 工具 / D18 多任务化 taskId 维度）。
// 接口草案见本包 README；正式落地在 B0（plan.md §2，可与 A3 并行）。
//
// 纪律：接口层不得出现 Android 专属类型（AGENTS 规则 8，D11 多平台适配器设计——
//       Android 实现放 modules/，iOS 残血=系统限制）。
export const PACKAGE_NAME = '@nibi-go/phone-tools' as const;
