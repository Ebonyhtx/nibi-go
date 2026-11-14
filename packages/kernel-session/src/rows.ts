// 会话行模型：从 V4 投影快照派生，形态对齐 dsh-Go 的 ChatRow
// （packages/dsh_client transcript + app/lib/ui/chat/chat_rows.dart）：
//   - 一轮模型回复 = 一个 assistant 行（正文 + 推理 + 流式标记），工具行跟在其后；
//     连续 ≥3 次工具调用收成一组（dsh-Go 的 ToolGroupRow）；
//   - 用户输入单独成行；本机刚发出、内核还没回显的提示是 pending 行（乐观气泡）；
//   - 一轮结束（turnHeader 有 endedAt/state）在末尾挂一行脚注（用时/工具数/token/文件）。
//   - 行主键稳定：`r<rowId>` / `m<assistantResponseId>`，列表 diff 与流式续写都靠它。
import type {
  AssistantTextRow as ProtocolAssistantText,
  ConversationRow as ProtocolRow,
  ConversationSnapshot,
  InteractionAutoResolution,
  PendingInteraction,
  ReasoningRow as ProtocolReasoning,
  ToolCallRow as ProtocolToolCall,
  TurnHeaderRow as ProtocolTurnHeader,
  UserInputRow as ProtocolUserInput,
} from "@nibi-go/shared-extract";

/** dsh-Go `toolGroupThreshold`：连续 ≥3 次调用折成一组。 */
export const TOOL_GROUP_THRESHOLD = 3;

export interface ChatToolRow {
  kind: "tool";
  key: string;
  name: string;
  status: string;
  /** 参数摘要（折叠态一行）。 */
  detail?: string;
  /** 工具输出正文（成功/失败都有；dsh-Go 的工具行同样带结果）。 */
  output?: string;
  error?: string;
}

export interface PendingPrompt {
  /** 本机生成的稳定 id（`p<seq>`）。 */
  id: string;
  text: string;
}

/** 权限请求的可选项（内核 `permissionRequestPayload.options`）。 */
export interface ChatPermissionOption {
  optionId: string;
  label: string;
  kind: "allowOnce" | "allowAlways" | "deny" | "custom";
}

/** AskUserQuestion 的一题（内核 `userInputQuestionPayloadSchema`）。 */
export interface ChatInteractionQuestion {
  question: string;
  header: string;
  options: Array<{ value: string; label: string; description?: string }>;
  multiSelect: boolean;
}

/** AUQ 的协议层自动处理状态；卡片只提示，不自己计时。 */
export type ChatAutoResolution = InteractionAutoResolution;

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
  | ChatToolRow
  | {
      kind: "toolGroup";
      key: string;
      tools: ChatToolRow[];
      running: boolean;
    }
  | {
      /** 本机刚发出、内核还没回显。 */
      kind: "pending";
      key: string;
      text: string;
    }
  | {
      /** 轮末脚注：用时 / 工具数 / token / 文件改动。 */
      kind: "turn";
      key: string;
      state: string;
      durationMs?: number;
      toolCalls: number;
      tokens?: number;
      files?: { additions: number; deletions: number; files: number; reverted?: boolean };
    }
  | {
      /** 权限审批（dsh-Go ApprovalRow）：放在会话末尾，等用户放行/拒绝。 */
      kind: "approval";
      key: string;
      interactionId: string;
      toolName: string;
      summary: string;
      /** 命令/路径等一眼能看懂的目标（来自 payload.detail）。 */
      detail?: string;
      options: ChatPermissionOption[];
      fullAccess?: ChatPermissionOption;
      freeText: boolean;
      autoResolution?: ChatAutoResolution;
    }
  | {
      /** 提问（dsh-Go QuestionRow）：AskUserQuestion / 计划审批。 */
      kind: "question";
      key: string;
      interactionId: string;
      prompt: string;
      freeText: boolean;
      sensitive: boolean;
      options?: Array<{ optionId: string; label: string }>;
      questions?: ChatInteractionQuestion[];
      autoResolution?: ChatAutoResolution;
    }
  | {
      /** GO 还不能处理的交互（如 workspaceHookReview）：不静默丢弃。 */
      kind: "notice";
      key: string;
      text: string;
      tone: "info" | "warning";
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

function toolRow(row: ProtocolToolCall): ChatToolRow {
  const detail =
    typeof row.inputText === "string" && row.inputText.length > 0
      ? row.inputText.slice(0, 120)
      : undefined;
  const output =
    typeof row.output?.text === "string" && row.output.text.trim().length > 0
      ? row.output.text.trim().slice(0, 600)
      : undefined;
  return {
    kind: "tool",
    key: `t${row.toolCallId}`,
    name: row.toolName,
    status: row.status,
    ...(detail ? { detail } : {}),
    ...(output ? { output } : {}),
    ...(row.error ? { error: row.error.message } : {}),
  };
}

/** 把一组工具行按 dsh-Go 规则收组：连续 ≥3 个折成一行，不足的逐条展示。 */
function pushTools(out: ChatRow[], tools: ChatToolRow[]): void {
  if (tools.length === 0) return;
  if (tools.length >= TOOL_GROUP_THRESHOLD) {
    out.push({
      kind: "toolGroup",
      key: `g${tools[0]!.key}`,
      tools,
      running: tools.some((tool) =>
        ["running", "inputStreaming", "pendingApproval"].includes(tool.status),
      ),
    });
    return;
  }
  out.push(...tools);
}

function turnFootnote(turn: ProtocolTurnHeader): ChatRow | null {
  if (turn.state === "running" || turn.endedAt === undefined) return null;
  const startedAt = typeof turn.startedAt === "number" ? turn.startedAt : undefined;
  const endedAt = typeof turn.endedAt === "number" ? turn.endedAt : undefined;
  const durationMs =
    typeof turn.activeMs === "number"
      ? turn.activeMs
      : startedAt !== undefined && endedAt !== undefined
        ? endedAt - startedAt
        : undefined;
  return {
    kind: "turn",
    key: `turn${turn.rowId}`,
    state: turn.state,
    ...(durationMs === undefined ? {} : { durationMs }),
    toolCalls: 0,
    ...(typeof turn.outputTokens === "number" ? { tokens: turn.outputTokens } : {}),
    ...(turn.fileChanges
      ? {
          files: {
            additions: turn.fileChanges.additions,
            deletions: turn.fileChanges.deletions,
            files: turn.fileChanges.files,
            ...(turn.fileChanges.state === "reverted" ? { reverted: true } : {}),
          },
        }
      : {}),
  };
}

/** 权限请求里的工具输入：优先取命令/路径这类一眼能看懂的值。 */
function interactionDetail(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail.trim().slice(0, 240) || undefined;
  if (!detail || typeof detail !== "object") return undefined;
  const record = detail as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "url", "pattern", "query"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim().slice(0, 240);
  }
  return undefined;
}

function permissionOption(option: {
  optionId: string;
  label: string;
  kind: "allowOnce" | "allowAlways" | "deny" | "custom";
}): ChatPermissionOption {
  return { optionId: option.optionId, label: option.label, kind: option.kind };
}

/**
 * 一个待处理交互 → 一张卡片行（dsh-Go 把没有挂到工具行上的审批/提问追加在末尾）。
 * 内核在回答后把它从 `pendingInteractions` 移除，卡片随下一帧消失。
 */
function interactionRow(interaction: PendingInteraction): ChatRow {
  const payload = interaction.payload;
  const base = {
    key: `ap${interaction.interactionId}`,
    interactionId: interaction.interactionId,
    ...(interaction.autoResolution ? { autoResolution: interaction.autoResolution } : {}),
  };
  if (payload.kind === "permission") {
    const detail = interactionDetail(payload.detail);
    return {
      ...base,
      kind: "approval",
      toolName: payload.toolName,
      summary: payload.summary,
      ...(detail ? { detail } : {}),
      options: payload.options.map(permissionOption),
      ...(payload.fullAccessOption
        ? { fullAccess: permissionOption(payload.fullAccessOption) }
        : {}),
      freeText: payload.freeText === true,
    };
  }
  if (payload.kind === "userInput") {
    return {
      ...base,
      key: `q${interaction.interactionId}`,
      kind: "question",
      prompt: payload.prompt,
      freeText: payload.freeText,
      sensitive: payload.sensitive === true,
      ...(payload.options
        ? { options: payload.options.map(({ optionId, label }) => ({ optionId, label })) }
        : {}),
      ...(payload.questions
        ? {
            questions: payload.questions.map((question) => ({
              question: question.question,
              header: question.header,
              options: question.options.map((option) => ({
                value: option.value,
                label: option.label,
                ...(option.description ? { description: option.description } : {}),
              })),
              multiSelect: question.multiSelect === true,
            })),
          }
        : {}),
    };
  }
  return {
    ...base,
    key: `n${interaction.interactionId}`,
    kind: "notice",
    text: "有工作区 Hook 待审核；GO 暂不支持在这里处理，请到桌面端完成。",
    tone: "warning",
  };
}

/**
 * 把快照的行窗口派生为 UI 行。
 *
 * 同一 `assistantResponseId` 的正文/推理/工具收成一个 assistant 行 + 其后的工具行
 * （与 dsh-Go `_Draft.items()` 的顺序一致）；没有 responseId 的旧行按相邻合并。
 */
export function deriveRows(
  snapshot: ConversationSnapshot | null,
  pending: readonly PendingPrompt[] = [],
): ChatRow[] {
  const out: ChatRow[] = [];
  if (snapshot) {
    const rows = snapshot.rows.window as ProtocolRow[];
    let group: AssistantGroup | null = null;
    let currentTurn: ProtocolTurnHeader | null = null;
    let turnToolCount = 0;

    const closeTurn = () => {
      if (!currentTurn) return;
      const footnote = turnFootnote(currentTurn);
      if (footnote) {
        out.push({ ...footnote, toolCalls: turnToolCount } as ChatRow);
      }
      currentTurn = null;
      turnToolCount = 0;
    };

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
      const tools = group.tools.filter((tool) => tool.kind === "toolCall") as ProtocolToolCall[];
      turnToolCount += tools.length;
      pushTools(out, tools.map(toolRow));
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

    // 快照窗口的边缘可能与上一帧重叠（同一 rowId 出现两次）；行身份就是 rowId，
    // 重复项只派生一次，否则列表会撞 key（真机上表现为 React 的 duplicate key 红条）。
    const seenRowIds = new Set<number>();
    for (const row of rows) {
      if (seenRowIds.has(row.rowId)) continue;
      seenRowIds.add(row.rowId);
      switch (row.kind) {
        case "turnHeader": {
          flush();
          closeTurn();
          currentTurn = row as ProtocolTurnHeader;
          break;
        }
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
          // artifact / file_diff / 交互类行先跳过：UI 还没有对应卡片。
          break;
      }
    }
    flush();
    closeTurn();
    // dsh-Go：没挂到工具行上的审批/提问追加在消息之后、乐观气泡之前。
    for (const interaction of snapshot.pendingInteractions ?? []) {
      out.push(interactionRow(interaction));
    }
  }

  for (const prompt of pending) {
    out.push({ kind: "pending", key: prompt.id, text: prompt.text });
  }
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
