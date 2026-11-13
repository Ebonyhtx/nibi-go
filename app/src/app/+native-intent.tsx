// OAuth 回调深链（nibigo://login?code=...&state=...）不是 App 内路由：它由 expo-web-browser
// 的 openAuthSessionAsync（relay/auth.ts）独立消费，回调到达后授权会话直接 resolve。
// 不拦截时 expo-router 会把 nibigo://login 当 /login 路由渲染 Unmatched Route 404 屏并压在栈顶
// （2026-11-13 模拟器预跑实证；登录本身不受影响，但真登录成功后用户面对 404 页）。
// 返回 null = 路由保持当前路径不动；其余 URL 原样放行（nibigo://scan 等注册路由照常工作）。
export function redirectSystemPath(event: { path: string; initial: boolean }): string | null {
  try {
    // 兼容三种形态：nibigo://login?…（标准）、nibigo:///login?…（无 host 变体）、
    // nibigo://login/…（带尾路径）——Linking 拼装器与外部工具都可能给出后两种。
    if (/^nibigo:\/\/\/?login([/?#]|$)/u.test(event.path)) return null;
    return event.path;
  } catch {
    // 文档要求：此函数抛错可能导致 App 崩溃，一律兜底为不导航
    return null;
  }
}
