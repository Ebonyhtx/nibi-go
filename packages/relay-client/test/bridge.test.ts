import { describe, expect, it, vi } from "vitest";

import {
  ChannelClient,
  ChannelServer,
  Emitter,
  assistantTextRowSchema,
  createQueuePair,
  type ConversationTopicWireCandidate,
  type Event,
  type IServerChannel,
} from "@nibi-go/shared-extract";

import { ConversationSubscription, WorkspaceBridge } from "../src/bridge";

const TARGET = { workspacePath: "/ws", workspaceIdentity: "wi-1" };

function deltaFrame(): unknown {
  const row = assistantTextRowSchema.parse({
    rowId: 1,
    turnId: "turn-1",
    createdAt: 1_700_000_000_000,
    createdAtSeq: 1,
    kind: "assistantText",
    text: "hello",
    state: "complete",
  });
  return {
    topic: "conversation/s1",
    subscriptionId: "sub-1",
    fromSeq: 0,
    toSeq: 1,
    sentAt: 1_700_000_000_000,
    payload: { kind: "deltas", deltas: [{ op: "row.appended", row }] },
  };
}

function completeWire(frame: unknown, logicalFrameOrdinal = 1): ConversationTopicWireCandidate {
  return {
    wireVersion: 3,
    kind: "complete",
    deliveryKind: "initial",
    logicalFrameId: `lf-${logicalFrameOrdinal}`,
    logicalFrameOrdinal,
    topic: "conversation/s1",
    subscriptionId: "sub-1",
    frame,
  } as ConversationTopicWireCandidate;
}

class FakeAgentChannel implements IServerChannel {
  readonly calls: Array<{ command: string; arg: unknown }> = [];
  private readonly frames = new Emitter<ConversationTopicWireCandidate>();

  async call<T>(_ctx: string, command: string, arg?: unknown): Promise<T> {
    this.calls.push({ command, arg });
    if (command === "subscribeConversationV4") {
      return {
        ack: { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "e1" },
      } as T;
    }
    if (command === "unsubscribeConversationV4") return undefined as T;
    if (command === "sendConversationCommandV4") return { accepted: true } as T;
    throw new Error(`unknown command: ${command}`);
  }

  listen<T>(_ctx: string, event: string): Event<T> {
    if (event === "onDynamicConversationFrame") {
      return this.frames.event as unknown as Event<T>;
    }
    throw new Error(`unknown event: ${event}`);
  }

  emitFrame(wire: ConversationTopicWireCandidate): void {
    this.frames.fire(wire);
  }
}

describe("WorkspaceBridge（bootstrap / bridge-open / 控制回包路由）", () => {
  it("bootstrap → workspace-bridge-open 全流程", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bridge = new WorkspaceBridge({
      send: (payload) => {
        sent.push(payload as Record<string, unknown>);
        return true;
      },
    });

    const bootstrapPromise = bridge.bootstrap();
    expect(sent[0]).toMatchObject({ nibi_type: "bootstrap-request" });
    const bootstrapRequestId = sent[0]!.requestId as string;
    bridge.acceptPayload({
      nibi_type: "bootstrap-response",
      requestId: bootstrapRequestId,
      success: true,
      result: {
        windowControlSessionId: "w1",
        workspaces: [{ workspacePath: "/ws", label: "demo", kind: "remote" }],
      },
    });
    await expect(bootstrapPromise).resolves.toMatchObject({
      windowControlSessionId: "w1",
      workspaces: [{ workspacePath: "/ws" }],
    });

    const openPromise = bridge.openWorkspace({ workspaceKey: "/ws" });
    expect(sent[1]).toMatchObject({
      nibi_type: "workspace-bridge-open",
      workspaceKey: "/ws",
    });
    const openRequestId = sent[1]!.requestId as string;
    bridge.acceptPayload({
      nibi_type: "workspace-bridge-ready",
      requestId: openRequestId,
      bridge: {
        bridgeSessionId: "b1",
        bridgeGeneration: 0,
        recoveryId: "r1",
        kind: "remote",
        workspaceKey: "/ws",
        workspacePath: "/ws",
        workspaceIdentity: "wi-1",
        remoteSessionId: "s1",
      },
    });
    await expect(openPromise).resolves.toMatchObject({ bridgeSessionId: "b1" });
    expect(bridge.info).toMatchObject({ bridgeSessionId: "b1", remoteSessionId: "s1" });
    bridge.dispose();
  });

  it("错误回包拒绝挂起请求；bridge request 超时；relay 不可用立即失败", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const bridge = new WorkspaceBridge({
      send: (payload) => {
        sent.push(payload as Record<string, unknown>);
        return true;
      },
      requestTimeoutMs: 40,
    });
    const failing = bridge.bootstrap();
    bridge.acceptPayload({
      nibi_type: "bootstrap-response",
      requestId: sent[0]!.requestId,
      success: false,
      error: "desktop unavailable",
    });
    await expect(failing).rejects.toThrow("desktop unavailable");
    await expect(bridge.bootstrap()).rejects.toThrow("timeout");
    bridge.dispose();

    const dead = new WorkspaceBridge({ send: () => false });
    await expect(dead.bootstrap()).rejects.toThrow("relay data channel unavailable");
  });

  it("bridge-degraded 通知监听者", () => {
    const bridge = new WorkspaceBridge({ send: () => true });
    const events: Array<{ reasonCode: string }> = [];
    bridge.onDegraded((event) => events.push(event));
    expect(bridge.acceptPayload({ nibi_type: "bridge-degraded", reason: "rpc-frame-gap" })).toBe(true);
    expect(events).toEqual([{ reasonCode: "rpc-frame-gap", terminal: true }]);
    // 非桥类 payload 不吞
    expect(bridge.acceptPayload({ nibi_type: "something-else" })).toBe(false);
  });
});

describe("ConversationSubscription（真实 Channel RPC 协议 × 假服务端）", () => {
  it("订阅 ACK / topic 帧解析（过滤 + 装配）/ sendText envelope / 退订", async () => {
    const [clientProtocol, serverProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "fake-ctx");
    const fake = new FakeAgentChannel();
    server.registerChannel("nibi-agent", fake);
    const client = new ChannelClient(clientProtocol);

    const frames: unknown[] = [];
    const subscription = new ConversationSubscription(
      client.getChannel("nibi-agent"),
      TARGET,
      "s1",
      { onFrame: (frame) => frames.push(frame) },
    );

    const ack = await subscription.subscribe();
    expect(ack).toEqual({ subscriptionId: "sub-1", mode: "snapshot", logEpoch: "e1" });
    expect(fake.calls[0]).toMatchObject({
      command: "subscribeConversationV4",
      arg: { workspacePath: "/ws", workspaceIdentity: "wi-1", sessionId: "s1" },
    });

    // 无关 topic 的帧被过滤
    fake.emitFrame({
      ...completeWire(deltaFrame()),
      topic: "conversation/other",
    } as ConversationTopicWireCandidate);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(frames).toHaveLength(0);

    // 本会话帧：装配 + schema 解析后回调
    fake.emitFrame(completeWire(deltaFrame()));
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    const frame = frames[0] as {
      topic: string;
      payload: { kind: string; deltas: Array<{ op: string }> };
    };
    expect(frame.topic).toBe("conversation/s1");
    expect(frame.payload.kind).toBe("deltas");
    expect(frame.payload.deltas[0]!.op).toBe("row.appended");

    // sendText：信封形状对齐 commandEnvelopeSchema
    await subscription.sendText("hello desktop", { requestedDelivery: "queue" });
    const sendCall = fake.calls.find((c) => c.command === "sendConversationCommandV4");
    expect(sendCall).toBeDefined();
    const envelope = (sendCall!.arg as { envelope: Record<string, unknown> }).envelope;
    expect(envelope).toMatchObject({
      sessionId: "s1",
      type: "sendText",
      payload: { text: "hello desktop", requestedDelivery: "queue" },
    });
    expect(typeof envelope.commandId).toBe("string");
    expect(typeof envelope.issuedAt).toBe("number");

    // 退订
    await subscription.unsubscribe();
    expect(fake.calls.some((c) => c.command === "unsubscribeConversationV4")).toBe(true);
  });

  it("resolveInteraction（A3 审批作答）信封", async () => {
    const [clientProtocol, serverProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "fake-ctx");
    const fake = new FakeAgentChannel();
    server.registerChannel("nibi-agent", fake);
    const client = new ChannelClient(clientProtocol);
    const subscription = new ConversationSubscription(
      client.getChannel("nibi-agent"),
      TARGET,
      "s1",
      { onFrame: () => {} },
    );
    await subscription.subscribe();

    await subscription.resolveInteraction("int-1", "accept");
    const call = fake.calls.find(
      (c) =>
        c.command === "sendConversationCommandV4" &&
        (c.arg as { envelope: { type: string } }).envelope.type === "resolveInteraction",
    );
    expect(call).toBeDefined();
    expect((call!.arg as { envelope: Record<string, unknown> }).envelope).toMatchObject({
      sessionId: "s1",
      type: "resolveInteraction",
      payload: { interactionId: "int-1", answer: { action: "accept" } },
    });
  });
});
