import { describe, expect, it } from "vitest";

import {
  ANNOTATION_MAX_COMMENT_LENGTH,
  ANNOTATION_MAX_COUNT,
  ANNOTATION_MAX_EXCERPT_LENGTH,
  ANNOTATION_MAX_TOTAL_LENGTH,
  buildConversationQuotes,
  buildDraftAnnotationCounts,
  buildPreviewRuns,
  findExcerptSelection,
  rangeExcerptFromSegments,
  reorderAnnotations,
  splitAnnotationSegments,
  validateAnnotationDraft,
  type AnnotationItem,
} from "../src/composer/annotations";

function makeItem(id: string, messageKey: string, text = "hello"): AnnotationItem {
  return {
    id,
    messageKey,
    messageRole: "assistant",
    messageText: text,
    fullText: text,
    comment: "",
    createdAt: 1_700_000_000_000,
  };
}

describe("annotations module", () => {
  it("splits both CJK and English long lines without breaking decimals or versions", () => {
    const english =
      "Release v1.2.1 improved latency by 3.14ms across Android devices. It also keeps the native bionic runtime lightweight! Does it break backward compatibility? No, existing plugins stay intact.";
    const segs = splitAnnotationSegments(english);
    expect(segs.length).toBe(4);
    expect(segs[0]?.text).toContain("v1.2.1");
    expect(segs[0]?.text).toContain("3.14ms");
    expect(english.slice(segs[1]!.start, segs[1]!.end)).toBe(segs[1]!.text);

    const cjk =
      "第一句非常长，用来确保整行超过八十个字符阈值从而触发句末标点切分，同时保留中文逗号与分号后的精确字符偏移量。第二句紧接在后面；第三句带感叹号！第四句带问号？";
    const cjkSegs = splitAnnotationSegments(cjk);
    expect(cjkSegs.length).toBe(4);
    for (const seg of cjkSegs) {
      expect(cjk.slice(seg.start, seg.end)).toBe(seg.text);
    }
  });

  it("extracts contiguous multi-segment ranges preserving original whitespace", () => {
    const full = "Line one\n\nLine two\nLine three";
    const segs = splitAnnotationSegments(full);
    expect(segs).toHaveLength(3);
    const range = rangeExcerptFromSegments(full, segs, 0, 1);
    expect(range).toEqual({
      excerpt: "Line one\n\nLine two",
      start: 0,
      end: 18,
    });
    const reversed = rangeExcerptFromSegments(full, segs, 2, 1);
    expect(reversed?.excerpt).toBe("Line two\nLine three");
  });

  it("restores duplicate sentence occurrences using preferred offsets", () => {
    const full = "repeat me\nmiddle\nrepeat me";
    const secondStart = full.lastIndexOf("repeat me");
    const sel = findExcerptSelection(full, "repeat me", secondStart, secondStart + 9);
    expect(sel).toEqual({ start: secondStart, end: secondStart + 9 });

    const runs = buildPreviewRuns(full, sel);
    expect(runs).toEqual({
      before: "repeat me\nmiddle\n",
      highlighted: "repeat me",
      after: "",
    });
  });

  it("enforces schema count, excerpt length, total length, and comment length limits", () => {
    expect(validateAnnotationDraft({ existing: [], excerpt: "   ", comment: "" })).toMatchObject({
      ok: false,
      code: "empty",
    });

    const eight = Array.from({ length: ANNOTATION_MAX_COUNT }, (_, i) =>
      makeItem(`a${i}`, `r${i}`),
    );
    expect(
      validateAnnotationDraft({ existing: eight, excerpt: "extra", comment: "" }),
    ).toMatchObject({ ok: false, code: "max_count", limit: ANNOTATION_MAX_COUNT });

    // Editing an existing item when already at max count is allowed
    expect(
      validateAnnotationDraft({
        existing: eight,
        editingId: "a0",
        excerpt: "updated",
        comment: "ok",
      }),
    ).toEqual({ ok: true, excerpt: "updated", comment: "ok" });

    expect(
      validateAnnotationDraft({
        existing: [],
        excerpt: "x".repeat(ANNOTATION_MAX_EXCERPT_LENGTH + 1),
        comment: "",
      }),
    ).toMatchObject({ ok: false, code: "excerpt_too_long" });

    expect(
      validateAnnotationDraft({
        existing: [],
        excerpt: "ok",
        comment: "c".repeat(ANNOTATION_MAX_COMMENT_LENGTH + 1),
      }),
    ).toMatchObject({ ok: false, code: "comment_too_long" });

    const bigTwo = [
      makeItem("a1", "r1", "a".repeat(8000)),
      makeItem("a2", "r2", "b".repeat(8000)),
    ];
    expect(
      validateAnnotationDraft({
        existing: bigTwo,
        excerpt: "overflow",
        comment: "",
      }),
    ).toMatchObject({ ok: false, code: "total_too_long", limit: ANNOTATION_MAX_TOTAL_LENGTH });
  });

  it("numbers annotation and transform quotes continuously and preserves messageId & messageSentAt", () => {
    const a1: AnnotationItem = {
      ...makeItem("a1", "r10", "first"),
      messageId: "msg-10",
      messageSentAt: "2026-11-23T01:00:00.000Z",
      comment: "clarify this",
      instruction: "精简",
    };
    const quotes = buildConversationQuotes(
      [a1],
      [{ kind: "message", value: "r11", messageText: "second", messageRole: "user" }],
      { user: "Me", assistant: "NIBI" },
    );
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({
      kind: "annotation",
      number: 1,
      messageId: "msg-10",
      sentAt: "2026-11-23T01:00:00.000Z",
      comment: "clarify this",
      instruction: "精简",
      senderName: "NIBI",
    });
    expect(quotes[1]).toMatchObject({
      kind: "transform",
      number: 2,
      messageKey: "r11",
      senderName: "Me",
    });
  });

  it("computes draft counts per message and reorders cleanly", () => {
    const items = [makeItem("a", "r1"), makeItem("b", "r2"), makeItem("c", "r1")];
    expect(buildDraftAnnotationCounts(items)).toEqual({ r1: 2, r2: 1 });
    expect(reorderAnnotations(items, 1, -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(reorderAnnotations(items, 0, -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
