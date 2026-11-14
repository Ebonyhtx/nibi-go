// 会话行模型：从 V4 投影快照派生，形态对齐 dsh-Go 的 ChatRow
// （packages/dsh_client transcript + app/lib/ui/chat/chat_rows.dart）：
//   - 一轮模型回复 = 一个 assistant 行（正文 + 推理 + 流式标记），工具行跟在其后；
//   - 用户输入单独成行；工具按调用顺序成行（连续 ≥3 个的收组后续再做）；
//   - 行主键稳定：`r<rowId>` / `m<assistantResponseId>`，列表 diff 与流式续写都靠它。
import type {
  AssistantTextRow as ProtocolAssistantText,
  ConversationRow as ProtocolRow,
  ConversationSnapshot,
  ReasoningRow as ProtocolReasoning,
  ToolCallRow as ProtocolToolCall,
  UserInputRow as ProtocolUserInput,
} from "@nibi-go/shared-extract";

export type ChatRow =
  | {
      kind: "user";
      key: string;
      text: string;
      createdAt?: number;
    }
  | {
      kind: "assistant";
      key: string;
      text: string;
      reasoning: string;
      /** 还在收 `row.delta`；UI 画光标/停止操作。 */
      streaming: boolean;
      model?: string;
      createdAt?: number;
    }
  | {
      kind: "tool";
      key: string;
      name: string;
      status: string;
      /** 参数摘要（折叠态一行）。 */
      detail?: string;
      error?: string;
    };

interface AssistantGroup {
  key: string;
  responseId?: string;
  text: string[];
  reasoning: string[];
  tools: ProtocolRow[];
  streaming: boolean;
  model?: string;
  createdAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toolRow(row: ProtocolToolCall): ChatRow {
  const detail =
    typeof row.inputText === "string" && row.inputText.length > 0
      ? row.inputText.slice(0, 120)
      : undefined;
  return {
    kind: "tool",
    key: `t${row.toolCallId}`,
    name: row.toolName,
    status: row.status,
    ...(detail ? { detail } : {}),
    ...(row.error ? { error: row.error.message } : {}),
  };
}

/**
 * 把快照的行窗口派生为 UI 行。
 *
 * 同一 `assistantResponseId` 的正文/推理/工具收成一个 assistant 行 + 其后的工具行
 * （与 dsh-Go `_Draft.items()` 的顺序一致）；没有 responseId 的旧行按相邻合并。
 */
export function deriveRows(snapshot: ConversationSnapshot | null): ChatRow[] {
  if (!snapshot) return [];
  const rows = snapshot.rows.window as ProtocolRow[];
  const out: ChatRow[] = [];
  let group: AssistantGroup | null = null;

  const flush = () => {
    if (!group) return;
    const text = group.text.join("");
    const reasoning = group.reasoning.join("");
    if (text.length > 0 || reasoning.length > 0) {
      out.push({
        kind: "assistant",
        key: group.key,
        text,
        reasoning,
        streaming: group.streaming,
        ...(group.model ? { model: group.model } : {}),
        ...(group.createdAt === undefined ? {} : { createdAt: group.createdAt }),
      });
    }
    for (const tool of group.tools) {
      if (tool.kind === "toolCall") out.push(toolRow(tool as ProtocolToolCall));
    }
    group = null;
  };

  const groupFor = (responseId: string | undefined, row: ProtocolRow): AssistantGroup => {
    if (group && group.responseId === responseId) return group;
    flush();
    group = {
      key: responseId ? `m${responseId}` : `r${row.rowId}`,
      responseId,
      text: [],
      reasoning: [],
      tools: [],
      streaming: false,
      createdAt:
        typeof row.createdAt === "number" ? (row.createdAt as unknown as number) : undefined,
    };
    return group;
  };

  for (const row of rows) {
    switch (row.kind) {
      case "userInput": {
        flush();
        const user = row as ProtocolUserInput;
        out.push({
          kind: "user",
          key: `r${user.rowId}`,
          text: user.text,
          ...(typeof user.createdAt === "number"
            ? { createdAt: user.createdAt as unknown as number }
            : {}),
        });
        break;
      }
      case "assistantText": {
        const text = row as ProtocolAssistantText;
        const current = groupFor(text.assistantResponseId, text);
        current.text.push(text.text);
        current.streaming = text.state === "streaming";
        if (text.model) current.model = text.model;
        if (current.createdAt === undefined && typeof text.createdAt === "number") {
          current.createdAt = text.createdAt as unknown as number;
        }
        break;
      }
      case "reasoning": {
        const reasoning = row as ProtocolReasoning;
        const current = groupFor(reasoning.assistantResponseId, reasoning);
        current.reasoning.push(reasoning.text);
        if (reasoning.state === "streaming") current.streaming = true;
        break;
      }
      case "toolCall": {
        const tool = row as ProtocolToolCall;
        const current = groupFor(tool.assistantResponseId, tool);
        current.tools.push(tool);
        break;
      }
      default:
        // turnHeader / artifact / file_diff / 交互类行先跳过：UI 还没有对应卡片。
        break;
    }
  }
  flush();
  return out;
}

/** 兼容旧调用：`{info, parts}` 消息 → ChatRow（冒烟页/旧接口仍可能用）。 */
export interface LegacyKernelMessage {
  info: {
    messageId: string;
    role: string;
    time?: { created?: number; completed?: number };
    model?: { providerId?: string; modelId?: string };
    [key: string]: unknown;
  };
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

export function mapLegacyMessages(messages: readonly LegacyKernelMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const message of messages) {
    const text = message.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("");
    switch (message.info.role) {
      case "user":
        rows.push({ kind: "user", key: `r${message.info.messageId}`, text });
        break;
      case "assistant": {
        const model = message.info.model;
        rows.push({
          kind: "assistant",
          key: `m${message.info.messageId}`,
          text,
          reasoning: "",
          streaming: !message.info.time?.completed,
          ...(model?.modelId ? { model: model.modelId } : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  return rows;
}

export { isRecord };
