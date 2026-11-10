// NIBI 账号中心（Zitadel）授权码 + PKCE 登录（移植自 nibi-client nibiWebOAuth.ts，差异见注释）。
//   - 回调 = 自定义 scheme `nibigo://login`（native app 语义；Web 页是同源 /remote/v4）
//   - 令牌交换/续期走同一服务端代理 POST /api/v1/oauth/nibi/token（不直连 IdP）
//   - PKCE 是唯一持有证明（无 client secret）；access token 同时是中继 Bearer
// 凭据纪律：token 只进 expo-secure-store（Keystore 加密），不进日志。
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { WebRemoteControlV2ConnectionError } from "@nibi-go/shared-extract";

import { AUTHORIZE_URL, OAUTH_SCOPE, OIDC_CLIENT_ID, TOKEN_EXCHANGE_URL } from "./config";
import { tokenStore, type StoredTokenSet } from "./secureStore";

const VERIFIER_BYTES = 48; // RFC 7636 上游惯例：48 随机字节 → 64 字符 verifier
const EXPIRY_MARGIN_MS = 5 * 60 * 1000; // 到期前 5 分钟续期（对齐上游 2026-10-25 约定）

const STANDARD_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    out += STANDARD_B64[b1 >> 2];
    out += STANDARD_B64[((b1 & 0x03) << 4) | ((b2 ?? 0) >> 4)];
    out += b2 === undefined ? "=" : STANDARD_B64[((b2 & 0x0f) << 2) | ((b3 ?? 0) >> 6)];
    out += b3 === undefined ? "=" : STANDARD_B64[b3 & 0x3f];
  }
  return out.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

interface ExchangeEnvelope {
  code?: number;
  msg?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { displayName?: string; preferredLoginName?: string } | null;
  } | null;
}

export class NibiAuthProvider {
  private cached?: StoredTokenSet;
  private refreshing?: Promise<string>;

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * 取中继/业务 Bearer（access token）。到期前 5 分钟自动续期；
   * 无凭据/续期失败抛 WebRemoteControlV2ConnectionError("auth-required")——
   * transport 会落 auth-required 终态并停止重连。
   */
  async getJwt(_signal?: AbortSignal): Promise<string> {
    const cached = this.cached ?? (await tokenStore.load());
    if (cached) this.cached = cached;
    if (cached?.accessToken) {
      const fresh =
        !cached.expiresAt || cached.expiresAt - this.now() > EXPIRY_MARGIN_MS;
      if (fresh) return cached.accessToken;
      if (cached.refreshToken) {
        this.refreshing ??= this.refresh(cached.refreshToken).finally(() => {
          this.refreshing = undefined;
        });
        return this.refreshing;
      }
    }
    throw new WebRemoteControlV2ConnectionError("auth-required");
  }

  /** 系统浏览器 PKCE 登录。forceLogin=true 时强制 IdP 重新认证（切换账号）。 */
  async login(forceLogin = false): Promise<StoredTokenSet> {
    if (!OIDC_CLIENT_ID) {
      throw new Error(
        "NIBI-GO 尚未配置 OIDC client id：需在账号中心注册 native app（回调 nibigo://login）后设置 EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID",
      );
    }
    const verifierBytes = new Uint8Array(VERIFIER_BYTES);
    Crypto.getRandomValues(verifierBytes);
    const verifier = bytesToBase64Url(verifierBytes);
    const challenge = bytesToBase64Url(
      hexToBytes(
        await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
          encoding: Crypto.CryptoEncoding.HEX,
        }),
      ),
    );
    const state = bytesToBase64Url(Crypto.getRandomValues(new Uint8Array(16)));
    const redirectUri = Linking.createURL("/login");

    const query = new URLSearchParams({
      client_id: OIDC_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: OAUTH_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (forceLogin) query.set("prompt", "login");

    const result = await WebBrowser.openAuthSessionAsync(
      `${AUTHORIZE_URL}?${query.toString()}`,
      redirectUri,
    );
    if (result.type !== "success" || !result.url) {
      throw new WebRemoteControlV2ConnectionError("auth-required");
    }
    const callback = new URL(result.url);
    const returnedState = callback.searchParams.get("state");
    if (returnedState !== state) throw new Error("OAuth 回调 state 不匹配");
    const error = callback.searchParams.get("error");
    if (error) throw new Error(`登录失败: ${error}`);
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("OAuth 回调缺少 code");

    const tokens = await this.exchange({
      code,
      redirectUri,
      codeVerifier: verifier,
    });
    return tokens;
  }

  /** 退出登录：清内存缓存与 SecureStore（配对凭据保留——设备归属机器而非账号）。 */
  async logout(): Promise<void> {
    this.cached = undefined;
    await tokenStore.clear();
  }

  private async exchange(params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<StoredTokenSet> {
    const response = await fetch(TOKEN_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
      }),
    });
    return this.parseEnvelope(response, "登录交换失败");
  }

  /** refresh_token 换新令牌（同一代理；refresh token 可能轮换，成功后覆盖存储）。 */
  private async refresh(refreshToken: string): Promise<string> {
    try {
      const response = await fetch(TOKEN_EXCHANGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
      const tokens = await this.parseEnvelope(response, "令牌续期失败");
      this.cached = tokens;
      return tokens.accessToken;
    } catch (error) {
      // 续期失败（refresh 失效/撤销）：清凭据，回到登录门禁，不无限重试
      this.cached = undefined;
      await tokenStore.clear();
      throw new WebRemoteControlV2ConnectionError("auth-required");
    }
  }

  private async parseEnvelope(response: Response, fallback: string): Promise<StoredTokenSet> {
    if (!response.ok) throw new Error(`${fallback}（HTTP ${response.status}）`);
    const payload = (await response.json()) as ExchangeEnvelope;
    const accessToken = payload.data?.access_token?.trim();
    if (payload.code !== 0 || !accessToken) {
      throw new Error(payload.msg?.trim() || fallback);
    }
    const expiresIn = payload.data?.expires_in;
    const expiresAt =
      typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
        ? this.now() + expiresIn * 1000
        : undefined;
    const refreshToken = payload.data?.refresh_token?.trim() || undefined;
    const displayName =
      payload.data?.user?.displayName?.trim() ||
      payload.data?.user?.preferredLoginName?.trim() ||
      undefined;
    const tokens: StoredTokenSet = {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(displayName ? { displayName } : {}),
    };
    this.cached = tokens;
    await tokenStore.save(tokens);
    return tokens;
  }
}
