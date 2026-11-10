// 来源: nibi-client@ff1c5f4f packages/shared/src/web-remote-relay/contract.example.ts（未改写语义；仅 import 路径按本包布局调整）
import { parseWebRemoteControlRelayV2IncomingMessage } from "./contract";

export const matchedDevice = parseWebRemoteControlRelayV2IncomingMessage({
  type: "auth_ack",
  device_sid: "device-example",
  pair_status: "matched",
});
