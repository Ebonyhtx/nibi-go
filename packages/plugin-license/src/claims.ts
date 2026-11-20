// license 凭证的声明（claims）。字段与桌面端服务端签发口径一致。
import { z } from "zod";

export const LICENSE_ISSUER = "nibi-license" as const;

export const licenseClaimsSchema = z.object({
  iss: z.literal(LICENSE_ISSUER),
  sub: z.string().min(1).max(128),
  uid: z.string().min(1).max(128),
  plan: z.string().min(1).max(64),
  /** 可用的插件 id；"*" 表示全部。 */
  plugins: z.array(z.string().min(1).max(64)).max(256),
  /** 设备绑定（本机 device id）；缺失按不通过处理。 */
  dev: z.string().min(1).max(128).optional(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: z.string().min(1).max(128),
});

export type LicenseClaims = z.infer<typeof licenseClaimsSchema>;

/** base64url → 字节；坏输入返回 null（不依赖 Buffer/atob，Hermes 可用）。 */
export function base64UrlToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0;
  if (padded.length % 4 !== 0) return null;
  const output = new Uint8Array((padded.length / 4) * 3 - padding);
  let offset = 0;
  for (let index = 0; index < padded.length; index += 4) {
    const a = alphabet.indexOf(padded[index]!);
    const b = alphabet.indexOf(padded[index + 1]!);
    const c = padded[index + 2] === "=" ? 0 : alphabet.indexOf(padded[index + 2]!);
    const d = padded[index + 3] === "=" ? 0 : alphabet.indexOf(padded[index + 3]!);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < output.length) output[offset++] = combined >>> 16;
    if (offset < output.length) output[offset++] = (combined >>> 8) & 0xff;
    if (offset < output.length) output[offset++] = combined & 0xff;
  }
  return output;
}

export function decodeBase64UrlText(value: string): string | null {
  const bytes = base64UrlToBytes(value);
  if (!bytes) return null;
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
