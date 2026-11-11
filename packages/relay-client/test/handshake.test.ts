import { describe, expect, it, vi } from "vitest";

import { x25519 } from "@noble/curves/ed25519.js";

import { decodeWireBase64, encodeWireBytesBase64 } from "@nibi-go/shared-extract";

import { openPayload, sealPayload } from "../src/crypto";
import {
  KeyExchange,
  SecureDataChannel,
  deriveSessionKey,
  isKeyNegInit,
  isKeyNegResponse,
  type KeyNegInitPayload,
} from "../src/handshake";
import type { RelayJson } from "../src/types";

const CONTEXT = "d_abc";

/** 模拟桌面侧：收 init → 生成自己的临时密钥 → 回 response（按规格镜像）。 */
function desktopRespond(init: KeyNegInitPayload): { response: RelayJson; key: Uint8Array } {
  const serverSecret = x25519.utils.randomSecretKey();
  const serverPublic = x25519.getPublicKey(serverSecret);
  const serverNonce = crypto.getRandomValues(new Uint8Array(24));
  const clientPublic = decodeWireBase64(init.pub)!;
  const clientNonce = decodeWireBase64(init.nonce)!;
  const sharedSecret = x25519.getSharedSecret(serverSecret, clientPublic);
  const key = deriveSessionKey({
    sharedSecret,
    clientNonce,
    serverNonce,
    context: CONTEXT,
  });
  return {
    response: {
      nibi_type: "keyneg-response",
      v: 1,
      pub: encodeWireBytesBase64(serverPublic),
      nonce: encodeWireBytesBase64(serverNonce),
    } as unknown as RelayJson,
    key,
  };
}

describe("KeyExchange（X25519 + HKDF，规格 e2e-envelope-v1）", () => {
  it("init/response 双方派生出同一会话 K", () => {
    const exchange = new KeyExchange(CONTEXT);
    const init = exchange.initPayload();
    expect(isKeyNegInit(init)).toBe(true);
    expect(init.v).toBe(1);
    expect(decodeWireBase64(init.pub)).toHaveLength(32);
    expect(decodeWireBase64(init.nonce)).toHaveLength(24);

    const desktop = desktopRespond(init);
    const clientKey = exchange.acceptResponse(
      desktop.response as unknown as Parameters<typeof exchange.acceptResponse>[0],
    );
    expect(clientKey).not.toBeNull();
    expect(Array.from(clientKey!)).toEqual(Array.from(desktop.key));

    // 同 K：双方信封互解
    const sealed = sealPayload({ from: "phone" }, clientKey!);
    expect(openPayload(sealed, desktop.key)).toEqual({ from: "phone" });
  });

  it("非法回包材料 → null（公钥长度/非 base64）", () => {
    const exchange = new KeyExchange(CONTEXT);
    expect(
      exchange.acceptResponse({ nibi_type: "keyneg-response", v: 1, pub: "short", nonce: "x" }),
    ).toBeNull();
    expect(
      exchange.acceptResponse({
        nibi_type: "keyneg-response",
        v: 1,
        pub: encodeWireBytesBase64(new Uint8Array(31)),
        nonce: encodeWireBytesBase64(new Uint8Array(24)),
      }),
    ).toBeNull();
  });
});

describe("SecureDataChannel（transport 信封插桩点）", () => {
  function makeChannel(overrides: { timeoutMs?: number } = {}) {
    const sent: RelayJson[] = [];
    const events: string[] = [];
    const channel = new SecureDataChannel({
      send: (payload) => {
        sent.push(payload);
        return true;
      },
      context: CONTEXT,
      onSecure: () => events.push("secure"),
      onDowngrade: () => events.push("downgrade"),
      timeoutMs: overrides.timeoutMs ?? 200,
    });
    return { channel, sent, events };
  }

  it("握手完成 → 出向加密、入向解密；keyneg 自身明文", () => {
    const { channel, sent, events } = makeChannel();
    channel.begin();
    expect(sent[0]).toMatchObject({ nibi_type: "keyneg-init" });
    expect(channel.state).toBe("negotiating");

    const desktop = desktopRespond(sent[0] as unknown as KeyNegInitPayload);
    // keyneg-response 被吞掉（不进业务数据面）
    expect(channel.transformIncoming(desktop.response)).toBeNull();
    expect(channel.state).toBe("secure");
    expect(events).toEqual(["secure"]);

    // 出向：加密
    const wrapped = channel.transformOutgoing({ nibi_type: "data", hello: 1 });
    expect(wrapped).toMatchObject({ nibi_type: "enc", v: 1 });
    expect(openPayload(wrapped as never, desktop.key)).toEqual({ nibi_type: "data", hello: 1 });

    // 入向：桌面加密 → 本端解密
    const fromDesktop = sealPayload({ nibi_type: "data", reply: true }, desktop.key);
    expect(channel.transformIncoming(fromDesktop as unknown as RelayJson)).toEqual({
      nibi_type: "data",
      reply: true,
    });
  });

  it("旧桌面不响应 → timeout 降级明文 + onDowngrade", async () => {
    const { channel, events } = makeChannel({ timeoutMs: 30 });
    channel.begin();
    await vi.waitFor(() => expect(channel.state).toBe("plaintext"));
    expect(events).toEqual(["downgrade"]);
    // 降级后明文直通
    const payload = { nibi_type: "data", plain: true } as RelayJson;
    expect(channel.transformOutgoing(payload)).toBe(payload);
    expect(channel.transformIncoming(payload)).toBe(payload);
  });

  it("握手前收到 enc 载荷 → 丢弃；非法 response → 降级", () => {
    const { channel, events } = makeChannel();
    const stray = sealPayload({ a: 1 }, new Uint8Array(32));
    expect(channel.transformIncoming(stray as unknown as RelayJson)).toBeNull();

    channel.begin();
    expect(
      channel.transformIncoming({
        nibi_type: "keyneg-response",
        v: 1,
        pub: "bad",
        nonce: "bad",
      } as unknown as RelayJson),
    ).toBeNull();
    expect(channel.state).toBe("plaintext");
    expect(events).toEqual(["downgrade"]);
    channel.dispose();
  });

  it("isKeyNeg 识别", () => {
    expect(isKeyNegResponse({ nibi_type: "keyneg-response", v: 1, pub: "a", nonce: "b" })).toBe(true);
    expect(isKeyNegResponse({ nibi_type: "keyneg-response", v: 2, pub: "a", nonce: "b" })).toBe(false);
    expect(isKeyNegInit({ nibi_type: "data" })).toBe(false);
  });
});
