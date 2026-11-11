// 来源: nibi-client@ff1c5f4f packages/shared/src/nibi-protocol/trace.ts（未改写语义；仅 import 路径按本包布局调整）
import { z } from "zod";

export const nibiProtocolTraceSchema = z
  .object({
    traceId: z.string().min(1).optional(),
    parentId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional(),
    traceparent: z.string().min(1).optional(),
  })
  .strict();
export type NibiProtocolTrace = z.infer<typeof nibiProtocolTraceSchema>;
