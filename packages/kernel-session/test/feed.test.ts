import { describe, expect, it } from "vitest";
import {
  assistantTextRowSchema,
  type ConversationDelta,
  type ConversationSnapshot,
  type ConversationTopicFrame,
} from "@nibi-go/shared-extract";

import {
  ConversationFeed,
  applyConversationFrame,
  type ConversationFeedClient,
  type KernelNotification,
} from "../src/index";

const base = { turnId: "turn_1", createdAt: 1000, createdAtSeq: 1 };

function snapshot(text: string, state: "streaming" | "complete"): ConversationSnapshot {
  return {
    rows: {
      window: [
        {
          ...base,
          rowId: 7,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text,
          state,
        },
      ],
      totalCount: 1,
      firstRowId: 7,
    },
  } as unknown as ConversationSnapshot;
}

function frame(payload: ConversationTopicFrame["payload"]): ConversationTopicFrame {
  return {
    topic: "conversation/sess_1",
    subscriptionId: "sub_1",
    fromSeq: 0,
    toSeq: 1,
    sentAt: 1000,
    payload,
  } as unknown as ConversationTopicFrame;
}

describe("applyConversationFrame", () => {
  it("snapshot 帧整体替换", () => {
    const next = applyConversationFrame(null, frame({ kind: "snapshot", snapshot: snapshot("hi", "complete") }));
    expect(next?.rows.window[0]).toMatchObject({ text: "hi" });
  });

  it("row.delta 追加流式文本（dsh-Go 的 row.delta 同一条协议）", () => {
    const current = snapshot("he", "streaming");
    const delta: ConversationDelta = { op: "row.delta", rowId: 7, path: "text", append: "llo" };
    const next = applyConversationFrame(current, frame({ kind: "deltas", deltas: [delta] }));
    expect((next?.rows.window[0] as { text?: string }).text).toBe("hello");
  });

  it("没有快照时增量丢弃（返回 null）", () => {
    const delta: ConversationDelta = { op: "row.delta", rowId: 7, path: "text", append: "x" };
    expect(applyConversationFrame(null, frame({ kind: "deltas", deltas: [delta] }))).toBeNull();
  });
});

/** 一份能通过 wire schema 的最小快照（feed 会先做 zod 校验才 apply）。 */
function liveSnapshot(text = "hi", state: "streaming" | "complete" = "complete"): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "sess_1",
    logEpoch: "epoch-1",
    seq: 1,
    revision: 1,
    control: {
      phase: "draft",
      sessionEnded: false,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: true },
      resumeGoal: { allowed: true },
    },
    inputRouting: { mode: "startNow" },
    meta: { title: "", titleSource: "default" },
    config: {
      provider: "provider_1",
      model: "model_1",
      thought: "medium",
      thoughtLevels: [],
      followupMode: "queue",
      mode: "build",
    },
    modelTransition: null,
    usage: {
      contextWindow: null,
      cumulative: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    workspaceHookAdmission: null,
    rows: {
      window: [
        assistantTextRowSchema.parse({
          rowId: 7,
          turnId: "turn_1",
          createdAt: 1000,
          createdAtSeq: 1,
          kind: "assistantText",
          assistantResponseId: "resp_1",
          text,
          state,
        }),
      ],
      totalCount: 1,
      firstRowId: 7,
    },
  };
}

/** 假客户端：把 logical frame 包成 `v4/conversation/frame` 通知（与内核同一条装配）。 */
class FakeFeedClient implements ConversationFeedClient {
  private readonly listeners = new Set<(notification: KernelNotification) => void>();
  private ordinal = 0;

  async subscribeConversation(): Promise<{
    topic: string;
    connectionId: string;
    subscriptionId: string | null;
  }> {
    return { topic: "conversation/sess_1", connectionId: "conn_1", subscriptionId: "sub_1" };
  }

  async unsubscribeConversation(): Promise<void> {}

  async resyncConversation(): Promise<void> {
    this.resyncCalls.push(true);
  }

  /** 对账调用记录（丢帧自愈测试用）。 */
  readonly resyncCalls: boolean[] = [];

  onNotification(listener: (notification: KernelNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(payload: ConversationTopicFrame["payload"], subscriptionId = "sub_1"): void {
    const ordinal = (this.ordinal += 1);
    const topic = "conversation/sess_1";
    const notification: KernelNotification = {
      method: "v4/conversation/frame",
      params: {
        wireVersion: 3,
        kind: "complete",
        deliveryKind: "online",
        logicalFrameId: `lf-${ordinal}`,
        logicalFrameOrdinal: ordinal,
        topic,
        subscriptionId,
        frame: {
          topic,
          subscriptionId,
          fromSeq: payload.kind === "snapshot" ? 0 : ordinal - 1,
          toSeq: ordinal,
          sentAt: 1000 + ordinal,
          payload,
        },
      },
    };
    for (const listener of this.listeners) listener(notification);
  }
}

const slotPush = (status: string): ConversationDelta =>
  ({
    op: "pluginSlot.data",
    pluginId: "nibigo_focus",
    serverName: "nibigo_focus",
    slot: "focus-live",
    data: { status },
  }) as ConversationDelta;

describe("ConversationFeed pluginSlots", () => {
  it("pluginSlot.data 更新槽数据，同时行增量照常 apply", async () => {
    const client = new FakeFeedClient();
    const feed = new ConversationFeed(client);
    await feed.start("sess_1");

    client.emit({ kind: "snapshot", snapshot: liveSnapshot("he", "streaming") });
    client.emit({
      kind: "deltas",
      deltas: [
        slotPush("专注插件在线 · 5s"),
        { op: "row.delta", rowId: 7, path: "text", append: "llo" },
      ],
    });

    expect(feed.pluginSlots).toEqual({
      nibigo_focus: { "focus-live": { status: "专注插件在线 · 5s" } },
    });
    expect((feed.snapshot?.rows.window[0] as { text?: string }).text).toBe("hello");
    await feed.stop();
  });

  it("同一槽后到的推送覆盖先到的", async () => {
    const client = new FakeFeedClient();
    const feed = new ConversationFeed(client);
    await feed.start("sess_1");

    client.emit({ kind: "snapshot", snapshot: liveSnapshot() });
    client.emit({ kind: "deltas", deltas: [slotPush("专注插件在线 · 5s")] });
    client.emit({ kind: "deltas", deltas: [slotPush("专注插件在线 · 10s")] });

    expect(feed.pluginSlots.nibigo_focus?.["focus-live"]).toEqual({
      status: "专注插件在线 · 10s",
    });
    await feed.stop();
  });

  it("新快照清空槽数据（live-only，冷开不复活旧推送）", async () => {
    const client = new FakeFeedClient();
    const feed = new ConversationFeed(client);
    await feed.start("sess_1");

    client.emit({ kind: "snapshot", snapshot: liveSnapshot() });
    client.emit({ kind: "deltas", deltas: [slotPush("专注插件在线 · 5s")] });
    expect(feed.pluginSlots.nibigo_focus?.["focus-live"]).toBeDefined();

    client.emit({ kind: "snapshot", snapshot: liveSnapshot("reopened", "complete") });
    expect(feed.pluginSlots).toEqual({});
    await feed.stop();
  });

  it("忽略同 topic 上旧 subscriptionId 的残留帧，不污染快照", async () => {
    const client = new FakeFeedClient();
    const feed = new ConversationFeed(client);
    await feed.start("sess_1");

    client.emit({ kind: "snapshot", snapshot: liveSnapshot("ok", "complete") }, "sub_1");
    // 来自残留旧订阅的 streaming row.appended 必须被忽略
    client.emit(
      {
        kind: "deltas",
        deltas: [
          {
            op: "row.appended",
            row: assistantTextRowSchema.parse({
              ...base,
              rowId: 8,
              kind: "assistantText",
              assistantResponseId: "resp_stale",
              text: "stale",
              state: "streaming",
            }),
          },
        ],
      },
      "sub_old",
    );

    expect(feed.snapshot?.rows.window).toHaveLength(1);
    expect(feed.snapshot?.rows.window[0]).toMatchObject({ rowId: 7, state: "complete" });
    await feed.stop();
  });

  it("重复 rowId 的 row.appended 自动降级为覆盖，不产生双份 streaming 行", () => {
    const current = snapshot("a", "streaming");
    const duplicateAppend: ConversationDelta = {
      op: "row.appended",
      row: assistantTextRowSchema.parse({
        ...base,
        rowId: 7,
        kind: "assistantText",
        assistantResponseId: "resp_1",
        text: "ab",
        state: "streaming",
      }),
    };
    const afterDup = applyConversationFrame(current, frame({ kind: "deltas", deltas: [duplicateAppend] }));
    expect(afterDup?.rows.window).toHaveLength(1);
    const settled = applyConversationFrame(
      afterDup,
      frame({
        kind: "deltas",
        deltas: [
          {
            op: "row.upserted",
            row: assistantTextRowSchema.parse({
              ...base,
              rowId: 7,
              kind: "assistantText",
              assistantResponseId: "resp_1",
              text: "ab",
              state: "complete",
            }),
          },
        ],
      }),
    );
    expect(settled?.rows.window).toHaveLength(1);
    expect(settled?.rows.window[0]).toMatchObject({ rowId: 7, state: "complete" });
  });
});
