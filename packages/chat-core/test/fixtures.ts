import {
  assistantTextRowSchema,
  toolCallRowSchema,
  type ConversationRow,
  type ConversationSnapshot,
} from "@nibi-go/shared-extract";

/** 最小合法 assistantText 行（经 schema 校验，保证与 wire 形状一致）。 */
export function textRow(
  rowId: number,
  text: string,
  state: "streaming" | "complete" = "complete",
): ConversationRow {
  return assistantTextRowSchema.parse({
    rowId,
    turnId: "turn-1",
    createdAt: 1_700_000_000_000,
    createdAtSeq: rowId,
    kind: "assistantText",
    text,
    state,
  });
}

export function toolRow(rowId: number, toolName = "Bash"): ConversationRow {
  return toolCallRowSchema.parse({
    rowId,
    turnId: "turn-1",
    createdAt: 1_700_000_000_000,
    createdAtSeq: rowId,
    kind: "toolCall",
    toolCallId: `tool-${rowId}`,
    toolName,
    status: "running",
    inputText: "",
  });
}

/**
 * 仅构造 apply 语义触及的字段（rows 窗口）。
 * 完整快照的生产构造发生在 wire 层 schema 校验（A2 后续切片），此处不复制 schema 校验。
 */
export function makeSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "session-1",
    logEpoch: "epoch-1",
    seq: 1,
    revision: 1,
    rows: { window: [], totalCount: 0, firstRowId: null },
    ...overrides,
  } as unknown as ConversationSnapshot;
}
