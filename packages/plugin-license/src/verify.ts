// compact JWS 的离线验签：只回答「这串字节确实由对应私钥签发、没被改过」。
import { ed25519 } from "@noble/curves/ed25519.js";

import { base64UrlToBytes, decodeBase64UrlText, licenseClaimsSchema, type LicenseClaims } from "./claims";
import { NIBI_LICENSE_KEYS, type LicenseKey } from "./keys";

export interface VerifiedLicense {
  claims: LicenseClaims;
  kid: string;
}

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** 验签失败返回 null（签名/结构/issuer 任一不对都算失败）。 */
export function verifyLicenseToken(
  token: string,
  keys: Record<string, LicenseKey> = NIBI_LICENSE_KEYS,
): VerifiedLicense | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const headerText = decodeBase64UrlText(headerPart);
  if (!headerText) return null;
  let header: { kid?: unknown; alg?: unknown };
  try {
    header = JSON.parse(headerText) as { kid?: unknown; alg?: unknown };
  } catch {
    return null;
  }
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (header.alg !== undefined && header.alg !== "Ed25519") return null;
  const key = keys[kid];
  if (!key) return null;
  const publicKey = hexToBytes(key.publicKeyHex);
  if (!publicKey || publicKey.length !== 32) return null;
  const signatureBytes = base64UrlToBytes(signaturePart);
  if (!signatureBytes || signatureBytes.length !== 64) return null;

  let ok = false;
  try {
    ok = ed25519.verify(signatureBytes, encoder.encode(`${headerPart}.${payloadPart}`), publicKey);
  } catch {
    return null;
  }
  if (!ok) return null;

  const payloadText = decodeBase64UrlText(payloadPart);
  if (!payloadText) return null;
  let rawClaims: unknown;
  try {
    rawClaims = JSON.parse(payloadText);
  } catch {
    return null;
  }
  const claims = licenseClaimsSchema.safeParse(rawClaims);
  if (!claims.success) return null;
  return { claims: claims.data, kid };
}
