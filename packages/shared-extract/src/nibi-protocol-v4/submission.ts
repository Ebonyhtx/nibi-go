// 来源: nibi-client@ff1c5f4f packages/shared/src/nibi-protocol-v4/submission.ts（未改写语义；仅 import 路径按本包布局调整）
import { z } from "zod";

/** Composer 可以显式提交的 Agent mode；auto 是 Runtime 内部状态，不进入用户 Submission。 */
export const submissionModeSchema = z.enum(["build", "edit", "plan", "yolo", "guarded"]);
export type SubmissionMode = z.infer<typeof submissionModeSchema>;
