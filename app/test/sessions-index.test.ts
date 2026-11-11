import { describe, expect, it } from "vitest";

import type { SessionSummary, SessionsIndexTopicFrame } from "@nibi-go/shared-extract";

import { applySessionsFrame } from "../src/relay/sessions-index";

function summary(sessionId: string, title: string): SessionSummary {
  return {
    sessionId,
    workspaceId: "ws-1",
    title,
    phase: "running",
    sessionEnded: false,
    hasBackgroundWork: false,
    lastActivityAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
  } as SessionSummary;
}

function frame(payload: SessionsIndexTopicFrame["payload"]): SessionsIndexTopicFrame {
  return {
    topic: "sessions-index/ws-1",
    subscriptionId: "sidx-1",
    fromSeq: 0,
    toSeq: 1,
    sentAt: 1_700_000_000_000,
    payload,
  } as SessionsIndexTopicFrame;
}

describe("applySessionsFrame（sessions-index 列表状态）", () => {
  it("快照整体替换", () => {
    const next = applySessionsFrame([summary("old", "旧")], frame({
      kind: "snapshot",
      snapshot: {
        protocolVersion: 1,
        workspaceId: "ws-1",
        logEpoch: "e1",
        sessions: [summary("s1", "会话一"), summary("s2", "会话二")],
      },
    } as never));
    expect(next.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("增量 upsert（新增/更新）与 remove", () => {
    let list = [summary("s1", "旧标题")];
    list = applySessionsFrame(
      list,
      frame({ kind: "deltas", deltas: [{ op: "session.upserted", session: summary("s1", "新标题") }] } as never),
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("新标题");

    list = applySessionsFrame(
      list,
      frame({ kind: "deltas", deltas: [{ op: "session.upserted", session: summary("s2", "新增") }] } as never),
    );
    expect(list.map((s) => s.sessionId)).toEqual(["s1", "s2"]);

    list = applySessionsFrame(
      list,
      frame({ kind: "deltas", deltas: [{ op: "session.removed", sessionId: "s1" }] } as never),
    );
    expect(list.map((s) => s.sessionId)).toEqual(["s2"]);
  });
});
