// @nibi-go/shared-extract 公共入口。
// 导出面镜像上游 nibi-client@ff1c5f4f packages/shared/src/web-remote-relay/index.ts，
// 另加本包增量抽取（QR 契约、relay 端点常量）。升级流程见本包 README（AGENTS 规则 6）。
export * from "./web-remote-relay/contract";
export * from "./web-remote-relay/retry";
export * from "./web-remote-relay/heartbeat-timing";
export { WebRemoteControlV2Heartbeat } from "./web-remote-relay/heartbeat";
export * from "./web-remote-control/qr";
export { DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL } from "./relay-endpoints";
