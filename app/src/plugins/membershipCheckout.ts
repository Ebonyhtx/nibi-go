// NIBI 内嵌 WebView 收银台 handoff 换码：与桌面客户端（NIBI-Client createNibiCheckoutUrl）共用同一套链路。
//
// 流程：
// 1. 取本机已登录的 NIBI OAuth access_token（到期前自动续期）；
// 2. POST https://api.nibistudio.cn/api/v1/auth/handoff 换取一次性短期 handoff code；
// 3. 拼出 https://nibistudio.cn/membership/?embedded=app&handoff=<code> 交由应用内 WebView 打开；
//    普通外部浏览器直接访问无 handoff / 无 ticket 会被网关拦截（403 / 登录门禁），只有客户端内嵌 WebView 可用。

import { NibiAuthProvider } from "../relay/auth";
import { ENDPOINT_ORIGIN } from "../relay/config";

export const NIBI_MEMBERSHIP_EMBEDDED_URL = "https://nibistudio.cn/membership/?embedded=app";
const HANDOFF_TIMEOUT_MS = 10_000;

export type CheckoutUrlOutcome =
  | { ok: true; url: string; expiresAt?: number }
  | { ok: false; code: "auth_required" | "account_banned" | "network_error"; message: string };

interface HandoffResponse {
  code?: string | number;
  expiresAt?: number;
  error?: string;
  message?: string;
  data?: {
    code?: string;
    expiresAt?: number;
  } | null;
}

export async function createNibiCheckoutUrl(): Promise<CheckoutUrlOutcome> {
  const auth = new NibiAuthProvider();
  let accessToken: string;
  try {
    accessToken = await auth.getJwt();
  } catch {
    return {
      ok: false,
      code: "auth_required",
      message: "请先在 NIBI-GO 登录账号后再继续。",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HANDOFF_TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT_ORIGIN}/api/v1/auth/handoff`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: HandoffResponse | null = null;
    try {
      payload = text ? (JSON.parse(text) as HandoffResponse) : null;
    } catch {
      payload = null;
    }

    if (response.status === 401) {
      return {
        ok: false,
        code: "auth_required",
        message: "登录状态已过期，请重新登录 NIBI 账号。",
      };
    }
    if (response.status === 403 && payload?.error === "account_banned") {
      return {
        ok: false,
        code: "account_banned",
        message: payload.message ?? "当前账号已被限制访问，请联系 contact@nibistudio.cn。",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        code: "network_error",
        message: payload?.message ?? `连接账号中心失败（HTTP ${response.status}）`,
      };
    }

    const handoffCode =
      typeof payload?.code === "string"
        ? payload.code.trim()
        : typeof payload?.data?.code === "string"
          ? payload.data.code.trim()
          : "";
    if (!handoffCode) {
      return {
        ok: false,
        code: "network_error",
        message: "未获取到有效的内嵌会话凭证，请稍后重试。",
      };
    }

    const checkoutUrl = new URL(NIBI_MEMBERSHIP_EMBEDDED_URL);
    checkoutUrl.searchParams.set("handoff", handoffCode);
    return {
      ok: true,
      url: checkoutUrl.toString(),
      expiresAt: payload?.expiresAt ?? payload?.data?.expiresAt,
    };
  } catch (error) {
    return {
      ok: false,
      code: "network_error",
      message: error instanceof Error ? error.message : "网络连接异常，请检查网络后重试。",
    };
  } finally {
    clearTimeout(timer);
  }
}
