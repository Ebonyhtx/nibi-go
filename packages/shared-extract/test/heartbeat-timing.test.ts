import { describe, expect, it } from "vitest";

import {
  getWebRemoteControlHeartbeatDelayMs,
  getWebRemoteControlHeartbeatJitterMs,
  getWebRemoteControlReconnectJitterMs,
} from "../src/index";

describe("心跳时序（V2：5s±1s / ACK 15s）", () => {
  it("delay = interval ± jitter，随机数决定落点", () => {
    expect(getWebRemoteControlHeartbeatDelayMs(5000, 1000, () => 0)).toBe(4000);
    expect(getWebRemoteControlHeartbeatDelayMs(5000, 1000, () => 0.5)).toBe(5000);
    expect(getWebRemoteControlHeartbeatDelayMs(5000, 1000, () => 0.999)).toBe(5998);
  });

  it("默认 jitter 压缩到基准间隔的 20%，且永远小于基准", () => {
    expect(getWebRemoteControlHeartbeatJitterMs(5000)).toBe(1000);
    // 配置 1000ms 但基准 100ms → 压到 99（< 基准，避免 0ms 心跳风暴）
    expect(getWebRemoteControlHeartbeatJitterMs(100, 1000)).toBe(99);
    expect(getWebRemoteControlHeartbeatDelayMs(100, 1000, () => 1)).toBe(199);
  });

  it("重连 jitter（2s 窗口均匀采样）", () => {
    expect(getWebRemoteControlReconnectJitterMs(2000, () => 0)).toBe(0);
    expect(getWebRemoteControlReconnectJitterMs(2000, () => 0.5)).toBe(1000);
  });
});
