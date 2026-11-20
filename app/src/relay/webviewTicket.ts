// NIBI-WORK 的登录页门禁 ticket。
//
// 服务端门禁：login-ui 只接受「带 10 分钟 ticket」的登录页请求（或由它换发的 2 小时
// Cookie）；普通浏览器直接打开会被 403。桌面客户端由 Electron 在请求头注入 ticket；
// NIBI-GO 的 WebView 无法给顶层导航加请求头，所以在**同源页面里**用 document.cookie
// 写入 `nibi_client_gate=<ticket>`（Domain=nibistudio.cn），登录导航时由浏览器带上。
//
// ticket 由 api 发：POST /api/v1/auth/webview-ticket，要求 X-Nibi-Client: 1（桌面同一口径）。
import { ENDPOINT_ORIGIN } from "./config";

/** v1.<exp>.<nonce>.<sig>，全部 base64url/数字。 */
const TICKET_RE = /^v1\.\d{1,12}\.[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{16,86}$/u;
const TIMEOUT_MS = 8_000;

export async function fetchWebviewTicket(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT_ORIGIN}/api/v1/auth/webview-ticket`, {
      method: "POST",
      headers: { "x-nibi-client": "1", "content-type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ticket?: unknown };
    const ticket = typeof body.ticket === "string" ? body.ticket.trim() : "";
    return TICKET_RE.test(ticket) ? ticket : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 在页面里写入门禁 Cookie 的脚本。WebView 的当前页面在 api.nibistudio.cn（或
 * auth.nibistudio.cn）上，两者都能给父域 nibistudio.cn 写 Cookie。
 * 10 分钟有效；login-ui 收到后立刻换发 2 小时 HttpOnly Cookie。
 */
export function gateBootstrapScript(ticket: string): string {
  if (!TICKET_RE.test(ticket)) return "true;";
  return `
(() => {
  try {
    document.cookie =
      'nibi_client_gate=' + ${JSON.stringify(ticket)} +
      '; Domain=nibistudio.cn; Path=/ui/v2/login; Secure; SameSite=Lax; Max-Age=600';
  } catch {}
})();
true;
`;
}
