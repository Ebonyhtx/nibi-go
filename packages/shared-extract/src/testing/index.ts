// @nibi-go/shared-extract/testing —— Node 测试专用子路径（AGENTS 规则 11）。
// 对应上游 @nibi/shared/testing/fake-relay-v2 的独立测试子路径；
// 只在 Node 测试进程导入，不从生产入口导出，不进 RN bundle。
export * from "./fake-relay-v2";
