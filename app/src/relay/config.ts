// 构建期/运行时端点配置（联调用 EXPO_PUBLIC_* 环境变量覆盖）。
// 常量真源在 @nibi-go/shared-extract（规则 6 抽取件），此处只做覆盖装配。
import {
  DEFAULT_NIBI_ENDPOINT_ORIGIN,
  DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL,
  NIBI_OIDC_SCOPE,
  WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
  resolveNibiAuthOrigin,
} from "@nibi-go/shared-extract";

/** 业务 API/中继/扫码落地同源的端点 origin。 */
export const ENDPOINT_ORIGIN =
  process.env.EXPO_PUBLIC_NIBI_ENDPOINT_ORIGIN?.trim() || DEFAULT_NIBI_ENDPOINT_ORIGIN;

/** relay ws2 入口（缺省按端点 origin 推导；显式覆盖用 EXPO_PUBLIC_NIBI_RELAY_WS_URL）。 */
export function relayWsUrlFor(endpointOrigin: string = ENDPOINT_ORIGIN): string {
  const explicit = process.env.EXPO_PUBLIC_NIBI_RELAY_WS_URL?.trim();
  if (explicit) return explicit;
  const origin = endpointOrigin.replace(/\/+$/u, "");
  if (origin === DEFAULT_NIBI_ENDPOINT_ORIGIN) return DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL;
  return `${origin.replace(/^http/u, "ws")}${WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH}`;
}

/** NIBI 账号中心（Zitadel）origin。 */
export const AUTH_ORIGIN = resolveNibiAuthOrigin({
  NIBI_AUTH_ORIGIN: process.env.EXPO_PUBLIC_NIBI_AUTH_ORIGIN,
});

export const AUTHORIZE_URL = `${AUTH_ORIGIN}/oauth/v2/authorize`;

/** 令牌交换代理（服务端换 Zitadel token 并取 userinfo，浏览器/App 不直连 IdP）。 */
export const TOKEN_EXCHANGE_URL = `${ENDPOINT_ORIGIN}/api/v1/oauth/nibi/token`;

/**
 * NIBI-GO 自身的 OIDC native app 客户端 id（回调 `nibigo://login`）。
 * Zitadel 对 redirect_uri 做**完全一致**匹配，不能复用桌面 nibi:// 的 client id——
 * 需在 NIBI 账号中心注册"NIBI-GO"native app 并登记 `nibigo://login` 后配置
 * （EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID）。未配置前登录动作会明确报错，不静默退化。
 */
export const OIDC_CLIENT_ID = process.env.EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID?.trim() ?? "";

export const OAUTH_SCOPE = NIBI_OIDC_SCOPE;
