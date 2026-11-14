import type { KernelMessage } from "./protocol";

/**
 * UI 行模型：内核的 `{info, parts}` 消息 → 会话界面可直接渲染的行。
 *
 * 只做纯映射，不碰状态与网络；未来加工具卡/推理块时在这一个 switch 里扩展。
 */
export type ConversationRow =
  | {
      kind: "user";
      id: string;
      text: string;
      createdAt?: number;
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      createdAt?: number;
      completedAt?: number;
      model?: { providerId: string; modelId: string };
    }
  | {
      kind: "system";
      id: string;
      text: string;
    };

/** 只取文本 part；非文本 part（工具/推理）先丢弃，等对应卡片实现再加。 */
function textOf(message: KernelMessage): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

export function mapKernelMessages(messages: readonly KernelMessage[]): ConversationRow[] {
  const rows: ConversationRow[] = [];
  for (const message of messages) {
    const id = message.info.messageId;
    if (typeof id !== "string" || id.length === 0) continue;
    const text = textOf(message);
    switch (message.info.role) {
      case "user":
        rows.push({ kind: "user", id, text, createdAt: message.info.time?.created });
        break;
      case "assistant": {
        const model = message.info.model;
        rows.push({
          kind: "assistant",
          id,
          text,
          createdAt: message.info.time?.created,
          completedAt: message.info.time?.completed,
          ...(model?.providerId && model?.modelId
            ? { model: { providerId: model.providerId, modelId: model.modelId } }
            : {}),
        });
        break;
      }
      case "system":
        rows.push({ kind: "system", id, text });
        break;
      default:
        // 未知角色先跳过：宁可少显示，也不把协议噪声塞进 UI。
        break;
    }
  }
  return rows;
}
