// OAuth 回调地址的唯一构造函数。
//
// 根因：不能直接用 `Linking.createURL("/login")`。在无 dev server 的独立构建里
// host 为空，expo-linking 会补一个前导斜杠再拼 `${scheme}:/${hostUri}${path}`，
// 得到 `nibigo:///login`（三个斜杠）。Zitadel 的 redirect_uri 是完全一致匹配，
// 登记值是 `nibigo://login`，差一个斜杠就报 invalid_request。
// 这里按 `<scheme>://login` 显式构造，和账号中心登记值保持同一形状。
export function buildRedirectUri(scheme: string | readonly string[] | undefined): string {
  const value = Array.isArray(scheme) ? scheme[0] : scheme;
  const resolved = typeof value === "string" ? value.trim() : "";
  return `${resolved || "nibigo"}://login`;
}
