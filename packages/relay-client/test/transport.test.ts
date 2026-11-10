import { describe, expect, it, vi } from "vitest";

import { WebRemoteControlV2RetryPolicy } from "@nibi-go/shared-extract";
import { createFakeRelayV2 } from "@nibi-go/shared-extract/testing";

import { RelayTransport } from "../src/transport";
import { requestTerminalToken } from "../src/pairing";
import type { RelayJson, RelayTransportOptions } from "../src/types";
import { createNodeSocketFactory } from "./ws-adapter";
import {
  connectDevice,
  FAST_TIMING,
  JWT,
  MID,
  MOBILE_BACKOFF,
  registerDevice,
  stateRecorder,
  sleep,
} from "./helpers";

function makeTransport(
  relay: { httpUrl: string; wsUrl: string },
  deviceSid: string,
  recorder: ReturnType<typeof stateRecorder>,
  received: unknown[],
  extra: Partial<RelayTransportOptions> = {},
): RelayTransport {
  return new RelayTransport({
    relayWsUrl: relay.wsUrl,
    deviceSid,
    deviceMid: MID,
    meta: { name: "Pixel", platform: "android" },
    createSocket: createNodeSocketFactory(),
    timing: FAST_TIMING,
    // transport.getToken 契约返回 token 字符串（一次性 token 的 expiresIn 不进 transport）
    getToken: (signal) => requestTerminalToken(relay.httpUrl, JWT, signal).then((r) => r.token),
    onStateChange: recorder.onStateChange,
    onData: (payload) => received.push(payload),
    onError: recorder.onError,
    onSendReady: recorder.onSendReady,
    ...extra,
  });
}

describe("RelayTransport（terminal 状态机 × fake-relay-v2）", () => {
  it("waiting_terminal → matched → 数据往返 → DEVICE_OFFLINE 重连 → reconnected-socket", async () => {
    const relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
    try {
      const sid = await registerDevice(relay);
      const rec = stateRecorder();
      const received: unknown[] = [];
      const transport = makeTransport(relay, sid, rec, received);

      transport.start();
      await rec.waitFor("connecting");
      await rec.waitFor("waiting_terminal");
      expect(rec.errors).toEqual([]);

      // 桌面上线 → pair_status_ack matched → paired
      const device = await connectDevice(relay, sid);
      await rec.waitFor("paired");
      // 首次配对不发 onSendReady（无前代）
      expect(rec.sendReady).toEqual([]);

      // 上行：手机 → 桌面
      expect(transport.sendData({ hello: "phone" })).toBe(true);
      await expect(device.next()).resolves.toMatchObject({
        type: "data",
        payload: { hello: "phone" },
      });

      // 下行：桌面 → 手机
      device.ws.send(JSON.stringify({ type: "data", payload: { from: "desktop" } }));
      await vi.waitFor(() => expect(received).toEqual([{ from: "desktop" }]));

      // 桌面断开 → waiting → DEVICE_OFFLINE → 重连 → waiting_terminal
      device.ws.close();
      await rec.waitFor("connecting");
      await rec.waitFor("waiting_terminal");
      // 桌面重新上线 → matched → onSendReady(reconnected-socket)
      const device2 = await connectDevice(relay, sid);
      await rec.waitFor("paired");
      expect(rec.sendReady).toEqual([{ kind: "reconnected-socket" }]);

      transport.dispose();
      expect(rec.states.at(-1)).toBe("idle");
      device2.ws.terminate();
    } finally {
      await relay.close();
    }
  }, 20_000);

  it("首次 KICKED：随机 2-5s 内重连恢复（不进终态）", async () => {
    const relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
    try {
      const sid = await registerDevice(relay);
      const rec = stateRecorder();
      const transport = makeTransport(relay, sid, rec, [], {
        // random=0 → kickedDelay=2000ms（窗口下限），退避最小化
        retry: new WebRemoteControlV2RetryPolicy(() => 0, MOBILE_BACKOFF),
      });
      transport.start();
      await rec.waitFor("waiting_terminal");

      relay.sendError({ role: "terminal" }, "KICKED");
      await rec.waitFor("connecting");
      await rec.waitFor("waiting_terminal", 8000);
      expect(rec.errors).toEqual([]);
      expect(rec.states).not.toContain("kicked");
      transport.dispose();
    } finally {
      await relay.close();
    }
  }, 15_000);

  it("60s 内第二次 KICKED：kicked 终态 + session-conflict", async () => {
    const relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
    try {
      const sid = await registerDevice(relay);
      const rec = stateRecorder();
      const transport = makeTransport(relay, sid, rec, [], {
        retry: new WebRemoteControlV2RetryPolicy(() => 0, MOBILE_BACKOFF),
      });
      transport.start();
      await rec.waitFor("waiting_terminal");

      // 第一次 KICKED → 2000ms 后重连回到 waiting_terminal
      relay.sendError({ role: "terminal" }, "KICKED");
      await rec.waitFor("connecting");
      await rec.waitFor("waiting_terminal", 8000);

      // 第二次 KICKED（距首次 < 60s，lastKickAt 未过期）→ 终态
      relay.sendError({ role: "terminal" }, "KICKED");
      await rec.waitFor("kicked");
      expect(rec.errors.at(-1)?.kind).toBe("session-conflict");
      transport.dispose();
    } finally {
      await relay.close();
    }
  }, 20_000);

  it("token HTTP 401：auth-required 终态，停止自动重连", async () => {
    const relay = await createFakeRelayV2({
      users: { [JWT]: "user-1" },
      onHttp: (call) =>
        call.path.endsWith("/remote/token") ? { status: 401 } : undefined,
    });
    try {
      const sid = await registerDevice(relay);
      const rec = stateRecorder();
      const transport = makeTransport(relay, sid, rec, []);
      transport.start();
      await rec.waitFor("error");
      expect(rec.errors.at(-1)?.kind).toBe("auth-required");
      // 停止自动重连：状态稳定在 error
      await sleep(250);
      expect(rec.states.at(-1)).toBe("error");
      transport.dispose();
    } finally {
      await relay.close();
    }
  }, 10_000);

  it("auth_init 后 AUTH_FAILED：device-not-owned 终态", async () => {
    const relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
    try {
      const rec = stateRecorder();
      // 未注册的 device_sid
      const transport = makeTransport(relay, "d_not-owned", rec, []);
      transport.start();
      await rec.waitFor("error");
      expect(rec.errors.at(-1)?.kind).toBe("device-not-owned");
      transport.dispose();
    } finally {
      await relay.close();
    }
  }, 10_000);

  it("信封插桩点：仅 data 过 transform 钩子，握手类明文", async () => {
    const relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
    try {
      const sid = await registerDevice(relay);
      const rec = stateRecorder();
      const received: unknown[] = [];
      const transport = makeTransport(relay, sid, rec, received, {
        // A3 将替换为 XChaCha20-Poly1305 信封（草案 §3）；此处验证插桩点语义
        transformOutgoingData: (payload) => ({ v: 1, wrapped: payload }),
        transformIncomingData: (payload) =>
          payload && typeof payload === "object" && "wrapped" in (payload as object)
            ? (payload as { wrapped: RelayJson }).wrapped
            : null,
      });
      transport.start();
      await rec.waitFor("waiting_terminal");
      const device = await connectDevice(relay, sid);
      await rec.waitFor("paired");

      // 上行被包裹
      transport.sendData({ hello: 1 });
      await expect(device.next()).resolves.toMatchObject({
        type: "data",
        payload: { v: 1, wrapped: { hello: 1 } },
      });

      // 下行拆包
      device.ws.send(
        JSON.stringify({ type: "data", payload: { v: 1, wrapped: { from: "desktop" } } }),
      );
      await vi.waitFor(() => expect(received).toEqual([{ from: "desktop" }]));

      // 未包裹的下行 → transform 返回 null → 丢弃
      device.ws.send(JSON.stringify({ type: "data", payload: { raw: 1 } }));
      await sleep(150);
      expect(received).toHaveLength(1);

      // 握手类明文：auth_init 带 meta 原文
      const authInit = relay.messages.find(
        (m) => m.role === "terminal" && (m.message as { type?: string }).type === "auth_init",
      );
      expect(authInit).toBeDefined();
      expect(authInit!.message).toMatchObject({ device_sid: sid, meta: { name: "Pixel" } });
      transport.dispose();
      device.ws.terminate();
    } finally {
      await relay.close();
    }
  }, 20_000);
});
