// 付费授权的在线同步：POST /api/v1/licenses/check（与桌面同一条服务端链路）。
//
// 两条身份路（与服务端一致）：
// - 已登录：Authorization: Bearer <NIBI access token>（换取/续期 license）；
// - 没有登录态但有本机 license：X-Nibi-License: <token>（日常检查）。
// 服务端明确拒绝写 lastRefusal（判定层立即 deny）；网络失败不动缓存。

import { decodeBase64UrlText } from "@nibi-go/plugin-license";

import { ENDPOINT_ORIGIN } from "../relay/config";
import { getNibiAccessToken } from "../relay/useSession";

import {
  clearLicense,
  currentDeviceId,
  currentLicenseAccountId,
  currentLicenseToken,
  ensureLicenseLoaded,
  saveLicenseSnapshot,
  setLicenseToken,
} from "./license";

const CHECK_URL = `${ENDPOINT_ORIGIN}/api/v1/licenses/check`;
const TIMEOUT_MS = 15_000;

interface CheckResponse {
  authorized?: boolean;
  reason?: string | null;
  error?: string | null;
  upgradeUrl?: string | null;
  license?: { token?: string; expiresAt?: string | null; plan?: string | null } | null;
  membership?: { status?: string; expiresAt?: string | null; plan?: string | null } | null;
  policy?: { checkIntervalHours?: number; offlineGraceDays?: number } | null;
}

/** 从 Zitadel access token 的 payload 取 sub；只用于换号检测，不参与验签。 */
function jwtSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = decodeBase64UrlText(parts[1]!);
  if (!payload) return null;
  try {
    const value = JSON.parse(payload) as { sub?: unknown };
    return typeof value.sub === "string" && value.sub ? value.sub : null;
  } catch {
    return null;
  }
}

export type LicenseSyncOutcome =
  | {
      ok: true;
      authorized: boolean;
      reason: string | null;
      /** 服务端给的人读说明（403 时比 reason 更具体，例如设备上限）。 */
      detail?: string | null;
      upgradeUrl?: string | null;
      plan: string | null;
      expiresAt: string | null;
    }
  | { ok: false; kind: "login-required" | "network" | "http"; detail: string };

async function requestCheck(
  headers: Record<string, string>,
  deviceId: string,
): Promise<{ response: Response; body: CheckResponse } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(CHECK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        deviceId,
        deviceName: "NIBI-GO",
        platform: "android",
        plugins: [],
      }),
      signal: controller.signal,
    });
    let body: CheckResponse = {};
    try {
      body = (await response.json()) as CheckResponse;
    } catch {
      body = {};
    }
    return { response, body };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function syncLicense(): Promise<LicenseSyncOutcome> {
  await ensureLicenseLoaded();
  const deviceId = currentDeviceId();
  if (!deviceId) return { ok: false, kind: "network", detail: "设备标识不可用" };

  let authorization: string | null = null;
  try {
    authorization = await getNibiAccessToken();
  } catch {
    authorization = null;
  }
  let licenseToken = currentLicenseToken();
  const accountId = authorization ? jwtSubject(authorization) : null;
  // 换号：旧账号的 license 不能继续用；先清掉，再按新 Bearer 换证。
  if (accountId && currentLicenseAccountId() && accountId !== currentLicenseAccountId()) {
    await clearLicense();
    licenseToken = null;
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  const usedBearer = authorization !== null;
  if (authorization) headers.authorization = `Bearer ${authorization}`;
  else if (licenseToken) headers["x-nibi-license"] = licenseToken;
  else return { ok: false, kind: "login-required", detail: "未登录 NIBI 账号" };

  let result = await requestCheck(headers, deviceId);
  if ("error" in result) {
    return { ok: false, kind: "network", detail: result.error };
  }
  // Bearer 失效时退回本机 license（桌面同口径）：登录过期不等于会员被撤销。
  if (result.response.status === 401 && usedBearer && licenseToken) {
    result = await requestCheck(
      { "content-type": "application/json", "x-nibi-license": licenseToken },
      deviceId,
    );
    if ("error" in result) {
      return { ok: false, kind: "network", detail: result.error };
    }
  }

  const { response, body } = result;
  const detail = body.error ?? null;
  const upgradeUrl = body.upgradeUrl ?? null;

  if (response.status === 401 && usedBearer) {
    // 登录令牌过期（且没有可回退的 license）≠ 会员被撤销：不写拒绝。
    return { ok: false, kind: "login-required", detail: detail ?? "登录已过期" };
  }

  if (response.ok && body.authorized === true && body.license?.token) {
    const plan = body.license.plan ?? body.membership?.plan ?? null;
    const expiresAt = body.license.expiresAt ?? body.membership?.expiresAt ?? null;
    await setLicenseToken(body.license.token);
    await saveLicenseSnapshot({
      lastCheckAt: new Date().toISOString(),
      plan,
      expiresAt,
      lastRefusal: null,
      accountId: accountId ?? currentLicenseAccountId(),
      checkIntervalHours:
        typeof body.policy?.checkIntervalHours === "number"
          ? body.policy.checkIntervalHours
          : null,
      offlineGraceDays:
        typeof body.policy?.offlineGraceDays === "number" ? body.policy.offlineGraceDays : null,
    });
    return { ok: true, authorized: true, reason: null, plan, expiresAt };
  }

  if (response.status === 401 || response.status === 403 || body.authorized === false) {
    const reason = body.reason ?? `http_${response.status}`;
    await saveLicenseSnapshot({
      lastCheckAt: new Date().toISOString(),
      lastRefusal: reason,
      expiresAt: body.membership?.expiresAt ?? null,
      ...(accountId ? { accountId } : {}),
    });
    return {
      ok: true,
      authorized: false,
      reason,
      detail,
      upgradeUrl,
      plan: null,
      expiresAt: body.membership?.expiresAt ?? null,
    };
  }

  return { ok: false, kind: "http", detail: `HTTP ${response.status}` };
}
