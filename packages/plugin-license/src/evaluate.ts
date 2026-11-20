// 付费插件的离线授权判定（fail-closed）。
//
// | 情形 | 结果 |
// | --- | --- |
// | 没有 token | not_activated |
// | 验签/结构失败 | denied |
// | exp 已过 | expired |
// | dev 缺失或与本机 deviceId 不一致 | device_mismatch |
// | plugins 不含该 id（且没有 "*"） | not_covered |
// | 以上都通过 | active |
//
// 在线拒绝与宽限期不在本阶段（不启动收费）；接入账号侧时再补 snapshot 判定。
import type { LicenseClaims } from "./claims";
import { NIBI_LICENSE_KEYS, type LicenseKey } from "./keys";
import { verifyLicenseToken } from "./verify";

export type PluginLicenseStatus =
  | "active"
  | "not_activated"
  | "denied"
  | "expired"
  | "device_mismatch"
  | "not_covered";

export interface PluginLicenseDecision {
  status: PluginLicenseStatus;
  allowed: boolean;
  /** 给用户看的中文原因。 */
  reason: string;
  claims: LicenseClaims | null;
  /** 到期时间（ISO）；没有凭证时为 null。 */
  expiresAt: string | null;
}

export interface EvaluatePluginLicenseParams {
  token: string | null | undefined;
  /** 市场插件 id（license.plugins 里的名字）。 */
  pluginId: string;
  /** 本机设备 id；缺失按不通过处理。 */
  deviceId: string | null | undefined;
  now?: number;
  keys?: Record<string, LicenseKey>;
}

function deny(
  status: PluginLicenseStatus,
  reason: string,
  claims: LicenseClaims | null = null,
): PluginLicenseDecision {
  return { status, allowed: false, reason, claims, expiresAt: null };
}

export function evaluatePluginLicense(params: EvaluatePluginLicenseParams): PluginLicenseDecision {
  const token = params.token?.trim();
  if (!token) {
    return deny("not_activated", "这台设备还没有付费插件授权");
  }
  const verified = verifyLicenseToken(token, params.keys ?? NIBI_LICENSE_KEYS);
  if (!verified) {
    return deny("denied", "授权凭证无效（签名或格式不对），请重新获取");
  }
  const { claims } = verified;
  const expiresAt = new Date(claims.exp * 1000).toISOString();
  const now = params.now ?? Date.now();
  if (claims.exp * 1000 <= now) {
    return { status: "expired", allowed: false, reason: "付费授权已过期", claims, expiresAt };
  }
  if (!claims.dev || !params.deviceId || claims.dev !== params.deviceId) {
    return {
      status: "device_mismatch",
      allowed: false,
      reason: "授权凭证与本机设备不匹配",
      claims,
      expiresAt,
    };
  }
  const covered = claims.plugins.includes("*") || claims.plugins.includes(params.pluginId);
  if (!covered) {
    return {
      status: "not_covered",
      allowed: false,
      reason: "当前授权不包含这个插件",
      claims,
      expiresAt,
    };
  }
  return { status: "active", allowed: true, reason: "已授权", claims, expiresAt };
}
