import { describe, expect, it } from "vitest";

import { WebRemoteControlV2ConnectionError } from "@nibi-go/shared-extract";
import { createFakeRelayV2 } from "@nibi-go/shared-extract/testing";

import { PairingFlow, listDevices, parseDesktopQr, qrEndpointOrigin, requestTerminalToken } from "../src";
import type { PairCredential, PairCredentialStore } from "../src/types";
import { JWT, registerDevice } from "./helpers";

const controller = () => new AbortController().signal;

function memoryStore(): PairCredentialStore & { get(): PairCredential | undefined } {
  let value: PairCredential | undefined;
  return {
    get: () => value,
    load: async () => value,
    save: async (credential) => {
      value = credential;
    },
    clear: async () => {
      value = undefined;
    },
  };
}

describe("requestTerminalToken（一次性 token，relay 契约 §02）", () => {
  it("成功获取 60s 一次性 token", async () => {
    const relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
    try {
      const { token, expiresIn } = await requestTerminalToken(relay.httpUrl, JWT, controller());
      expect(token).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
      expect(expiresIn).toBe(60);
      // Cache-Control: no-store（防 token 进缓存）
      const call = relay.httpCalls.find((c) => c.path.endsWith("/remote/token"));
      expect(call).toMatchObject({ method: "POST", body: { role: "terminal" } });
    } finally {
      await relay.close();
    }
  });

  it("HTTP 401 → auth-required（不可重试）", async () => {
    const relay = await createFakeRelayV2({
      users: { [JWT]: "user-1" },
      onHttp: (call) => (call.path.endsWith("/remote/token") ? { status: 401 } : undefined),
    });
    try {
      const error = await requestTerminalToken(relay.httpUrl, JWT, controller()).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(WebRemoteControlV2ConnectionError);
      expect(error).toMatchObject({ reason: "auth-required", retryable: false });
    } finally {
      await relay.close();
    }
  });

  it("5xx → relay-unavailable（可重试）；HTTP 200 业务失败 → relay-unavailable（可重试）", async () => {
    const serverError = await createFakeRelayV2({
      users: { [JWT]: "user-1" },
      onHttp: (call) => (call.path.endsWith("/remote/token") ? { status: 503 } : undefined),
    });
    const businessError = await createFakeRelayV2({
      users: { [JWT]: "user-1" },
      onHttp: (call) =>
        call.path.endsWith("/remote/token")
          ? { status: 200, body: { code: 1006, msg: "no permission" } }
          : undefined,
    });
    try {
      const e1 = await requestTerminalToken(serverError.httpUrl, JWT, controller()).catch(
        (e: unknown) => e,
      );
      expect(e1).toMatchObject({ reason: "relay-unavailable", retryable: true });
      const e2 = await requestTerminalToken(businessError.httpUrl, JWT, controller()).catch(
        (e: unknown) => e,
      );
      expect(e2).toMatchObject({ reason: "relay-unavailable", retryable: true });
    } finally {
      await serverError.close();
      await businessError.close();
    }
  });
});

describe("listDevices（§06 设备列表）", () => {
  it("返回当前账号设备列表；401 → auth-required", async () => {
    const relay = await createFakeRelayV2({ users: { [JWT]: "user-1" } });
    const authRequired = await createFakeRelayV2({
      users: { [JWT]: "user-1" },
      onHttp: (call) => (call.path.endsWith("/remote/device") ? { status: 401 } : undefined),
    });
    try {
      const sid = await registerDevice(relay);
      const devices = await listDevices(relay.httpUrl, JWT, controller());
      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({ device_sid: sid, device_mid: "mid-desktop-1", online: false });
      await expect(
        listDevices(authRequired.httpUrl, JWT, controller()),
      ).rejects.toMatchObject({ reason: "auth-required" });
    } finally {
      await relay.close();
      await authRequired.close();
    }
  });
});

describe("QR 解析（D7：仅路由提示；V2 契约）", () => {
  it("解析 sid/mid/name/app_version 与 endpoint origin", () => {
    const raw =
      "https://api.nibistudio.cn/remote/v4?sid=d_abc&mid=mid-1&name=My%20PC&app_version=4.0.1";
    expect(parseDesktopQr(raw)).toEqual({
      deviceSid: "d_abc",
      deviceMid: "mid-1",
      deviceName: "My PC",
      appVersion: "4.0.1",
    });
    expect(qrEndpointOrigin(raw)).toBe("https://api.nibistudio.cn");
  });

  it("带 hash/t 的旧链接 → null；非 URL → null；无 sid 参数 → 空对象（进设备列表）", () => {
    expect(
      parseDesktopQr("https://api.nibistudio.cn/remote/v4?sid=d_abc&hash=x"),
    ).toBeNull();
    expect(parseDesktopQr("https://api.nibistudio.cn/remote/v4?sid=d_abc&t=1")).toBeNull();
    expect(parseDesktopQr("not a url")).toBeNull();
    expect(parseDesktopQr("https://api.nibistudio.cn/remote/v4")).toEqual({});
  });
});

describe("PairingFlow（D8 配对双路径）", () => {
  it("扫码目标覆盖持久凭据并落库；无扫码 → 免扫重连（持久凭据）；无凭据 → undefined", async () => {
    const store = memoryStore();
    const flow = new PairingFlow(store);

    // 首次扫码配对
    const credential = await flow.resolveTarget(
      {
        qr: { deviceSid: "d_1", deviceMid: "mid-1", deviceName: "PC" },
        origin: "https://api.nibistudio.cn",
      },
      "user-1",
    );
    expect(credential).toMatchObject({
      deviceSid: "d_1",
      endpointOrigin: "https://api.nibistudio.cn",
      userId: "user-1",
    });
    expect(store.get()?.deviceSid).toBe("d_1");

    // 免扫重连
    const reconnected = await flow.resolveTarget(null);
    expect(reconnected?.deviceSid).toBe("d_1");

    // 忘记凭据（设备被删/凭据过期/链接过期）
    await flow.forget();
    expect(store.get()).toBeUndefined();
    expect(await flow.resolveTarget(null)).toBeUndefined();
  });
});
