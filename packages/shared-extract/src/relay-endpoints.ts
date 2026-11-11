// 来源: nibi-client@ff1c5f4f packages/shared/src/zcodeEndpoint.ts（局部抽取，仅 relay/端点常量，未改写语义）
// 未抽取: OAuth/业务端点构造逻辑与 V4 版本门槛逻辑（按抽取流程增量登记）
export const DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL =
  "wss://api.nibistudio.cn/api/v1/remote/ws2";

/** 来源: zcodeEndpoint.ts 行 5。页面与中继同源的生产端点 origin（登录/设备列表/token 都落这里）。 */
export const DEFAULT_NIBI_ENDPOINT_ORIGIN = "https://api.nibistudio.cn";
