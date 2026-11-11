import { describe, expect, it } from "vitest";

import type { ConversationDelta } from "@nibi-go/shared-extract";

import { ConversationStore } from "../src/state";
import { makeSnapshot, textRow } from "./fixtures";

describe("ConversationStore（apply 语义 = 抽取件规范实现）", () => {
  it("无快照时 apply 返回 false；有快照后生效并通知订阅者", () => {
    const store = new ConversationStore();
    const delta = { op: "row.appended", row: textRow(1, "hello") } as ConversationDelta;
    expect(store.applyDelta(delta)).toBe(false);

    let notified = 0;
    store.subscribe(() => notified++);
    store.replaceSnapshot(makeSnapshot());
    expect(notified).toBe(1);

    expect(store.applyDelta(delta)).toBe(true);
    expect(notified).toBe(2);
    const rows = store.snapshot!.rows;
    expect(rows.window).toHaveLength(1);
    expect(rows.totalCount).toBe(1);
    expect(rows.firstRowId).toBe(1);
  });

  it("row.delta 追加流式文本；未加载 rowId 是 no-op", () => {
    const store = new ConversationStore();
    store.replaceSnapshot(makeSnapshot({ rows: { window: [textRow(1, "hel", "streaming")], totalCount: 1, firstRowId: 1 } as never }));

    store.applyDelta({ op: "row.delta", rowId: 1, path: "text", append: "lo" } as ConversationDelta);
    expect((store.snapshot!.rows.window[0] as { text: string }).text).toBe("hello");

    store.applyDelta({ op: "row.delta", rowId: 99, path: "text", append: "x" } as ConversationDelta);
    expect((store.snapshot!.rows.window[0] as { text: string }).text).toBe("hello");
  });

  it("row.upserted 未加载行 no-op；已加载行替换", () => {
    const store = new ConversationStore();
    store.replaceSnapshot(makeSnapshot({ rows: { window: [textRow(1, "v1")], totalCount: 1, firstRowId: 1 } as never }));

    store.applyDelta({ op: "row.upserted", row: textRow(99, "ghost") } as ConversationDelta);
    expect(store.snapshot!.rows.window).toHaveLength(1);

    store.applyDelta({ op: "row.upserted", row: textRow(1, "v2") } as ConversationDelta);
    expect((store.snapshot!.rows.window[0] as { text: string }).text).toBe("v2");
  });

  it("row.removed：从 fromRowId 起裁剪，全分支裁剪时清空锚点", () => {
    const store = new ConversationStore();
    store.replaceSnapshot(
      makeSnapshot({
        rows: { window: [textRow(1, "a"), textRow(2, "b"), textRow(3, "c")], totalCount: 3, firstRowId: 1 } as never,
      }),
    );
    store.applyDelta({ op: "row.removed", fromRowId: 2 } as ConversationDelta);
    expect(store.snapshot!.rows.window.map((r) => r.rowId)).toEqual([1]);
    expect(store.snapshot!.rows.totalCount).toBe(1);

    store.applyDelta({ op: "row.removed", fromRowId: 1 } as ConversationDelta);
    expect(store.snapshot!.rows.window).toHaveLength(0);
    expect(store.snapshot!.rows.totalCount).toBe(0);
    expect(store.snapshot!.rows.firstRowId).toBeNull();
  });

  it("state.updated 键级整体替换（不深合并）", () => {
    const store = new ConversationStore();
    store.replaceSnapshot(makeSnapshot({ meta: { title: "旧标题", titleSource: "default" } as never }));
    store.applyDelta({
      op: "state.updated",
      patch: { meta: { title: "新标题", titleSource: "user" } },
    } as unknown as ConversationDelta);
    expect((store.snapshot as { meta: { title: string } }).meta.title).toBe("新标题");
  });
});
