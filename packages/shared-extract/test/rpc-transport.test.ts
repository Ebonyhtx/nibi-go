import { describe, expect, it } from "vitest";

import {
  WebRemoteControlRpcTransportAssembler,
  WebRemoteControlRpcTransportEncodingError,
  crc32WireBytes,
  encodeWebRemoteControlRpcTransportMessage,
  encodeWireBytesBase64,
  parseWebRemoteControlRpcRelayEnvelopeJson,
  parseWebRemoteControlRpcTransportPayload,
} from "../src/index";

const identity = { bridgeSessionId: "bridge-1", bridgeGeneration: 0, recoveryId: "r-1" };
const bytesOf = (text: string) => new TextEncoder().encode(text);

function assembleAll(
  assembler: WebRemoteControlRpcTransportAssembler,
  frames: ReturnType<typeof encodeWebRemoteControlRpcTransportMessage>,
  now?: () => number,
) {
  return frames.map((frame) => assembler.accept(frame, now ? now() : Date.now()));
}

describe("rpc-frame 传输层（抽取件，golden 对齐桌面）", () => {
  it("crc32 已知向量", () => {
    expect(crc32WireBytes(bytesOf("123456789"))).toBe("cbf43926");
    expect(crc32WireBytes(new Uint8Array(0))).toBe("00000000");
  });

  it("单帧往返：encode → assemble → complete 字节一致", () => {
    const message = bytesOf("hello-nibi-go");
    const frames = encodeWebRemoteControlRpcTransportMessage(message, {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      nibi_type: "rpc-frame",
      seq: 1,
      messageSeq: 1,
      fragmentIndex: 0,
      fragmentCount: 1,
      messageBytes: message.byteLength,
    });
    const assembler = new WebRemoteControlRpcTransportAssembler({ identity });
    const [event] = assembleAll(assembler, frames);
    expect(event.kind).toBe("complete");
    if (event.kind !== "complete") throw new Error("unreachable");
    expect(Array.from(event.bytes)).toEqual(Array.from(message));
  });

  it("多分片往返：小帧上限强制分片，assemble 还原", () => {
    const message = bytesOf("A".repeat(300));
    const frames = encodeWebRemoteControlRpcTransportMessage(message, {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
      maxPhysicalFrameBytes: 400,
    });
    expect(frames.length).toBeGreaterThan(1);
    const assembler = new WebRemoteControlRpcTransportAssembler({
      identity,
      maxPhysicalFrameBytes: 400,
    });
    const events = assembleAll(assembler, frames);
    expect(events.slice(0, -1).every((e) => e.kind === "incomplete")).toBe(true);
    const last = events.at(-1)!;
    expect(last.kind).toBe("complete");
    if (last.kind !== "complete") throw new Error("unreachable");
    expect(new TextDecoder().decode(last.bytes)).toBe("A".repeat(300));
  });

  it("重复帧 → duplicate（不判 fault），且携带已完成的 ackMessageSeq", () => {
    const frames = encodeWebRemoteControlRpcTransportMessage(bytesOf("dup-test"), {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
    });
    const assembler = new WebRemoteControlRpcTransportAssembler({ identity });
    expect(assembler.accept(frames[0]!).kind).toBe("complete");
    const duplicate = assembler.accept(frames[0]!);
    expect(duplicate).toEqual({ kind: "duplicate", ackMessageSeq: 1 });
  });

  it("物理序号缺口 → terminal physicalGap", () => {
    const frames = encodeWebRemoteControlRpcTransportMessage(bytesOf("A".repeat(300)), {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
      maxPhysicalFrameBytes: 400,
    });
    const assembler = new WebRemoteControlRpcTransportAssembler({ identity });
    expect(assembler.accept(frames[0]!).kind).toBe("incomplete");
    const gap = assembler.accept(frames[2]!);
    expect(gap).toMatchObject({
      kind: "fault",
      fault: { reasonCode: "remote.rpcFrame.physicalGap", terminal: true },
    });
  });

  it("消息序号缺口 → terminal messageGap", () => {
    const frames = encodeWebRemoteControlRpcTransportMessage(bytesOf("msg-2"), {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 2,
    });
    const assembler = new WebRemoteControlRpcTransportAssembler({ identity });
    const event = assembler.accept(frames[0]!);
    expect(event).toMatchObject({
      kind: "fault",
      fault: { reasonCode: "remote.rpcFrame.messageGap", terminal: true },
    });
  });

  it("校验和篡改 → terminal checksumMismatch", () => {
    const frames = encodeWebRemoteControlRpcTransportMessage(bytesOf("tamper"), {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
    });
    const tampered = { ...frames[0]!, checksum: { algorithm: "crc32" as const, value: "00000000" } };
    const assembler = new WebRemoteControlRpcTransportAssembler({ identity });
    expect(assembler.accept(tampered)).toMatchObject({
      kind: "fault",
      fault: { reasonCode: "remote.rpcFrame.checksumMismatch", terminal: true },
    });
  });

  it("外来身份 → 非 terminal identityMismatch，本连接 assembly 不受影响", () => {
    const foreign = encodeWebRemoteControlRpcTransportMessage(bytesOf("foreign"), {
      bridgeSessionId: "bridge-OTHER",
      firstPhysicalSeq: 1,
      messageSeq: 1,
    });
    const own = encodeWebRemoteControlRpcTransportMessage(bytesOf("own"), {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
    });
    const assembler = new WebRemoteControlRpcTransportAssembler({ identity });
    expect(assembler.accept(foreign[0]!)).toMatchObject({
      kind: "fault",
      fault: { reasonCode: "remote.rpcFrame.identityMismatch", terminal: false },
    });
    // 本连接的帧仍可正常完成
    expect(assembler.accept(own[0]!).kind).toBe("complete");
  });

  it("装配超时 → terminal assemblyTimeout（now 注入）", () => {
    const frames = encodeWebRemoteControlRpcTransportMessage(bytesOf("A".repeat(300)), {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
      maxPhysicalFrameBytes: 400,
    });
    let now = 1_000;
    const assembler = new WebRemoteControlRpcTransportAssembler({
      identity,
      timeoutMs: 5_000,
      now: () => now,
    });
    expect(assembler.accept(frames[0]!).kind).toBe("incomplete");
    expect(assembler.nextExpiryAt).toBe(6_000);
    now = 7_000;
    expect(assembler.accept(frames[1]!)).toMatchObject({
      kind: "fault",
      fault: { reasonCode: "remote.rpcFrame.assemblyTimeout", terminal: true },
    });
  });

  it("空消息 / 非法身份 → 编码错误", () => {
    expect(() =>
      encodeWebRemoteControlRpcTransportMessage(new Uint8Array(0), {
        ...identity,
        firstPhysicalSeq: 1,
        messageSeq: 1,
      }),
    ).toThrow(WebRemoteControlRpcTransportEncodingError);
    expect(() =>
      encodeWebRemoteControlRpcTransportMessage(bytesOf("x"), {
        bridgeSessionId: "bad id!",
        firstPhysicalSeq: 1,
        messageSeq: 1,
      }),
    ).toThrow(WebRemoteControlRpcTransportEncodingError);
  });

  it("relay envelope JSON 解析：合法/非法 JSON/超限", () => {
    const frames = encodeWebRemoteControlRpcTransportMessage(bytesOf("env"), {
      ...identity,
      firstPhysicalSeq: 1,
      messageSeq: 1,
    });
    const envelope = { type: "data", payload: frames[0], server_ts: 1_700_000_000 };
    const accepted = parseWebRemoteControlRpcRelayEnvelopeJson(JSON.stringify(envelope));
    expect(accepted.kind).toBe("accepted");
    expect(parseWebRemoteControlRpcRelayEnvelopeJson("{not json")).toMatchObject({
      kind: "fault",
      fault: { reasonCode: "remote.rpcFrame.invalidJson", terminal: true },
    });
    expect(
      parseWebRemoteControlRpcRelayEnvelopeJson(JSON.stringify(envelope), {
        maxPhysicalFrameBytes: 16,
      }),
    ).toMatchObject({
      kind: "fault",
      fault: { reasonCode: "remote.rpcFrame.envelopeTooLarge", terminal: true },
    });
    // 非 canonical base64 的 payload 不是合法 frame（schema 拒绝）
    expect(
      parseWebRemoteControlRpcTransportPayload({
        ...frames[0],
        dataBase64: "not-base64!!",
      }),
    ).toBeNull();
    expect(parseWebRemoteControlRpcTransportPayload(frames[0])).not.toBeNull();
  });

  it("ack 载荷 schema（rpc-frame-ack）", () => {
    expect(
      parseWebRemoteControlRpcTransportPayload({
        nibi_type: "rpc-frame-ack",
        bridgeSessionId: "bridge-1",
        ackMessageSeq: 3,
      }),
    ).toMatchObject({ nibi_type: "rpc-frame-ack", ackMessageSeq: 3 });
    expect(
      parseWebRemoteControlRpcTransportPayload({ nibi_type: "rpc-frame-ack", bridgeSessionId: "b" }),
    ).toBeNull();
  });

  it("base64 编码往返", () => {
    const data = new Uint8Array([0, 1, 2, 253, 254, 255, 42]);
    const encoded = encodeWireBytesBase64(data);
    const decoded = new Uint8Array(atob(encoded).split("").map((c) => c.charCodeAt(0)));
    expect(Array.from(decoded)).toEqual(Array.from(data));
  });
});
