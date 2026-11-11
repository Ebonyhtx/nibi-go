// 来源: nibi-client@ff1c5f4f packages/shared/src/attachment-source.ts（未改写语义；仅 import 路径按本包布局调整）
import { z } from "zod";

/** 文本材料只传递文件引用，不能因跨端上传而退回自动全文注入。 */
export const attachmentSourceKindSchema = z.enum(["clipboard-text", "topic-history"]);
export type AttachmentSourceKind = z.infer<typeof attachmentSourceKindSchema>;
