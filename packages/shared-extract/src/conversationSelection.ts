// 来源: nibi-client@ff1c5f4f packages/shared/src/conversationSelection.ts（未改写语义；仅 import 路径按本包布局调整）
import { z } from "zod";
export const CONVERSATION_SELECTION_MAX_TEXT_LENGTH = 8_000;
export const CONVERSATION_SELECTION_MAX_COUNT = 8;
export const CONVERSATION_SELECTION_MAX_TOTAL_LENGTH = 16_000;

export const conversationQuoteSchema = z.object({
  text: z.string().max(CONVERSATION_SELECTION_MAX_TEXT_LENGTH),
  path: z.string().optional(),
  senderName: z.string().optional(),
  senderId: z.string().optional(),
  messageId: z.string().optional(),
  sentAt: z.string().datetime({ offset: true }).optional(),
  // GO 的注释：引用仍然走 conversationQuotes，但多带一条针对这段原文的评论/指令。
  // 这些字段只影响模型文本与历史回显，不改变 NIBI 客户端的引用契约。
  kind: z.enum(["annotation", "quote"]).optional(),
  comment: z.string().max(4_000).optional(),
  instruction: z.string().max(2_000).optional(),
  number: z.number().int().positive().optional(),
  messageKey: z.string().max(128).optional(),
  messageRole: z.enum(["user", "assistant"]).optional(),
});
export const conversationQuotesSchema = z
  .array(conversationQuoteSchema)
  .max(CONVERSATION_SELECTION_MAX_COUNT)
  .refine(
    (quotes) =>
      quotes.reduce((sum, quote) => sum + quote.text.length, 0) <=
      CONVERSATION_SELECTION_MAX_TOTAL_LENGTH,
  );
export type ConversationSelectionText = z.infer<typeof conversationQuoteSchema>;

/** 插件引用（模型边界的能力元数据；identifiers-only）。 */
export const pluginReferenceSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(64).optional(),
  skills: z.array(z.string().max(128)).max(32).optional(),
  mcpServers: z.array(z.string().max(128)).max(16).optional(),
  commands: z.array(z.string().max(128)).max(16).optional(),
});
export const pluginReferencesSchema = z.array(pluginReferenceSchema).max(8);
export type PluginReference = z.infer<typeof pluginReferenceSchema>;

export function buildPromptWithConversationSelections(
  visibleContent: string,
  references: readonly ConversationSelectionText[],
): string {
  if (references.length === 0) return visibleContent;
  // 文件选段曾只发正文，导致模型与历史丢失文件来源；只保留路径，不发送内部身份字段。
  const block = [
    "# userselect:",
    "```userselect",
    JSON.stringify(references.map(({ text, path }) => (path?.trim() ? { path, text } : { text }))),
    "```",
  ].join("\n");
  return visibleContent ? `${visibleContent}\n\n${block}` : block;
}
