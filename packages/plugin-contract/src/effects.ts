// 效果白名单（设计文档 §7：3 秒窗口、每次 ≤4 个、`insert` 永不自动发送）。
//
// 插件不能直接改导航/主题/权限；能做的只有这几种可审计的效果。App 执行前再按同一份
// 规则复核一次（契约包不假设渲染层一定校验过）。

import { z } from "zod";

import type { ContractIssue, Effect } from "./types";

export const MAX_EFFECTS_PER_ACTION = 4;
export const INSERT_MAX_CHARS = 2_000;
export const TOAST_MAX_CHARS = 200;
export const COPY_MAX_CHARS = 4_000;
export const LINK_MAX_CHARS = 2_048;

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);

/** `link` 只许 https、无凭据、长度受限；`command` 永远不能叫 permission。 */
export const effectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("insert"),
    text: z.string().min(1).max(INSERT_MAX_CHARS),
    mode: z.enum(["append", "replace"]).optional(),
  }),
  z.object({ kind: z.literal("toast"), text: z.string().min(1).max(TOAST_MAX_CHARS) }),
  z.object({ kind: z.literal("copy"), text: z.string().min(1).max(COPY_MAX_CHARS) }),
  z.object({ kind: z.literal("open"), panel: idSchema }),
  z.object({
    kind: z.literal("link"),
    url: z
      .string()
      .max(LINK_MAX_CHARS)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && url.username === "" && url.password === "";
        } catch {
          return false;
        }
      }, "只允许无凭据的 https 链接"),
  }),
  z.object({
    kind: z.literal("command"),
    name: z.string().min(1).max(64).refine((name) => name !== "permission", "插件不能碰权限选择"),
    args: z.unknown().optional(),
  }),
  z.object({ kind: z.literal("refresh") }),
]);

export type EffectInput = z.infer<typeof effectSchema>;

/**
 * 逐条解析效果；坏的一条只丢这一条（`issues` 留证据），超过 4 条的尾巴直接丢弃。
 * 返回值永远是可用数组——调用方不需要 try/catch。
 */
export function readEffects(raw: unknown, path: string): {
  effects: Effect[];
  issues: ContractIssue[];
} {
  const issues: ContractIssue[] = [];
  const effects: Effect[] = [];
  if (raw === undefined || raw === null) return { effects, issues };
  if (!Array.isArray(raw)) {
    issues.push({ path, message: "effects 必须是数组" });
    return { effects, issues };
  }
  if (raw.length > MAX_EFFECTS_PER_ACTION) {
    issues.push({
      path,
      message: `effects 最多 ${MAX_EFFECTS_PER_ACTION} 个，已丢弃多出的 ${raw.length - MAX_EFFECTS_PER_ACTION} 个`,
    });
  }
  raw.slice(0, MAX_EFFECTS_PER_ACTION).forEach((value, index) => {
    const parsed = effectSchema.safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? "格式不合法";
      issues.push({ path: `${path}/${index}`, message: detail });
      return;
    }
    effects.push(parsed.data as Effect);
  });
  return { effects, issues };
}