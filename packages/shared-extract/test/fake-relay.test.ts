import { once } from "node:events";

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createFakeRelayV2 } from "../src/testing";
import type { WebRemoteControlRelayV2IncomingMessage } from "../src";

const JWT = "test-jwt";
const MID = "mid-desktop-1";

let relay: Awaited<ReturnType<typeof createFakeRelayV2>>;

beforeEach(async () => {
  relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
});
afterAll(async () => {
  if (relay) await relay.close();
});

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("error", reject);
    ws.once("open", () => {
      ws.off("error", reject);
      resolve(ws);
    });
  });
}

type RelayMessage = Record<string, unknown>;

/** 队列式消息读取：先到的消息缓冲、后注册的读取不丢（once+竞态会漏消息）。 */
function messageQueue(ws: WebSocket) {
  type RelayIncoming = WebRemoteControlRelayV2IncomingMessage;
  const buffered: RelayMessage[] = [];
  const pending: Array<{
    pred?: (m: RelayMessage) => boolean;
    resolve: (value: RelayIncoming | PromiseLike<RelayIncoming>) => void;
    timer: NodeJS.Timeout;
  }> = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as RelayMessage;
    const index = pending.findIndex((p) => !p.pred || p.pred(message));
    if (index >= 0) {
      const waiter = pending.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message as RelayIncoming);
    } else {
      buffered.push(message);
    }
  });
  return (
    pred?: (m: RelayMessage) => boolean,
    timeoutMs = 3000,
  ): Promise<RelayIncoming> =>
    new Promise((resolve, reject) => {
      const index = buffered.findIndex((m) => !pred || pred(m));
      if (index >= 0) return resolve(buffered.splice(index, 1)[0] as RelayIncoming);
      const timer = setTimeout(() => reject(new Error("等待 relay 消息超时")), timeoutMs);
      pending.push({ pred, resolve, timer });
    });
}

async function registerDevice(): Promise<string> {
  const response = await fetch(`${relay.httpUrl}/api/v1/remote/device`, {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ device_mid: MID }),
  });
  const body = (await response.json()) as { code: number; data?: { device_sid: string } };
  expect(response.status).toBe(200);
  expect(body.code).toBe(0);
  return body.data!.device_sid;
}

async function requestToken(role: "device" | "terminal"): Promise<string> {
  const response = await fetch(`${relay.httpUrl}/api/v1/remote/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const body = (await response.json()) as { data?: { token: string } };
  return body.data!.token;
}

describe("fake-relay-v2（抽取件夹具）", () => {
  it("注册/列表 + 一次性 token 消费后复用 401", async () => {
    const sid = await registerDevice();
    const listResponse = await fetch(`${relay.httpUrl}/api/v1/remote/device`, {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    const list = (await listResponse.json()) as {
      data: Array<{ device_sid: string; online: boolean; meta: object }>;
    };
    expect(list.data).toHaveLength(1);
    expect(list.data[0].device_sid).toBe(sid);
    expect(list.data[0].online).toBe(false);
    expect(list.data[0].meta).toEqual({});

    const token = await requestToken("terminal");
    expect(token).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);

    // 第一次使用：合法连接（token 在升级时原子消费）
    const first = await openWs(`${relay.wsUrl}?token=${token}`);
    first.close();
    // 复用已消费的 token → 升级前 401
    const reused = new WebSocket(`${relay.wsUrl}?token=${token}`);
    const [wsError] = await once(reused, "error");
    expect(String((wsError as Error).message)).toContain("401");
    reused.terminate();
  });

  it("无 JWT 的 HTTP 调用 401", async () => {
    const noAuth = await fetch(`${relay.httpUrl}/api/v1/remote/device`);
    expect(noAuth.status).toBe(401);
  });

  it("terminal/device 配对 + 双向 data 透传 + device 断开通知", async () => {
    const sid = await registerDevice();

    const terminal = await openWs(`${relay.wsUrl}?token=${await requestToken("terminal")}`);
    const nextTerminal = messageQueue(terminal);
    terminal.send(JSON.stringify({ type: "auth_init", device_sid: sid, client_ts: 100 }));
    expect(await nextTerminal()).toMatchObject({ type: "auth_ack", device_sid: sid, pair_status: "waiting" });

    const device = await openWs(`${relay.wsUrl}?token=${await requestToken("device")}`);
    const nextDevice = messageQueue(device);
    device.send(JSON.stringify({ type: "auth_init", device_sid: sid }));
    expect(await nextDevice()).toMatchObject({ type: "auth_ack", pair_status: "matched" });
    // device 上线推送 terminal 配对状态
    expect(await nextTerminal()).toMatchObject({ type: "pair_status_ack", pair_status: "matched" });

    terminal.send(JSON.stringify({ type: "data", payload: { from: "phone" } }));
    expect(await nextDevice()).toMatchObject({ type: "data", payload: { from: "phone" } });
    device.send(JSON.stringify({ type: "data", payload: { from: "desktop" } }));
    expect(await nextTerminal()).toMatchObject({ type: "data", payload: { from: "desktop" } });

    // device 断开 → terminal 收 waiting + DEVICE_OFFLINE 并被关闭
    device.close();
    expect(await nextTerminal()).toMatchObject({ type: "pair_status_ack", pair_status: "waiting" });
    expect(await nextTerminal()).toMatchObject({ type: "error", code: "DEVICE_OFFLINE" });

    terminal.terminate();
    await once(terminal, "close").catch(() => {});
  });

  it("未知 device_sid 的 auth_init → AUTH_FAILED", async () => {
    const ws = await openWs(`${relay.wsUrl}?token=${await requestToken("terminal")}`);
    const next = messageQueue(ws);
    ws.send(JSON.stringify({ type: "auth_init", device_sid: "d_unknown" }));
    expect(await next()).toMatchObject({ type: "error", code: "AUTH_FAILED" });
    ws.terminate();
    await once(ws, "close").catch(() => {});
  });
});
