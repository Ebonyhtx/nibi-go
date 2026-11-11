import { describe, expect, it } from "vitest";

import {
  parseWebRemoteControlRelayV2HttpResponse,
  parseWebRemoteControlRelayV2IncomingMessage,
  parseWebRemoteControlRelayV2OutgoingMessage,
  resolveNibiAuthOrigin,
} from "../src/index";

describe("Relay V2 wire 契约（抽取件）", () => {
  it("解析合法 outgoing 消息", () => {
    expect(
      parseWebRemoteControlRelayV2OutgoingMessage({
        type: "auth_init",
        device_sid: "d_abc",
        meta: { name: "pixel", platform: "android" },
        client_ts: 1_700_000_000,
      })?.type,
    ).toBe("auth_init");
    expect(parseWebRemoteControlRelayV2OutgoingMessage({ type: "pair_status_query" })?.type).toBe(
      "pair_status_query",
    );
    expect(
      parseWebRemoteControlRelayV2OutgoingMessage({ type: "data", payload: { nibi: 1 } })?.type,
    ).toBe("data");
  });

  it("拒绝非法 outgoing 消息（严格字段）", () => {
    // strictObject：未知字段拒绝
    expect(
      parseWebRemoteControlRelayV2OutgoingMessage({ type: "data", payload: {}, extra: 1 }),
    ).toBeNull();
    // role 不是 V2 auth_init 的字段（禁止把 V1/V2 字段混发）
    expect(
      parseWebRemoteControlRelayV2OutgoingMessage({ type: "auth_init", device_sid: "d", role: "device" }),
    ).toBeNull();
    // data 缺 payload
    expect(parseWebRemoteControlRelayV2OutgoingMessage({ type: "data" })).toBeNull();
    // 毫秒时间戳拒绝（V2 只收秒）
    expect(
      parseWebRemoteControlRelayV2OutgoingMessage({ type: "data", payload: {}, client_ts: 1_700_000_000_000 }),
    ).toBeNull();
    // 未知 type
    expect(parseWebRemoteControlRelayV2OutgoingMessage({ type: "ping" })).toBeNull();
  });

  it("解析合法 incoming 消息与全部错误码", () => {
    expect(
      parseWebRemoteControlRelayV2IncomingMessage({
        type: "auth_ack",
        device_sid: "d_abc",
        terminal_sid: "t_1",
        pair_status: "matched",
      })?.type,
    ).toBe("auth_ack");
    expect(
      parseWebRemoteControlRelayV2IncomingMessage({
        type: "pair_status_ack",
        terminal_sid: "",
        pair_status: "waiting",
      })?.type,
    ).toBe("pair_status_ack");
    expect(
      parseWebRemoteControlRelayV2IncomingMessage({ type: "data", payload: null })?.type,
    ).toBe("data");
    for (const code of ["AUTH_FAILED", "WRONG_PARAM", "KICKED", "INTERNAL", "DEVICE_OFFLINE"] as const) {
      expect(parseWebRemoteControlRelayV2IncomingMessage({ type: "error", code })?.type).toBe("error");
    }
  });

  it("拒绝非法 incoming 消息", () => {
    expect(parseWebRemoteControlRelayV2IncomingMessage({ type: "auth_ack", pair_status: "matched" })).toBeNull();
    expect(parseWebRemoteControlRelayV2IncomingMessage({ type: "error", code: "OTHER" })).toBeNull();
    expect(parseWebRemoteControlRelayV2IncomingMessage({ type: "auth_ack", device_sid: " ", pair_status: "waiting" })).toBeNull();
  });

  it("HTTP token 响应：成功信封与业务错误信封", () => {
    const token = `${"A".repeat(21)}A`;
    const ok = parseWebRemoteControlRelayV2HttpResponse("token", {
      code: 0,
      msg: "",
      data: { token, expires_in: 60 },
    });
    expect(ok && !("code" in ok && ok.code !== 0)).toBe(true);
    // token 形状不符合 16 字节 Base64URL 无填充 → 拒绝
    expect(
      parseWebRemoteControlRelayV2HttpResponse("token", { code: 0, msg: "", data: { token: "short", expires_in: 60 } }),
    ).toBeNull();
    // 服务端新增未知字段 → 剥离后继续成功
    expect(
      parseWebRemoteControlRelayV2HttpResponse("token", {
        code: 0,
        msg: "",
        logid: "x",
        data: { token, expires_in: 60, extra: true },
      }),
    ).not.toBeNull();
    // 业务失败信封
    const err = parseWebRemoteControlRelayV2HttpResponse("token", { code: 1006, msg: "no permission" });
    expect(err && "code" in err && err.code === 1006).toBe(true);
  });

  it("NIBI 账号中心 origin 覆盖（联调用）", () => {
    expect(resolveNibiAuthOrigin()).toBe("https://auth.nibistudio.cn");
    expect(resolveNibiAuthOrigin({ NIBI_AUTH_ORIGIN: "https://auth.local.example/" })).toBe(
      "https://auth.local.example",
    );
    expect(resolveNibiAuthOrigin({ NIBI_AUTH_ORIGIN: "  " })).toBe("https://auth.nibistudio.cn");
  });
});
