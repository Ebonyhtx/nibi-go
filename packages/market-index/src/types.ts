// 市场索引的数据形状。字段只保留 NIBI-GO 独立手机市场真正需要的部分：
// 插件身份（id/version/kind）、兼容性（minApp/caps）、包位置（zip 或标准 npm）、
// 展示信息与付费占位（priceId 走账号授权门禁）。
import { z } from "zod";

export const MARKET_ID = "nibi-official" as const;
export const MARKET_SCHEMA_VERSION = 1 as const;

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION_RE = /^\d{1,6}(?:\.\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const SRI_RE = /^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/u;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/u;
const SERVER_NAME_RE = /^[a-z][a-z0-9_]{1,31}$/u;

const httpsUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "必须是 https 地址");

export const zipPackageSchema = z.object({
  /** 只接受 https；客户端不跟随到其它协议。 */
  url: httpsUrlSchema,
  /** 包字节的 SHA-256（hex）；安装前必须逐个校验。 */
  sha256: z.string().regex(SHA256_RE, "必须是 64 位小写 hex"),
  /** 字节数；用于下载预算与进度展示。 */
  size: z.number().int().positive().max(64 * 1024 * 1024),
  format: z.literal("zip"),
});

export const npmEnvSpecSchema = z.object({
  name: z.string().regex(ENV_NAME_RE, "环境变量名必须是大写字母/数字/下划线"),
  title: z.string().min(1).max(64),
  description: z.string().max(160).optional(),
  placeholder: z.string().max(64).optional(),
  required: z.boolean().optional(),
});

export const npmPackageSchema = z.object({
  format: z.literal("npm"),
  /** 标准 npm 包名（支持 @scope/name）。 */
  name: z.string().min(1).max(214).regex(NPM_NAME_RE, "npm 包名不合法"),
  /** 精确版本号（禁止 ^ / ~ / latest，防止上游静默漂移）。 */
  version: z.string().regex(VERSION_RE, "npm 版本号必须是精确版本"),
  /** npm registry 返回的 dist.integrity（SRI 摘要，防篡改）。 */
  integrity: z.string().max(160).regex(SRI_RE, "integrity 必须是合法 SRI 摘要"),
  /** 可选参考体积（字节，用于展示）。 */
  size: z.number().int().positive().max(64 * 1024 * 1024).optional(),
  /** 多 bin 包指定入口名；省略时取唯一 bin 或包同名 bin。 */
  bin: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => !value.includes("/") && !value.includes("\\") && value !== "..", "bin 名不合法")
    .optional(),
  /** 启动 MCP stdio 时附加的固定参数。 */
  args: z
    .array(z.string().min(1).max(200).refine((value) => !value.includes("\0"), "参数含非法字符"))
    .max(16)
    .optional(),
  /** MCP 需要的环境变量，安装后自动映射为插件设置项。 */
  env: z.array(npmEnvSpecSchema).max(8).optional(),
  /** 可选 MCP 服务器名覆写（缺省按包名归一化）。 */
  serverName: z.string().regex(SERVER_NAME_RE, "serverName 必须是小写字母/数字/下划线").optional(),
  alwaysLoad: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export const packageSchema = z.discriminatedUnion("format", [
  zipPackageSchema,
  npmPackageSchema,
]);

export const marketPluginSchema = z.object({
  id: z.string().regex(ID_RE, "插件 id 不合法"),
  name: z.string().min(1).max(64),
  version: z.string().regex(VERSION_RE, "版本号不合法"),
  description: z.string().max(500).optional(),
  /** 插件形态：mcp 工具服务器 / skill 技能命令包 / hybrid 混合包。 */
  kind: z.enum(["mcp", "skill", "hybrid"]).optional(),
  minApp: z.string().max(32).optional(),
  caps: z.array(z.string().max(32)).max(16),
  runtime: z.enum(["node", "declarative"]).optional(),
  package: packageSchema,
  publisher: z.string().max(64).optional(),
  /** 发布者的 GitHub 登录名；首次上架时绑定，后续同 id 更新必须同一账号。 */
  publisherGithub: z.string().max(39).optional(),
  license: z.string().max(64).optional(),
  homepage: httpsUrlSchema.optional(),
  source: httpsUrlSchema.optional(),
  /** 付费占位：按需走账号授权门禁。 */
  paid: z.object({ priceId: z.string().max(64) }).optional(),
});

/** 随包内置插件的官方目录元数据：只用于展示与官方归属，不产生可下载包体。 */
export const bundledPluginSchema = z.object({
  id: z.string().regex(ID_RE),
  name: z.string().min(1).max(64),
  version: z.string().regex(VERSION_RE),
  description: z.string().max(280).optional(),
  minApp: z.string().max(32).optional(),
  publisher: z.string().max(64).optional(),
});

export const marketIndexSchema = z.object({
  schemaVersion: z.literal(MARKET_SCHEMA_VERSION),
  market: z.literal(MARKET_ID),
  /** 单调递增；发布链每次发布 +1。防回滚靠它，不靠时间戳。 */
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  /** ISO 时间，仅用于展示与排查；不参与新鲜度判断。 */
  generatedAt: z.string().max(40),
  plugins: z.array(marketPluginSchema).max(500),
  /** 可选：随 APK 内置的 NIBI 官方插件目录；旧客户端会忽略未知字段。 */
  bundledPlugins: z.array(bundledPluginSchema).max(64).optional(),
});

export type ZipMarketPluginPackage = z.infer<typeof zipPackageSchema>;
export type NpmMarketPluginPackage = z.infer<typeof npmPackageSchema>;
export type NpmEnvSpec = z.infer<typeof npmEnvSpecSchema>;
export type MarketPluginPackage = z.infer<typeof packageSchema>;
export type MarketPluginEntry = z.infer<typeof marketPluginSchema>;
export type BundledPluginEntry = z.infer<typeof bundledPluginSchema>;
export type MarketIndex = z.infer<typeof marketIndexSchema>;

/** 统一包不可变指纹：用于防同版本替换内容（zip 与 npm 共用）。 */
export function packagePinDigest(pkg: MarketPluginPackage): string {
  if (pkg.format === "npm") {
    return `npm:${pkg.name}@${pkg.version}:${pkg.integrity}`;
  }
  return `zip:${pkg.sha256}`;
}
