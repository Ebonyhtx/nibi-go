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
