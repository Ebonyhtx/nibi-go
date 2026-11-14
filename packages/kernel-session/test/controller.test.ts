import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConversationController,
  type KernelMessage,
  type KernelNotification,
  type KernelSessionSource,
} from "../src/index";

class FakeSource implements KernelSessionSource {
  readonly calls: Array<{ afterMessageId?: string; limit?: number } | undefined> = [];
  private readonly listeners = new Set<(notification: KernelNotification) => void>();
  messages: KernelMessage[] = [];

  get currentSessionId(): string {
    return "sess_test";
  }

  async readMessages(options?: { afterMessageId?: string; limit?: number }): Promise<KernelMessage[]> {
    this.calls.push(options);
    return this.messages;
  }

  onNotification(listener: (notification: KernelNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(notification: KernelNotification): void {
    for (const listener of this.listeners) listener(notification);
  }
}

function userMessage(text: string): KernelMessage {
  return {
    info: { messageId: `msg_${text}`, role: "user", time: { created: 1 } },
    parts: [{ type: "text", text }],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ConversationController", () => {
  it("refresh 读消息并映射成行，通知订阅者", async () => {
    const source = new FakeSource();
    source.messages = [userMessage("你好")];
    const controller = new ConversationController(source);
    const listener = vi.fn();
    controller.subscribe(listener);

    await controller.refresh();

    expect(controller.rows).toEqual([{ kind: "user", id: "msg_你好", text: "你好", createdAt: 1 }]);
    expect(source.calls).toEqual([{ limit: 200 }]);
    expect(listener).toHaveBeenCalled();
    controller.dispose();
  });

  it("turn.started / turn.terminal 驱动 turn 状态", () => {
    const source = new FakeSource();
    const controller = new ConversationController(source);

    source.notify({ method: "v4/telemetry/event", params: { kind: "turn.started" } });
    expect(controller.turn).toBe("running");

    source.notify({ method: "v4/telemetry/event", params: { kind: "turn.terminal" } });
    expect(controller.turn).toBe("idle");
    controller.dispose();
  });

  it("stream.chunk 合并成一次刷新（debounce）", async () => {
    vi.useFakeTimers();
    const source = new FakeSource();
    const controller = new ConversationController(source, { refreshDebounceMs: 50 });

    for (let i = 0; i < 5; i++) {
      source.notify({ method: "v4/telemetry/event", params: { kind: "stream.chunk" } });
    }
    await vi.advanceTimersByTimeAsync(60);

    expect(source.calls).toHaveLength(1);
    controller.dispose();
  });

  it("无关通知不触发刷新", async () => {
    vi.useFakeTimers();
    const source = new FakeSource();
    const controller = new ConversationController(source, { refreshDebounceMs: 10 });

    source.notify({ method: "process/resourceSample", params: {} });
    await vi.advanceTimersByTimeAsync(20);

    expect(source.calls).toHaveLength(0);
    controller.dispose();
  });

  it("dispose 后不再刷新、不再转发通知", async () => {
    vi.useFakeTimers();
    const source = new FakeSource();
    const controller = new ConversationController(source, { refreshDebounceMs: 10 });
    controller.dispose();

    source.notify({ method: "v4/telemetry/event", params: { kind: "turn.started" } });
    await vi.advanceTimersByTimeAsync(20);

    expect(source.calls).toHaveLength(0);
    expect(controller.turn).toBe("idle");
  });
});
