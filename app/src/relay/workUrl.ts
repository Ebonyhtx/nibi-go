// WORK 形态的加载地址（D4 修订：WebView 承载同源 web UI）。
//
// 路由真源：nibi-client packages/web 的 PWA 路由 `{endpointOrigin}/remote/v4`
//   —— 依据 shared-extract/nibi-auth.ts 的注释："回调必须与页面同源：
//   `{endpointOrigin}/remote/v4`"，即远控页与 OAuth 回调同源。
//
// 本模块**不 import 应用配置**（config.ts 会拉进 expo-constants / react-native，
// 使 Node 侧测试无法加载）：端点 origin 由调用方传入，纯函数便于单测。
// 构建期覆盖：EXPO_PUBLIC_NIBI_WORK_URL（联调本地 vite / 自建部署 / 指向别的环境）。

/** Web 远控页在站点上的路径。 */
export const WORK_WEB_PATH = "/remote/v4";

/** WORK 载体的加载地址；显式覆盖优先，否则 `{endpointOrigin}/remote/v4`。 */
export function resolveWorkUrl(endpointOrigin: string): string {
  const explicit = process.env.EXPO_PUBLIC_NIBI_WORK_URL?.trim();
  if (explicit) return explicit;
  return `${endpointOrigin.replace(/\/+$/u, "")}${WORK_WEB_PATH}`;
}

/** 该 URL 是否与给定 API origin 同源（决定 WebView 内跳转策略 / cookie 共享范围）。 */
export function isNibiOrigin(url: string, endpointOrigin: string): boolean {
  try {
    return new URL(url).origin === new URL(endpointOrigin).origin;
  } catch {
    return false;
  }
}
