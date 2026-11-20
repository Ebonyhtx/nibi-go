// 付费插件的离线授权判定（fail-closed）。
//
// | 情形 | 结果 |
// | --- | --- |
// | 没有 token | not_activated |
// | 验签/结构失败 | denied |
// | exp 已过 | expired |
// | dev 缺失或与本机 deviceId 不一致 | device_mismatch |
// | 凭证账号与当前登录账号不一致 | account_mismatch |
// | 上次成功检查超过 7 天 | expired（离线宽限期结束） |
// | 上次成功检查超过 72 小时 | grace（仍放行，提示尽快联网） |
// | plugins 不含该 id（且没有 "*"） | not_covered |
// | 以上都通过 | active |
//
// 宽限期与服务端 policy 对齐（72h 检查间隔 / 7 天离线宽限）。没有 lastCheckAt 的旧快照
// 不做时间判定，保持升级兼容；服务端明确拒绝仍由调用方的 lastRefusal 优先拦截。
import type { LicenseClaims } from "./claims";
import { NIBI_LICENSE_KEYS, type LicenseKey } from "./keys";
import { verifyLicenseToken } from "./verify";

export type PluginLicenseStatus =
  | "active"
  | "grace"
  | "not_activated"
  | "denied"
  | "expired"
  | "device_mismatch"
  | "account_mismatch"
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
  /** 当前登录账号（Zitadel sub）；有值时要求与凭证 sub 一致。 */
  accountId?: string | null;
  /** 上次成功在线检查的 ISO 时间；用于 72h/7d 宽限。 */
  lastCheckAt?: string | null;
  /** 服务端 policy；缺省 72h/7d。 */
  checkIntervalHours?: number;
  offlineGraceDays?: number;
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
  if (params.accountId && claims.sub !== params.accountId) {
    return {
      status: "account_mismatch",
      allowed: false,
      reason: "授权凭证属于另一个 NIBI 账号，请重新登录并同步",
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
  if (params.lastCheckAt) {
    const checkedAt = Date.parse(params.lastCheckAt);
    if (!Number.isFinite(checkedAt)) {
      return {
        status: "expired",
        allowed: false,
        reason: "上次授权检查时间无效，请联网重新同步",
        claims,
        expiresAt,
      };
    }
    const intervalMs =
      Math.max(1, params.checkIntervalHours ?? 72) * 60 * 60 * 1000;
    const graceMs =
      Math.max(0, params.offlineGraceDays ?? 7) * 24 * 60 * 60 * 1000;
    const age = now - checkedAt;
    // 桌面口径：72h 后进入宽限，7 天是“最后一次成功检查”起算的总上限，不是 72h+7d。
    if (age > graceMs) {
      return {
        status: "expired",
        allowed: false,
        reason: `离线授权检查已超过 ${params.offlineGraceDays ?? 7} 天宽限期，请联网同步`,
        claims,
        expiresAt,
      };
    }
    if (age > intervalMs) {
      return {
        status: "grace",
        allowed: true,
        reason: "已超过在线检查间隔，处于离线宽限期；请尽快联网同步",
        claims,
        expiresAt,
      };
    }
  }
  return { status: "active", allowed: true, reason: "已授权", claims, expiresAt };
}
