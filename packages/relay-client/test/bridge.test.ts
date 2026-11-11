import { describe, expect, it, vi } from "vitest";

import {
  ChannelClient,
  ChannelServer,
  Emitter,
  V4_WIRE_PROTOCOL_VERSION,
  assistantTextRowSchema,
  createQueuePair,
  sessionsIndexSnapshotSchema,
  type ClientHello,
  type ConversationTopicWireCandidate,
  type Event,
  type IServerChannel,
  type SessionsIndexTopicWireCandidate,
} from "@nibi-go/shared-extract";

import {
  ConversationSubscription,
  SessionsIndexSubscription,
  WorkspaceBridge,
} from "../src/bridge";
import {
  AgentV4AttachmentHandshake,
  BridgeHandshakeError,
} from "../src/v4Attachment";

const HANDSHAKE_HELLO = {
  kind: "hello" as const,
  protocolVersion: V4_WIRE_PROTOCOL_VERSION,
  connectionId: "conn-1",
  clientMode: "web-remote-replayable" as const,
  deliveryProfile: "replayable" as const,
  serverTime: 1_700_000_000_000,
  capabilities: {
    nativeDialogs: false,
    localTerminal: false,
    binaryFrames: false,
    compression: "none" as const,
    workspaceHookReview: true,
    independentPlanState: true,
    workflowRunDeltas: true,
    historyFirst: true,
  },
  auth: {},
};

/** 桌面 ProxyChannel 的 call 契约：arg 是方法实参数组（target.apply(handler, args)）。 */
function rpcParam<T>(arg: unknown): T {
  if (!Array.isArray(arg)) {
    throw new Error(`RPC args must be an array, got ${typeof arg}`);
  }
  return arg[0] as T;
}

function makeChannelPair(behavior: {
  helloError?: Error;
  initializeError?: Error;
} = {}) {
  const [clientProtocol, serverProtocol] = createQueuePair();
  const server = new ChannelServer(serverProtocol, "fake-ctx");
  const fake = new FakeAgentChannel(behavior);
  server.registerChannel("nibi-agent", fake);
  const client = new ChannelClient(clientProtocol);
  return { client, fake };
}

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
  private readonly sessionsFrames = new Emitter<SessionsIndexTopicWireCandidate>();

  constructor(
    private readonly behavior: { helloError?: Error; initializeError?: Error } = {},
  ) {}

  async call<T>(_ctx: string, command: string, arg?: unknown): Promise<T> {
    this.calls.push({ command, arg });
    if (command === "helloConversationV4") {
      if (this.behavior.helloError) throw this.behavior.helloError;
      return HANDSHAKE_HELLO as T;
    }
    if (command === "initializeConversationV4") {
      rpcParam(arg);
      if (this.behavior.initializeError) throw this.behavior.initializeError;
      return undefined as T;
    }
    if (command === "subscribeConversationV4") {
      rpcParam(arg);
      return {
        ack: { subscriptionId: "sub-1", mode: "snapshot", logEpoch: "e1" },
      } as T;
    }
    if (command === "subscribeSessionsIndexV4") {
      rpcParam(arg);
      return {
        ack: { subscriptionId: "sidx-1", mode: "snapshot", logEpoch: "e1" },
      } as T;
    }
    if (
      command === "unsubscribeConversationV4" ||
      command === "unsubscribeSessionsIndexV4"
    ) {
      rpcParam(arg);
      return undefined as T;
    }
    if (command === "sendConversationCommandV4") {
      rpcParam(arg);
      return { accepted: true } as T;
    }
    throw new Error(`unknown command: ${command}`);
  }

  listen<T>(_ctx: string, event: string): Event<T> {
    if (event === "onDynamicConversationFrame") {
      return this.frames.event as unknown as Event<T>;
    }
    if (event === "onDynamicSessionsIndexFrame") {
      return this.sessionsFrames.event as unknown as Event<T>;
    }
    throw new Error(`unknown event: ${event}`);
  }

  emitFrame(wire: ConversationTopicWireCandidate): void {
    this.frames.fire(wire);
  }

  emitSessionsFrame(wire: SessionsIndexTopicWireCandidate): void {
    this.sessionsFrames.fire(wire);
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
      arg: [{ workspacePath: "/ws", workspaceIdentity: "wi-1", sessionId: "s1" }],
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
    const envelope = rpcParam<{ envelope: Record<string, unknown> }>(
      sendCall!.arg,
    ).envelope;
    expect(envelope).toMatchObject({
      sessionId: "s1",
      type: "sendText",
      payload: { text: "hello desktop", requestedDelivery: "queue" },
    });
    expect(typeof envelope.commandId).toBe("string");
    expect(typeof envelope.issuedAt).toBe("number");

    // 退订：实参数组 + 完整 target（workspaceIdentity 参与桌面 ownership 匹配）
    await subscription.unsubscribe();
    const unsubscribe = fake.calls.find(
      (c) => c.command === "unsubscribeConversationV4",
    );
    expect(unsubscribe).toBeDefined();
    expect(unsubscribe!.arg).toEqual([{ ...TARGET, subscriptionId: "sub-1" }]);
  });

  it("resolveInteraction：新路径按 optionId；无 options 的旧载荷退回 action", async () => {
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

    await subscription.resolveInteraction("int-allow", { optionId: "allowOnce" });
    await subscription.resolveInteraction("int-deny", { optionId: "deny" });
    // 旧载荷（userInput/无 options）与 cancel 仍走 action 闭集
    await subscription.resolveInteraction("int-legacy", { action: "decline" });
    await subscription.resolveInteraction("int-cancel", { action: "cancel" });

    const answers = fake.calls
      .filter((c) => c.command === "sendConversationCommandV4")
      .map(
        (c) =>
          rpcParam<{ envelope: { type: string; payload: unknown } }>(c.arg)
            .envelope,
      )
      .filter((envelope) => envelope.type === "resolveInteraction")
      .map(
        (envelope) =>
          envelope.payload as {
            interactionId: string;
            answer: Record<string, unknown>;
          },
      );
    expect(answers).toEqual([
      { interactionId: "int-allow", answer: { optionId: "allowOnce" } },
      { interactionId: "int-deny", answer: { optionId: "deny" } },
      { interactionId: "int-legacy", answer: { action: "decline" } },
      { interactionId: "int-cancel", answer: { action: "cancel" } },
    ]);
    await expect(
      subscription.resolveInteraction("int-empty", {}),
    ).rejects.toThrow("requires optionId");
  });
});

describe("V4 attachment 握手（hello → clientHello）", () => {
  it("首次订阅前按 hello → clientHello 顺序；并发首订阅共享同一次握手", async () => {
    const { client, fake } = makeChannelPair();
    const handshake = new AgentV4AttachmentHandshake(
      client.getChannel("nibi-agent"),
      "client-1",
    );
    const channel = client.getChannel("nibi-agent");
    const conversation1 = new ConversationSubscription(
      channel,
      TARGET,
      "s1",
      { onFrame: () => {} },
      Date.now,
      handshake,
    );
    const conversation2 = new ConversationSubscription(
      channel,
      TARGET,
      "s2",
      { onFrame: () => {} },
      Date.now,
      handshake,
    );
    const sessionsIndex = new SessionsIndexSubscription(
      channel,
      TARGET,
      { onFrame: () => {} },
      Date.now,
      handshake,
    );

    await Promise.all([
      conversation1.subscribe(),
      conversation2.subscribe(),
      sessionsIndex.subscribe(),
    ]);

    const names = fake.calls.map((call) => call.command);
    expect(names.filter((name) => name === "helloConversationV4")).toHaveLength(1);
    expect(names.filter((name) => name === "initializeConversationV4")).toHaveLength(1);
    expect(names.indexOf("helloConversationV4")).toBeLessThan(
      names.indexOf("initializeConversationV4"),
    );
    expect(names.indexOf("initializeConversationV4")).toBeLessThan(
      names.indexOf("subscribeConversationV4"),
    );
    expect(names.indexOf("initializeConversationV4")).toBeLessThan(
      names.indexOf("subscribeSessionsIndexV4"),
    );
    expect(handshake.state).toBe("complete");

    const clientHello = rpcParam<ClientHello>(
      fake.calls.find((call) => call.command === "initializeConversationV4")!.arg,
    );
    expect(clientHello).toMatchObject({
      kind: "clientHello",
      protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      clientId: "client-1",
      clientKind: "mobileApp",
      appVersion: "unknown",
      // 只回声明 Host 在 hello 里声明过的能力（strictObject，多加键会整条解析失败）
      capabilities: { historyFirst: true, workflowRunDeltas: true },
    });
    expect(clientHello.capabilities).not.toHaveProperty("workspaceHookReviewUi");
  });

  it("旧桌面（握手方法不存在）降级：跳过 clientHello，订阅继续，且不重复探测", async () => {
    const { client, fake } = makeChannelPair({
      helloError: new Error("Method not found: helloConversationV4"),
    });
    const handshake = new AgentV4AttachmentHandshake(
      client.getChannel("nibi-agent"),
      "client-legacy",
    );
    const subscription = new ConversationSubscription(
      client.getChannel("nibi-agent"),
      TARGET,
      "s1",
      { onFrame: () => {} },
      Date.now,
      handshake,
    );

    await expect(subscription.subscribe()).resolves.toMatchObject({ subscriptionId: "sub-1" });
    expect(handshake.state).toBe("legacy");
    expect(fake.calls.map((call) => call.command)).toEqual([
      "helloConversationV4",
      "subscribeConversationV4",
    ]);

    // 同一 attachment 后续订阅直接复用 legacy 结论，不再探测
    const second = new ConversationSubscription(
      client.getChannel("nibi-agent"),
      TARGET,
      "s2",
      { onFrame: () => {} },
      Date.now,
      handshake,
    );
    await second.subscribe();
    expect(
      fake.calls.filter((call) => call.command === "helloConversationV4"),
    ).toHaveLength(1);
  });

  it("握手被拒可诊断：BridgeHandshakeError(kind=rejected)，消息带桌面原因", async () => {
    const { client } = makeChannelPair({
      initializeError: new Error("fault.connection.clientChanged"),
    });
    const handshake = new AgentV4AttachmentHandshake(
      client.getChannel("nibi-agent"),
      "client-1",
    );
    const subscription = new ConversationSubscription(
      client.getChannel("nibi-agent"),
      TARGET,
      "s1",
      { onFrame: () => {} },
      Date.now,
      handshake,
    );

    const failure = await subscription.subscribe().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BridgeHandshakeError);
    expect(failure).toMatchObject({ kind: "rejected" });
    expect((failure as Error).message).toContain("fault.connection.clientChanged");
    expect(handshake.state).toBe("failed");
  });

  it("hello 存在但 clientHello 方法缺失 → kind=unsupported（区别于被拒）", async () => {
    const { client } = makeChannelPair({
      initializeError: new Error("Method not found: initializeConversationV4"),
    });
    const handshake = new AgentV4AttachmentHandshake(
      client.getChannel("nibi-agent"),
      "client-1",
    );
    const failure = await handshake.ensureHandshake().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BridgeHandshakeError);
    expect(failure).toMatchObject({ kind: "unsupported" });
  });

  it("clientId 在 attachment 内稳定：多条订阅 + 命令共用同一 clientId", async () => {
    const { client, fake } = makeChannelPair();
    const handshake = new AgentV4AttachmentHandshake(
      client.getChannel("nibi-agent"),
      "client-stable",
    );
    const channel = client.getChannel("nibi-agent");
    const first = new ConversationSubscription(
      channel,
      TARGET,
      "s1",
      { onFrame: () => {} },
      Date.now,
      handshake,
    );
    const second = new ConversationSubscription(
      channel,
      TARGET,
      "s2",
      { onFrame: () => {} },
      Date.now,
      handshake,
    );
    await Promise.all([first.subscribe(), second.subscribe()]);
    await first.sendText("one");
    await second.sendText("two");

    const clientHello = rpcParam<ClientHello>(
      fake.calls.find((call) => call.command === "initializeConversationV4")!.arg,
    );
    expect(clientHello.clientId).toBe("client-stable");

    const commandClientIds = fake.calls
      .filter((call) => call.command === "sendConversationCommandV4")
      .map(
        (call) =>
          rpcParam<{ envelope: { clientId: string } }>(call.arg).envelope
            .clientId,
      );
    expect(commandClientIds).toEqual(["client-stable", "client-stable"]);
  });
});

describe("SessionsIndexSubscription（会话列表通道）", () => {
  it("订阅 ACK / 快照帧解析 / topic 过滤 / 退订", async () => {
    const [clientProtocol, serverProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "fake-ctx");
    const fake = new FakeAgentChannel();
    server.registerChannel("nibi-agent", fake);
    const client = new ChannelClient(clientProtocol);

    const frames: unknown[] = [];
    const subscription = new SessionsIndexSubscription(
      client.getChannel("nibi-agent"),
      TARGET,
      { onFrame: (frame) => frames.push(frame) },
    );

    const ack = await subscription.subscribe();
    expect(ack).toMatchObject({ subscriptionId: "sidx-1" });
    expect(fake.calls[0]).toMatchObject({
      command: "subscribeSessionsIndexV4",
      arg: [{ workspacePath: "/ws" }],
    });

    const snapshot = sessionsIndexSnapshotSchema.parse({
      protocolVersion: 1,
      workspaceId: "ws-1",
      logEpoch: "e1",
      sessions: [
        {
          sessionId: "s1",
          workspaceId: "ws-1",
          title: "演示会话",
          phase: "running",
          sessionEnded: false,
          hasBackgroundWork: false,
          lastActivityAt: 1_700_000_000_000,
          createdAt: 1_700_000_000_000,
        },
      ],
    });
    const sessionsFrame = {
      topic: "sessions-index/ws-1",
      subscriptionId: "sidx-1",
      fromSeq: 0,
      toSeq: 1,
      sentAt: 1_700_000_000_000,
      payload: { kind: "snapshot", snapshot },
    };

    // 无关 topic 被过滤
    fake.emitSessionsFrame({
      wireVersion: 3,
      kind: "complete",
      deliveryKind: "initial",
      logicalFrameId: "lf-1",
      logicalFrameOrdinal: 1,
      topic: "conversation/s1",
      subscriptionId: "sidx-1",
      frame: sessionsFrame,
    } as unknown as SessionsIndexTopicWireCandidate);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(frames).toHaveLength(0);

    fake.emitSessionsFrame({
      wireVersion: 3,
      kind: "complete",
      deliveryKind: "initial",
      logicalFrameId: "lf-2",
      logicalFrameOrdinal: 2,
      topic: "sessions-index/ws-1",
      subscriptionId: "sidx-1",
      frame: sessionsFrame,
    } as unknown as SessionsIndexTopicWireCandidate);
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    const frame = frames[0] as {
      payload: { kind: string; snapshot: { sessions: Array<{ title: string }> } };
    };
    expect(frame.payload.kind).toBe("snapshot");
    expect(frame.payload.snapshot.sessions[0]!.title).toBe("演示会话");

    await subscription.unsubscribe();
    const unsubscribe = fake.calls.find(
      (c) => c.command === "unsubscribeSessionsIndexV4",
    );
    expect(unsubscribe).toBeDefined();
    expect(unsubscribe!.arg).toEqual([{ ...TARGET, subscriptionId: "sidx-1" }]);
  });
});
