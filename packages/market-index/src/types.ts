// 市场索引的数据形状。字段只保留 GO 插件真正需要的部分：
// 插件身份（id/version）、兼容性（minApp/caps）、包位置（url/sha256/size）、
// 展示信息与付费占位（priceId 只做占位，门禁在后续阶段接）。
import { z } from "zod";

export const MARKET_ID = "nibi-official" as const;
export const MARKET_SCHEMA_VERSION = 1 as const;

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

const packageSchema = z.object({
  /** 只接受 https；客户端不跟随到其它协议。 */
  url: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, "必须是 https 地址"),
  /** 包字节的 SHA-256（hex）；安装前必须逐个校验。 */
  sha256: z.string().regex(SHA256_RE, "必须是 64 位小写 hex"),
  /** 字节数；用于下载预算与进度展示。 */
  size: z.number().int().positive().max(64 * 1024 * 1024),
  format: z.literal("zip"),
});

export const marketPluginSchema = z.object({
  id: z.string().regex(ID_RE, "插件 id 不合法"),
  name: z.string().min(1).max(64),
  version: z.string().regex(VERSION_RE, "版本号不合法"),
  description: z.string().max(500).optional(),
  minApp: z.string().max(32).optional(),
  caps: z.array(z.string().max(32)).max(16),
  runtime: z.enum(["node", "declarative"]).optional(),
  package: packageSchema,
  publisher: z.string().max(64).optional(),
  license: z.string().max(64).optional(),
  /** 付费占位：本阶段只透传，不做门禁。 */
  paid: z.object({ priceId: z.string().max(64) }).optional(),
});

export const marketIndexSchema = z.object({
  schemaVersion: z.literal(MARKET_SCHEMA_VERSION),
  market: z.literal(MARKET_ID),
  /** 单调递增；发布链每次发布 +1。防回滚靠它，不靠时间戳。 */
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  /** ISO 时间，仅用于展示与排查；不参与新鲜度判断。 */
  generatedAt: z.string().max(40),
  plugins: z.array(marketPluginSchema).max(500),
});

export type MarketPluginPackage = z.infer<typeof packageSchema>;
export type MarketPluginEntry = z.infer<typeof marketPluginSchema>;
export type MarketIndex = z.infer<typeof marketIndexSchema>;
