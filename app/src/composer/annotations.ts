// 注释功能纯逻辑：原文智能切段（中英文标点）、连续多段选区、原文无失真高亮分段、
// 协议长度/条数校验、连续编号序列化（annotations + transforms）与排序辅助。
// 保持纯函数无 RN 依赖，方便单测直接覆盖所有边界条件。

import {
  CONVERSATION_SELECTION_MAX_COUNT,
  CONVERSATION_SELECTION_MAX_TEXT_LENGTH,
  CONVERSATION_SELECTION_MAX_TOTAL_LENGTH,
} from "@nibi-go/shared-extract";
import type { KernelConversationQuote } from "@nibi-go/kernel-session";

export const ANNOTATION_MAX_COUNT = CONVERSATION_SELECTION_MAX_COUNT;
export const ANNOTATION_MAX_EXCERPT_LENGTH = CONVERSATION_SELECTION_MAX_TEXT_LENGTH;
export const ANNOTATION_MAX_TOTAL_LENGTH = CONVERSATION_SELECTION_MAX_TOTAL_LENGTH;
export const ANNOTATION_MAX_COMMENT_LENGTH = 4_000;

export interface AnnotationSegment {
  text: string;
  start: number;
  end: number;
}

export interface AnnotationSelection {
  start: number;
  end: number;
}

export interface AnnotationItem {
  id: string;
  /** 被注释行在本机行模型里的 key（`r12` / `m...`）。 */
  messageKey: string;
  /** 内核消息 id（能拿到时带上，历史回显用）。 */
  messageId?: string;
  /** 原消息时间戳（ISO 8601，拿不到时省略，不拿注释创建时间冒充）。 */
  messageSentAt?: string;
  messageRole: "user" | "assistant";
  /** 选中的原文片段（不是整条消息）。 */
  messageText: string;
  /** 添加时消息的完整正文，二次编辑选区用；历史恢复时可等于片段。 */
  fullText: string;
  /** 原文中的精确起止偏移（避免同句重复时二次编辑错位）。 */
  selectionStart?: number;
  selectionEnd?: number;
  comment: string;
  /** 插件 message.actions 的指令（例如“润色”）；内置注释为空。 */
  instruction?: string;
  createdAt: number;
}

export interface TransformTokenLike {
  kind: string;
  value: string;
  messageText?: string;
  messageRole?: "user" | "assistant";
}

/**
 * 可点选的原文片段：按行切；单行超过 80 字符时同时支持中英文句末切分
 * （避开小数点如 3.14、版本号如 v1.2.1 与 URL）。保留原文偏移。
 */
export function splitAnnotationSegments(fullText: string): AnnotationSegment[] {
  const segments: AnnotationSegment[] = [];
  let offset = 0;
  for (const line of fullText.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const trimmedStart = lineStart + line.indexOf(trimmed);
    if ([...trimmed].length <= 60) {
      segments.push({ text: trimmed, start: trimmedStart, end: trimmedStart + trimmed.length });
      continue;
    }
    // 中日韩句末标点直接切；英文句末（. ! ? ;）要求后跟空白且前面不是数字，避免误拆 3.14 / v1.2 / URL。
    const parts = trimmed.split(/(?<=[。！？；])\s*|(?<=[^\d.][.!?;])\s+/u);
    let cursor = 0;
    for (const part of parts) {
      const value = part.trim();
      if (value) {
        const at = trimmed.indexOf(value, cursor);
        const start = trimmedStart + (at >= 0 ? at : cursor);
        segments.push({ text: value, start, end: start + value.length });
        cursor = (at >= 0 ? at : cursor) + value.length;
      } else {
        cursor += part.length;
      }
    }
  }
  return segments;
}

/** 根据起止段号从原文精确切出连续区间，保留原始换行与空格。 */
export function rangeExcerptFromSegments(
  fullText: string,
  segments: readonly AnnotationSegment[],
  indexA: number,
  indexB: number,
): { excerpt: string; start: number; end: number } | null {
  if (segments.length === 0) return null;
  const lo = Math.max(0, Math.min(segments.length - 1, Math.min(indexA, indexB)));
  const hi = Math.max(0, Math.min(segments.length - 1, Math.max(indexA, indexB)));
  const start = segments[lo]!.start;
  const end = segments[hi]!.end;
  return {
    excerpt: fullText.slice(start, end),
    start,
    end,
  };
}

/** 恢复编辑态选区：优先使用持久化起止偏移，再回落精确匹配。 */
export function findExcerptSelection(
  fullText: string,
  initialExcerpt?: string,
  preferredStart?: number,
  preferredEnd?: number,
): AnnotationSelection {
  if (
    typeof preferredStart === "number" &&
    typeof preferredEnd === "number" &&
    preferredStart >= 0 &&
    preferredEnd > preferredStart &&
    preferredEnd <= fullText.length
  ) {
    const sliced = fullText.slice(preferredStart, preferredEnd);
    if (!initialExcerpt || sliced === initialExcerpt) {
      return { start: preferredStart, end: preferredEnd };
    }
  }
  const target = initialExcerpt?.trim();
  if (target && target !== fullText) {
    const at = fullText.indexOf(target);
    if (at >= 0) return { start: at, end: at + target.length };
  }
  return { start: 0, end: fullText.length };
}

/** 将原文按选中区间拆成三段，直接渲染原文而不注入人为换行。 */
export function buildPreviewRuns(
  fullText: string,
  selection: AnnotationSelection,
): { before: string; highlighted: string; after: string } {
  const start = Math.max(0, Math.min(fullText.length, selection.start));
  const end = Math.max(start, Math.min(fullText.length, selection.end));
  return {
    before: fullText.slice(0, start),
    highlighted: fullText.slice(start, end),
    after: fullText.slice(end),
  };
}

export type AnnotationValidationErrorCode =
  | "empty"
  | "max_count"
  | "excerpt_too_long"
  | "total_too_long"
  | "comment_too_long";

export type AnnotationValidationResult =
  | { ok: true; excerpt: string; comment: string }
  | { ok: false; code: AnnotationValidationErrorCode; limit: number; current: number };

/** 保存前校验：严格对齐 shared-extract 的 conversationQuotesSchema 上限。 */
export function validateAnnotationDraft(params: {
  existing: readonly AnnotationItem[];
  editingId?: string;
  excerpt: string;
  comment: string;
  transformCount?: number;
  transformChars?: number;
}): AnnotationValidationResult {
  const excerpt = params.excerpt.trim();
  const comment = params.comment.trim();
  if (!excerpt) {
    return { ok: false, code: "empty", limit: 1, current: 0 };
  }
  const others = params.editingId
    ? params.existing.filter((item) => item.id !== params.editingId)
    : params.existing;
  const nextCount = others.length + 1 + (params.transformCount ?? 0);
  if (nextCount > ANNOTATION_MAX_COUNT) {
    return {
      ok: false,
      code: "max_count",
      limit: ANNOTATION_MAX_COUNT,
      current: nextCount,
    };
  }
  if (excerpt.length > ANNOTATION_MAX_EXCERPT_LENGTH) {
    return {
      ok: false,
      code: "excerpt_too_long",
      limit: ANNOTATION_MAX_EXCERPT_LENGTH,
      current: excerpt.length,
    };
  }
  if (comment.length > ANNOTATION_MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      code: "comment_too_long",
      limit: ANNOTATION_MAX_COMMENT_LENGTH,
      current: comment.length,
    };
  }
  const existingChars = others.reduce((sum, item) => sum + item.messageText.length, 0);
  const nextTotal = existingChars + excerpt.length + (params.transformChars ?? 0);
  if (nextTotal > ANNOTATION_MAX_TOTAL_LENGTH) {
    return {
      ok: false,
      code: "total_too_long",
      limit: ANNOTATION_MAX_TOTAL_LENGTH,
      current: nextTotal,
    };
  }
  return { ok: true, excerpt, comment };
}

/** 构造发送给内核的 conversationQuotes：annotations 与 transforms 连续编号，绝不重复 1 号。 */
export function buildConversationQuotes(
  annotations: readonly AnnotationItem[],
  tokens: readonly TransformTokenLike[],
  senderLabels: { user: string; assistant: string } = { user: "我", assistant: "NIBI" },
): KernelConversationQuote[] {
  const annotationQuotes: KernelConversationQuote[] = annotations.map((annotation, index) => ({
    text: annotation.messageText,
    kind: "annotation",
    number: index + 1,
    messageKey: annotation.messageKey,
    messageRole: annotation.messageRole,
    senderName:
      annotation.messageRole === "assistant" ? senderLabels.assistant : senderLabels.user,
    ...(annotation.messageSentAt ? { sentAt: annotation.messageSentAt } : {}),
    ...(annotation.messageId ? { messageId: annotation.messageId } : {}),
    ...(annotation.comment.trim() ? { comment: annotation.comment.trim() } : {}),
    ...(annotation.instruction ? { instruction: annotation.instruction } : {}),
  }));

  const base = annotationQuotes.length;
  const transformQuotes: KernelConversationQuote[] = tokens
    .filter((token) => token.kind === "message" && Boolean(token.messageText))
    .map((token, index) => ({
      text: token.messageText ?? "",
      kind: "transform",
      number: base + index + 1,
      messageKey: token.value,
      messageRole: token.messageRole ?? "assistant",
      senderName: token.messageRole === "user" ? senderLabels.user : senderLabels.assistant,
    }));

  return [...annotationQuotes, ...transformQuotes];
}

/** 统计每条消息的待发送注释条数（传给 ConversationList 避免 memo 读旧 ref）。 */
export function buildDraftAnnotationCounts(
  annotations: readonly AnnotationItem[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const item of annotations) {
    counts[item.messageKey] = (counts[item.messageKey] ?? 0) + 1;
  }
  return counts;
}

/** 上移/下移注释顺序。 */
export function reorderAnnotations(
  list: readonly AnnotationItem[],
  index: number,
  delta: -1 | 1,
): AnnotationItem[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}
