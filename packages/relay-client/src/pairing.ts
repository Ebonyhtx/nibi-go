// 配对双路径（D8）的 A1 手机侧原语：QR 解析 / 一次性 token / 设备列表 / 持久凭据。
// 协议依据: nibi-client docs/web-remote-control/relay-v2-pairing.md（§02 HTTP 契约 / §05 / §06 / QR 契约）。
// OAuth（NIBI 账号中心 Zitadel PKCE，§NIBI 落地差异）经注入的 getToken 供应商完成，
// JWT 不进本包、不进日志、不进二维码（凭据纪律）。
import {
  parseWebRemoteControlExternalQrParams,
  parseWebRemoteControlRelayV2HttpResponse,
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  WebRemoteControlV2ConnectionError,
  type WebRemoteControlRelayV2Device,
  type WebRemoteControlV2QrParams,
} from "@nibi-go/shared-extract";

import type { PairCredential, PairCredentialStore } from "./types";

// 兼容缺 AbortSignal.any/timeout/throwIfAborted 的运行时（RN Hermes，§05 浏览器 HTTP 取消兼容）：
// 请求作用域 AbortController，把调用方取消与 15s 期限接到同一信号；finally 清理。
const RELAY_HTTP_TIMEOUT_MS = 15_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function relayFetchEnvelope(
  url: string,
  jwt: string,
  method: "GET" | "POST",
  body: unknown,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", onCallerAbort);
  const timer = setTimeout(() => controller.abort(), RELAY_HTTP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    // HTTP 错误只保留分类，不透传正文/JWT/token（凭据纪律）
    if (response.status === 401) throw new WebRemoteControlV2ConnectionError("auth-required");
    if (response.status >= 400 && response.status < 500)
      throw new WebRemoteControlV2ConnectionError("relay-unavailable");
    if (response.status >= 500)
      throw new WebRemoteControlV2ConnectionError("relay-unavailable", true);
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new WebRemoteControlV2ConnectionError("relay-unavailable", true);
    }
    return envelope;
  } catch (error) {
    if (error instanceof WebRemoteControlV2ConnectionError) throw error;
    // 网络失败/中止：调用方主动取消原样上抛，其余按可重试网络错误
    if (controller.signal.aborted && signal.aborted) throw error;
    throw new WebRemoteControlV2ConnectionError("relay-unavailable", true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onCallerAbort);
  }
}

async function parseSuccessEnvelope<T>(
  operation: "token" | "list",
  envelope: unknown,
): Promise<T> {
  const parsed = parseWebRemoteControlRelayV2HttpResponse(operation, envelope);
  // 成功信封 code:0（带 data）；失败信封 code≠0（HTTP 200 业务失败，§02：必须同时检查状态与业务 code）
  if (!parsed || parsed.code !== 0)
    throw new WebRemoteControlV2ConnectionError("relay-unavailable", true);
  return (parsed as unknown as { data: T }).data;
}

/** POST /remote/token {role: terminal}——一次性 token，60s 有效，升级前原子消费。 */
export async function requestTerminalToken(
  origin: string,
  jwt: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<{ token: string; expiresIn: number }> {
  const envelope = await relayFetchEnvelope(
    `${origin}${WEB_REMOTE_CONTROL_RELAY_V2_HTTP.token.path}`,
    jwt,
    "POST",
    { role: "terminal" },
    signal,
    fetchImpl,
  );
  const data = await parseSuccessEnvelope<{ token: string; expires_in: number }>("token", envelope);
  return { token: data.token, expiresIn: data.expires_in };
}

/** GET /remote/device——当前账号设备列表（§06 落点与展示在 App 层编排）。 */
export async function listDevices(
  origin: string,
  jwt: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<WebRemoteControlRelayV2Device[]> {
  const envelope = await relayFetchEnvelope(
    `${origin}${WEB_REMOTE_CONTROL_RELAY_V2_HTTP.list.path}`,
    jwt,
    "GET",
    undefined,
    signal,
    fetchImpl,
  );
  return parseSuccessEnvelope<WebRemoteControlRelayV2Device[]>("list", envelope);
}

/** 解析桌面二维码内容（URL；带 hash/t 的旧链接 → null，无 sid 参数 → 空对象进设备列表）。 */
export function parseDesktopQr(raw: string): WebRemoteControlV2QrParams | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return parseWebRemoteControlExternalQrParams(url.searchParams);
}

/** 二维码所在 endpoint origin（NIBI 落地：扫码链接落在 API 域名，页面与中继同源）。 */
export function qrEndpointOrigin(raw: string): string | undefined {
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return undefined;
  }
}

/** 配对双路径（D8）的凭据编排：扫码目标覆盖持久凭据并落库；无扫码 → 用持久凭据免扫重连。 */
export class PairingFlow {
  constructor(private readonly store: PairCredentialStore) {}

  async resolveTarget(
    scanned: { qr: WebRemoteControlV2QrParams; origin: string } | null,
    userId?: string,
  ): Promise<PairCredential | undefined> {
    if (scanned?.qr.deviceSid) {
      const credential: PairCredential = {
        deviceSid: scanned.qr.deviceSid,
        deviceMid: scanned.qr.deviceMid,
        deviceName: scanned.qr.deviceName,
        appVersion: scanned.qr.appVersion,
        endpointOrigin: scanned.origin,
        userId,
        savedAt: Date.now(),
      };
      await this.store.save(credential);
      return credential;
    }
    return this.store.load();
  }

  /** 仅 链接过期/凭据到期/设备被删 三类情况重配对（D8）——由调用方在归属失败等场景触发。 */
  async forget(): Promise<void> {
    await this.store.clear();
  }
}
