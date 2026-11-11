import { describe, expect, it } from "vitest";

import type { ConversationDelta } from "@nibi-go/shared-extract";

import { ConversationStore } from "../src/state";
import { ReplaySession, type ReplayDegradeReason } from "../src/replay";
import { makeSnapshot, textRow } from "./fixtures";

function makeReplay() {
  const store = new ConversationStore();
  const reasons: ReplayDegradeReason[] = [];
  const replay = new ReplaySession(store, { onResyncNeeded: (r) => reasons.push(r) });
  return { store, replay, reasons };
}

describe("ReplaySession（snapshot/gap 恢复边界）", () => {
  it("未对齐水位时丢弃 delta（半截状态不落库）", () => {
    const { store, replay } = makeReplay();
    replay.begin();
    expect(replay.state).toBe("awaiting-snapshot");
    expect(replay.onDelta({ op: "row.appended", row: textRow(1, "x") } as ConversationDelta)).toBe(false);
    expect(store.snapshot).toBeNull();
  });

  it("快照到达 → streaming，delta 应用", () => {
    const { store, replay } = makeReplay();
    replay.begin();
    replay.onSnapshot(makeSnapshot());
    expect(replay.state).toBe("streaming");
    expect(replay.onDelta({ op: "row.appended", row: textRow(1, "x") } as ConversationDelta)).toBe(true);
    expect(store.snapshot!.rows.window).toHaveLength(1);
  });

  it("bridge 降级 → resyncing，回调 reason，期间 delta 丢弃；新快照恢复", () => {
    const { store, replay, reasons } = makeReplay();
    replay.begin();
    replay.onSnapshot(makeSnapshot());
    replay.onBridgeDegraded("rpc-frame-gap");
    expect(replay.state).toBe("resyncing");
    expect(reasons).toEqual(["rpc-frame-gap"]);
    expect(replay.onDelta({ op: "row.appended", row: textRow(2, "late") } as ConversationDelta)).toBe(false);
    expect(store.snapshot!.rows.window).toHaveLength(0);

    replay.onSnapshot(makeSnapshot({ seq: 10, revision: 2 }));
    expect(replay.state).toBe("streaming");
    expect(store.snapshot!.seq).toBe(10);
  });

  it("close 回 idle", () => {
    const { replay } = makeReplay();
    replay.begin();
    replay.close();
    expect(replay.state).toBe("idle");
  });
});
