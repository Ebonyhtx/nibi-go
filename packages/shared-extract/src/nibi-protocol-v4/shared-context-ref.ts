// 来源: nibi-client@ff1c5f4f packages/shared/src/nibi-protocol-v4/shared-context-ref.ts（未改写语义；仅 import 路径按本包布局调整）
import { z } from "zod";

export const sharedContextRefSchema = z
  .object({
    kind: z.literal("shared_context_import"),
    context_id: z.string().trim().min(1),
  })
  .strict();

export type SharedContextRef = z.infer<typeof sharedContextRefSchema>;
