import { WebSocket } from "ws";

import { TerminalTransportError, type ConnState } from "../src";

export const JWT = "test-jwt";
export const MID = "mid-desktop-1";
// 手机侧退避参数（与 transport 缺省一致；测试注入固定 random 以获得确定时序）
export const MOBILE_BACKOFF = { initialMs: 500, maxMs: 10_000, jitter: 0.2 };
// 提速：心跳 200ms / ACK 1s（V2 常量经 options.timing 覆写，时序语义不变）
export const FAST_TIMING = { heartbeatIntervalMs: 200, heartbeatJitterMs: 40, ackTimeoutMs: 1000 };

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface StateRecorder {
  states: ConnState[];
  errors: TerminalTransportError[];
  sendReady: Array<{ kind: "same-socket" | "reconnected-socket" }>;
  onStateChange(state: ConnState): void;
  onError(error: TerminalTransportError): void;
  onSendReady(event: { kind: "same-socket" | "reconnected-socket" }): void;
  waitFor(state: ConnState, timeoutMs?: number): Promise<void>;
}

export function stateRecorder(): StateRecorder {
  const states: ConnState[] = [];
  const errors: TerminalTransportError[] = [];
  const sendReady: Array<{ kind: "same-socket" | "reconnected-socket" }> = [];
  return {
    states,
    errors,
    sendReady,
    onStateChange: (state) => states.push(state),
    onError: (error) => errors.push(error),
    onSendReady: (event) => sendReady.push(event),
    waitFor(state, timeoutMs = 5000) {
      return new Promise<void>((resolve, reject) => {
        // 调用时刻快照：目标若已是当前状态立即通过；否则等待快照之后的新出现
        // （loopback 上瞬态可能快于轮询间隔，单靠 at(-1) 会漏掉）
        const snapshot = states.length;
        if (states.at(-1) === state) return resolve();
        const timer = setTimeout(
          () => reject(new Error(`等待状态 ${state} 超时；已见: ${states.join(",")}`)),
          timeoutMs,
        );
        const poll = setInterval(() => {
          if (states.findIndex((s, i) => i >= snapshot && s === state) >= 0) {
            clearTimeout(timer);
            clearInterval(poll);
            resolve();
          }
        }, 15);
      });
    },
  };
}

export interface DeviceSide {
  ws: WebSocket;
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
}

/** 在假 relay 上以 device 角色连入并 auth_init，模拟桌面端上线。 */
export async function connectDevice(
  relay: { httpUrl: string; wsUrl: string },
  deviceSid: string,
  jwt = JWT,
): Promise<DeviceSide> {
  const tokenResponse = await fetch(`${relay.httpUrl}/api/v1/remote/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "device" }),
  });
  const tokenBody = (await tokenResponse.json()) as { data?: { token: string } };
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`${relay.wsUrl}?token=${tokenBody.data!.token}`);
    socket.once("error", reject);
    socket.once("open", () => {
      socket.off("error", reject);
      resolve(socket);
    });
  });
  ws.send(JSON.stringify({ type: "auth_init", device_sid: deviceSid }));
  const next = (timeoutMs = 3000): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待 device 侧消息超时")), timeoutMs);
      ws.once("message", (raw) => {
        clearTimeout(timer);
        resolve(JSON.parse(raw.toString()));
      });
    });
  const ack = (await next()) as { type: string; pair_status?: string };
  if (ack.type !== "auth_ack" || ack.pair_status !== "matched")
    throw new Error(`device auth 失败: ${JSON.stringify(ack)}`);
  return { ws, next };
}

export async function registerDevice(relay: { httpUrl: string }, deviceMid = MID): Promise<string> {
  const response = await fetch(`${relay.httpUrl}/api/v1/remote/device`, {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ device_mid: deviceMid }),
  });
  const body = (await response.json()) as { code: number; data?: { device_sid: string } };
  if (response.status !== 200 || body.code !== 0)
    throw new Error(`注册失败: HTTP ${response.status} code ${body.code}`);
  return body.data!.device_sid;
}
