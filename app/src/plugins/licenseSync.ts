// 付费授权的在线同步：POST /api/v1/licenses/check（与桌面同一条服务端链路）。
//
// 两条身份路（与服务端一致）：
// - 已登录：Authorization: Bearer <NIBI access token>（换取/续期 license）；
// - 没有登录态但有本机 license：X-Nibi-License: <token>（日常检查）。
// 服务端明确拒绝写 lastRefusal（判定层立即 deny）；网络失败不动缓存。

import { ENDPOINT_ORIGIN } from "../relay/config";
import { getNibiAccessToken } from "../relay/useSession";

import {
  currentDeviceId,
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
  license?: { token?: string; expiresAt?: string | null; plan?: string | null } | null;
  membership?: { status?: string; expiresAt?: string | null; plan?: string | null } | null;
}

export type LicenseSyncOutcome =
  | {
      ok: true;
      authorized: boolean;
      reason: string | null;
      plan: string | null;
      expiresAt: string | null;
    }
  | { ok: false; kind: "login-required" | "network" | "http"; detail: string };

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
  const licenseToken = currentLicenseToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers.authorization = `Bearer ${authorization}`;
  else if (licenseToken) headers["x-nibi-license"] = licenseToken;
  else return { ok: false, kind: "login-required", detail: "未登录 NIBI 账号" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(CHECK_URL, {
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
  } catch (error) {
    return { ok: false, kind: "network", detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }

  let body: CheckResponse = {};
  try {
    body = (await response.json()) as CheckResponse;
  } catch {
    body = {};
  }

  if (response.status === 401 && authorization) {
    // 登录令牌过期 ≠ 会员被撤销：不写拒绝。
    return { ok: false, kind: "login-required", detail: "登录已过期" };
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
    });
    return { ok: true, authorized: true, reason: null, plan, expiresAt };
  }

  if (response.status === 401 || response.status === 403 || body.authorized === false) {
    const reason = body.reason ?? `http_${response.status}`;
    await saveLicenseSnapshot({
      lastCheckAt: new Date().toISOString(),
      lastRefusal: reason,
      expiresAt: body.membership?.expiresAt ?? null,
    });
    return { ok: true, authorized: false, reason, plan: null, expiresAt: body.membership?.expiresAt ?? null };
  }

  return { ok: false, kind: "http", detail: `HTTP ${response.status}` };
}
