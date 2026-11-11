// 来源: nibi-client@ff1c5f4f packages/shared/src/nibi-protocol-v4/attachment-ref.ts（未改写语义；仅 import 路径按本包布局调整）
import { z } from "zod";
import { attachmentSourceKindSchema } from "../attachment-source";

/** 仅承载已提交内容引用与展示元信息；内容本体不进入 command/topic frame。 */
export const attachmentRefSchema = z
  .object({
    ref: z.string(),
    fileName: z.string(),
    mime: z.string(),
    bytes: z.number(),
    sourceKind: attachmentSourceKindSchema.optional(),
    messageCount: z.number().int().nonnegative().optional(),
    previewRef: z.string().optional(),
  })
  .strict();

export type AttachmentRef = z.infer<typeof attachmentRefSchema>;
