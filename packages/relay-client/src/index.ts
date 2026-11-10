// @nibi-go/relay-client —— A0 骨架占位。
//
// A1 按 docs/design/relay-client-interface-draft.md 实现：
//   RelayTransport（transport.ts，状态机）/ PairingFlow（pairing.ts，配对双路径 D8）。
// E2E 信封（CipherEnvelope/KeyExchange）按 plan.md 排 A3；gate.ts 后置到 A2 前（评审结论）。
//
// 纪律：禁止 import react-native / expo / react（AGENTS 规则 4，scripts/check-boundaries.mjs 门禁）；
//       @nibi/shared 契约只走 @nibi-go/shared-extract 抽取件（规则 6，决议 P2/P3a）。
export const PACKAGE_NAME = '@nibi-go/relay-client' as const;
