import { describe, expect, it, vi } from "vitest";

import {
  KERNEL_METHODS,
  KernelProtocolError,
  KernelSessionClient,
  type KernelNotification,
  type KernelSessionClientOptions,
  type KernelTransport,
} from "../src/index";

class FakeTransport implements KernelTransport {
  readonly sent: string[] = [];
  private readonly listeners = new Set<(line: string) => void>();

  sendLine(line: string): boolean {
    this.sent.push(line);
    return true;
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  receive(frame: unknown): void {
    const line = JSON.stringify(frame);
    for (const listener of this.listeners) listener(line);
  }

  lastFrame(): Record<string, unknown> {
    const line = this.sent.at(-1);
    if (!line) throw new Error("没有发出任何帧");
    return JSON.parse(line) as Record<string, unknown>;
  }
}

const workspace = { workspacePath: "/files/", workspaceKey: "/files/" };

function createClient(
  transport: FakeTransport,
  options: Omit<KernelSessionClientOptions, "transport"> = {},
): KernelSessionClient {
  return new KernelSessionClient({ transport, ...options });
}

describe("@nibi-go/kernel-session", () => {
  it("createSession：发 session/create 并记住 sessionId", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);

    const pending = client.createSession(workspace);
    const frame = transport.lastFrame();
    expect(frame).toEqual({
      id: 1,
      method: KERNEL_METHODS.sessionCreate,
      params: { workspace },
    });

    transport.receive({
      id: 1,
      result: { session: { sessionId: "sess_1", status: "idle" }, protocol: { name: "NIBI" } },
    });
    const result = await pending;
    expect(result.sessionId).toBe("sess_1");
    expect(client.currentSessionId).toBe("sess_1");
  });

  it("createSession：没有 sessionId 时 reject", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: {} } });
    await expect(pending).rejects.toThrow("没有返回 sessionId");
  });

  it("createSession：把插件 MCP 服务器随会话带上", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.createSession(workspace, undefined, [
      {
        name: "nibigo_weather",
        command: "node",
        args: ["/files/plugins/weather/server.mjs"],
        alwaysLoad: true,
        timeoutMs: 20_000,
      },
    ]);
    expect(transport.lastFrame().params).toMatchObject({
      workspace,
      mcpServers: [
        {
          name: "nibigo_weather",
          command: "node",
          args: ["/files/plugins/weather/server.mjs"],
          alwaysLoad: true,
          timeoutMs: 20_000,
        },
      ],
    });
    transport.receive({ id: 1, result: { session: { sessionId: "sess_mcp" } } });
    await expect(pending).resolves.toMatchObject({ sessionId: "sess_mcp" });
  });

  it("createSession：options.persistence=deferred 时随请求带上（草稿不落库）", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.createSession(workspace, undefined, undefined, {
      persistence: "deferred",
    });
    expect(transport.lastFrame()).toEqual({
      id: 1,
      method: KERNEL_METHODS.sessionCreate,
      params: { workspace, persistence: "deferred" },
    });
    transport.receive({ id: 1, result: { session: { sessionId: "sess_draft" } } });
    await expect(pending).resolves.toMatchObject({ sessionId: "sess_draft" });
    expect(client.currentSessionId).toBe("sess_draft");
  });

  it("createSession：没给 options 时请求里不带 persistence 字段", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.createSession(workspace, {
      providerId: "p",
      modelId: "m",
    });
    expect(transport.lastFrame()).toEqual({
      id: 1,
      method: KERNEL_METHODS.sessionCreate,
      params: { workspace, model: { providerId: "p", modelId: "m" } },
    });
    transport.receive({ id: 1, result: { session: { sessionId: "sess_imm" } } });
    await pending;
  });

  it("resumeSession：resume 也带上 MCP 服务器（内核不持久化这份配置）", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.resumeSession("sess_mcp", [
      { name: "nibigo_weather", command: "node", args: ["/files/plugins/weather/server.mjs"] },
    ]);
    expect(transport.lastFrame()).toEqual({
      id: 1,
      method: KERNEL_METHODS.sessionResume,
      params: {
        sessionId: "sess_mcp",
        mcpServers: [
          {
            name: "nibigo_weather",
            command: "node",
            args: ["/files/plugins/weather/server.mjs"],
          },
        ],
      },
    });
    transport.receive({ id: 1, result: { session: { sessionId: "sess_mcp" } } });
    await pending;
    expect(client.currentSessionId).toBe("sess_mcp");
  });

  it("自动应答内核的 session/requestRuntimePreferences（默认最小集合）", async () => {
    const transport = new FakeTransport();
    createClient(transport);

    transport.receive({
      id: "rs-1",
      method: KERNEL_METHODS.requestRuntimePreferences,
      params: { sessionId: "sess_1", scope: "runtime-materialization" },
    });

    expect(transport.lastFrame()).toEqual({
      id: "rs-1",
      result: { nativeSearchEnhancementsEnabled: false },
    });
  });

  it("运行期偏好可定制，并按 scope 传入", () => {
    const transport = new FakeTransport();
    const responder = vi.fn((scope: string) => ({ nativeSearchEnhancementsEnabled: scope === "user-execution" }));
    createClient(transport, { runtimePreferences: responder });

    transport.receive({
      id: "rs-2",
      method: KERNEL_METHODS.requestRuntimePreferences,
      params: { scope: "user-execution" },
    });

    expect(responder).toHaveBeenCalledWith("user-execution");
    expect(transport.lastFrame()).toEqual({
      id: "rs-2",
      result: { nativeSearchEnhancementsEnabled: true },
    });
  });

  it("未知的内核请求回 -32601，不抛给调用方", () => {
    const transport = new FakeTransport();
    createClient(transport);
    transport.receive({ id: "rs-9", method: "session/unknownThing", params: {} });
    expect(transport.lastFrame()).toEqual({
      id: "rs-9",
      error: { code: -32601, message: "Method not found: session/unknownThing" },
    });
  });

  it("sendPrompt：需要先建会话；发出 session/send 并映射 accepted", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    await expect(client.sendPrompt("hi")).rejects.toThrow("先 createSession");

    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_2" } } });
    await created;

    const pending = client.sendPrompt("你好");
    expect(transport.lastFrame()).toEqual({
      id: 2,
      method: KERNEL_METHODS.sessionSend,
      params: { sessionId: "sess_2", content: "你好" },
    });
    transport.receive({ id: 2, result: { accepted: true, stateRevision: 3 } });
    await expect(pending).resolves.toEqual({ accepted: true, stateRevision: 3 });
  });

  it("sendText：v4/command 带引用与插件能力，ACCEPT 后返回交付方式", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_3" } } });
    await created;

    const pending = client.sendText("看这里", {
      conversationQuotes: [
        {
          text: "选中的一小段",
          kind: "annotation",
          comment: "这里不对",
          number: 1,
          messageKey: "m1",
          messageRole: "assistant",
        },
      ],
      pluginReferences: [
        {
          id: "nibigo-weather@inline",
          name: "天气",
          mcpServers: ["nibigo_weather"],
          commands: ["nibigo-weather-weather"],
        },
      ],
      mode: "guarded",
      planEnabled: true,
      modelSelection: {
        providerId: "personal:test",
        modelId: "kimi-k3",
        reasoningLevel: "max",
      },
    });
    const frame = transport.lastFrame();
    expect(frame).toMatchObject({
      method: KERNEL_METHODS.command,
      params: {
        clientId: "nibi-go",
        sessionId: "sess_3",
        type: "sendText",
        payload: {
          text: "看这里",
          inputOrigin: "mobile",
          requestedDelivery: "startNow",
          conversationQuotes: [{ text: "选中的一小段", kind: "annotation" }],
          pluginReferences: [{ id: "nibigo-weather@inline" }],
          mode: "guarded",
          planEnabled: true,
          modelSelection: {
            providerId: "personal:test",
            modelId: "kimi-k3",
            options: { reasoningLevel: "max" },
          },
        },
      },
    });
    transport.receive({ id: 2, result: { status: "accepted", result: { delivery: "startNow" } } });
    await expect(pending).resolves.toEqual({ accepted: true, delivery: "startNow" });
  });

  it("sendText：rejected/failed 抛出内核原因", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_6" } } });
    await created;
    const pending = client.sendText("hi");
    transport.receive({
      id: 2,
      result: { status: "rejected", reasonCode: "guard.inputRejected", message: "输入被拒绝" },
    });
    await expect(pending).rejects.toThrow("输入被拒绝");
  });

  it("goal：走 session/goal，回执原样带回；set 带 objective", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_goal" } } });
    await created;

    const shown = client.goal("show");
    expect(transport.lastFrame()).toMatchObject({
      method: KERNEL_METHODS.sessionGoal,
      params: { sessionId: "sess_goal", action: "show" },
    });
    transport.receive({
      id: 2,
      result: { response: "No goal is set. Use /goal <objective> to set one.", startedTurn: false },
    });
    await expect(shown).resolves.toEqual({
      response: "No goal is set. Use /goal <objective> to set one.",
      startedTurn: false,
    });

    const set = client.goal("set", "把文档写完");
    expect(transport.lastFrame()).toMatchObject({
      method: KERNEL_METHODS.sessionGoal,
      params: { sessionId: "sess_goal", action: "set", objective: "把文档写完" },
    });
    transport.receive({ id: 3, result: { response: "", startedTurn: true } });
    await expect(set).resolves.toEqual({ response: "", startedTurn: true });
  });

  it("compact：发 v4/command 的 compact，有回合在跑时抛内核原因", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_c" } } });
    await created;

    const ok = client.compact();
    const frame = transport.lastFrame();
    expect(frame).toMatchObject({ method: KERNEL_METHODS.command });
    expect(frame.params).toMatchObject({
      sessionId: "sess_c",
      type: "compact",
      payload: {},
    });
    transport.receive({ id: 2, result: { status: "accepted" } });
    await expect(ok).resolves.toBeUndefined();

    const busy = client.compact();
    transport.receive({
      id: 3,
      result: {
        status: "rejected",
        reasonCode: "fault.command.compactFailed",
        message: "a turn is running; compact after it finishes",
      },
    });
    await expect(busy).rejects.toThrow("a turn is running");
  });

  it("retryTurn：发 v4/command 的 retryTurn，拒绝时抛内核原因", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_r" } } });
    await created;

    const target = { rowId: 7, entityId: "turn_abc" };
    const bases = { revision: 12, logEpoch: "epoch-1" };
    const ok = client.retryTurn(target, bases);
    expect(transport.lastFrame()).toMatchObject({
      method: KERNEL_METHODS.command,
      params: {
        sessionId: "sess_r",
        type: "retryTurn",
        payload: { target },
        baseRevision: 12,
        baseLogEpoch: "epoch-1",
      },
    });
    transport.receive({ id: 2, result: { status: "accepted" } });
    await expect(ok).resolves.toBeUndefined();

    const rejected = client.retryTurn(target, bases);
    transport.receive({
      id: 3,
      result: { status: "rejected", reasonCode: "guard.retryNotLatest", message: "只有最后一轮能重试" },
    });
    await expect(rejected).rejects.toThrow("只有最后一轮能重试");
  });

  it("resolveInteraction：发 v4/command 信封，noop（已收口）也算成功", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_4" } } });
    await created;

    const pending = client.resolveInteraction("int_1", { optionId: "allowOnce" });
    const frame = transport.lastFrame();
    expect(frame).toMatchObject({
      method: KERNEL_METHODS.command,
      params: {
        clientId: "nibi-go",
        sessionId: "sess_4",
        type: "resolveInteraction",
        payload: { interactionId: "int_1", answer: { optionId: "allowOnce" } },
      },
    });
    expect(String((frame.params as { commandId?: unknown }).commandId)).toMatch(
      /^resolve-int_1-/u,
    );
    expect(typeof (frame.params as { issuedAt?: unknown }).issuedAt).toBe("number");
    transport.receive({ id: 2, result: { status: "noop", memoryEnabled: false } });
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolveInteraction：rejected/failed 变成带原因的拒绝", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport, { clientId: "nibi-go-test" });
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_5" } } });
    await created;

    const pending = client.resolveInteraction("int_2", {
      action: "accept",
      content: { answers: { "用哪个方案？": "方案 A" } },
    });
    expect(transport.lastFrame().params).toMatchObject({ clientId: "nibi-go-test" });
    transport.receive({
      id: 2,
      result: { status: "rejected", message: "the interaction is no longer pending" },
    });
    await expect(pending).rejects.toThrow("the interaction is no longer pending");
  });

  it("purgeSessionData：发 v4/storage/sessionData/purge，返回释放字节", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.purgeSessionData(["sess_a"], []);
    expect(transport.lastFrame()).toEqual({
      id: 1,
      method: KERNEL_METHODS.sessionDataPurge,
      params: { sessionIds: ["sess_a"], directories: [] },
    });
    transport.receive({
      id: 1,
      result: {
        deleted: [{ sessionId: "sess_a", bytes: 2048 }],
        kept: [],
        failed: [],
        memory: [],
      },
    });
    await expect(pending).resolves.toMatchObject({
      deleted: [{ sessionId: "sess_a", bytes: 2048 }],
    });
  });

  it("fileChanges：按轮头行取明细，带 target 与快照水位", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_6" } } });
    await created;

    const pending = client.fileChanges(
      { rowId: 7, entityId: "turn_7" },
      { revision: 3, logEpoch: "epoch-1" },
    );
    expect(transport.lastFrame()).toEqual({
      id: 2,
      method: KERNEL_METHODS.fileChanges,
      params: {
        sessionId: "sess_6",
        target: { rowId: 7, entityId: "turn_7" },
        baseRevision: 3,
        baseLogEpoch: "epoch-1",
      },
    });
    transport.receive({
      id: 2,
      result: {
        files: 1,
        additions: 1,
        deletions: 0,
        items: [
          {
            path: "/w/a.ts",
            additions: 1,
            deletions: 0,
            writeCount: 1,
            toolNames: ["Write"],
            patches: [],
          },
        ],
      },
    });
    await expect(pending).resolves.toMatchObject({
      files: 1,
      additions: 1,
      items: [{ path: "/w/a.ts", additions: 1, deletions: 0 }],
    });
  });

  it("readMessages：透传 afterMessageId/limit 并返回 messages", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const created = client.createSession(workspace);
    transport.receive({ id: 1, result: { session: { sessionId: "sess_3" } } });
    await created;

    const pending = client.readMessages({ afterMessageId: "msg_1", limit: 20 });
    expect(transport.lastFrame()).toEqual({
      id: 2,
      method: KERNEL_METHODS.sessionMessages,
      params: { sessionId: "sess_3", afterMessageId: "msg_1", limit: 20 },
    });
    transport.receive({
      id: 2,
      result: { messages: [{ info: { messageId: "msg_2", role: "assistant" }, parts: [] }] },
    });
    const messages = await pending;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.info.messageId).toBe("msg_2");
  });

  it("listSessions：按 workspace 列出并返回 sessions", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);

    const pending = client.listSessions({ workspace, limit: 10 });
    expect(transport.lastFrame()).toEqual({
      id: 1,
      method: KERNEL_METHODS.sessionList,
      params: { workspace, limit: 10 },
    });
    transport.receive({
      id: 1,
      result: {
        sessions: [
          { sessionId: "sess_1", title: "第一个", updatedAt: 2 },
          { sessionId: "sess_2", title: "", updatedAt: 1 },
        ],
      },
    });
    const sessions = await pending;
    expect(sessions.map((session) => session.sessionId)).toEqual(["sess_1", "sess_2"]);
  });

  it("resumeSession：发 session/resume 并切换 currentSessionId", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);

    const pending = client.resumeSession("sess_9");
    expect(transport.lastFrame()).toEqual({
      id: 1,
      method: KERNEL_METHODS.sessionResume,
      params: { sessionId: "sess_9" },
    });
    transport.receive({ id: 1, result: { session: { sessionId: "sess_9" } } });
    await pending;
    expect(client.currentSessionId).toBe("sess_9");
  });

  it("内核 error 帧映射成 KernelProtocolError", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.createSession(workspace);
    transport.receive({ id: 1, error: { code: -32601, message: "Method not found: session/create" } });
    await expect(pending).rejects.toBeInstanceOf(KernelProtocolError);
    await expect(pending).rejects.toMatchObject({ code: -32601 });
  });

  it("通知帧按 method/params 分发，取消订阅后不再收到", () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const received: KernelNotification[] = [];
    const off = client.onNotification((notification) => received.push(notification));

    transport.receive({ method: "v4/telemetry/event", params: { kind: "turn.started" } });
    expect(received).toEqual([
      { method: "v4/telemetry/event", params: { kind: "turn.started" } },
    ]);

    off();
    transport.receive({ method: "computer-use/operation-event", params: { kind: "turn-completed" } });
    expect(received).toHaveLength(1);
  });

  it("超时后 reject，且不会误结算后续同 id 帧", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeTransport();
      const client = createClient(transport, { requestTimeoutMs: 1000 });
      const pending = client.request("session/create", {});
      vi.advanceTimersByTime(1001);
      await expect(pending).rejects.toThrow("内核请求超时");
    } finally {
      vi.useRealTimers();
    }
  });

  it("close() 后未完成请求 reject，且不再转发通知", async () => {
    const transport = new FakeTransport();
    const client = createClient(transport);
    const pending = client.request("session/create", {});
    client.close();
    await expect(pending).rejects.toThrow("已关闭");
    await expect(client.request("session/create", {})).rejects.toThrow("已关闭");
  });
});
