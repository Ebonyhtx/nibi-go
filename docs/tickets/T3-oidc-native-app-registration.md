# T3 · NIBI 账号中心注册 NIBI-GO OIDC native app

> **归属：NIBI 账号中心（Zitadel 管理面）——非 nibi-client 内核票据**，不走 HANDOFF.md 的内核票据流程；由 owner 在账号中心直接操作或派发给 nibi-server 侧。
> 登记日期：2026-11-11（A1-2 收尾时确认的外部依赖）。

## 背景

NIBI-GO RN App 的登录采用 NIBI 账号中心的授权码 + PKCE 流（同桌面）。Zitadel 对 `redirect_uri` 做**完全一致匹配**——桌面 native app（`nibi://` 回调，client id `393742196089552900`）的登记值不适用于 App 的自定义 scheme，不能复用；RN App 需要自己的 native app 条目。

现状：`app/src/relay/auth.ts` 已按此契约实现（系统浏览器 PKCE、交换/续期走 `/api/v1/oauth/nibi/token` 代理）；`EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID` 未配置时登录动作**明确报错，不静默退化**。

## 需求（一次性配置）

1. 在 Zitadel 注册 native app：名称建议 **NIBI-GO**（与桌面/CLI/TUI/Web 四条目并列，命名延续 nibiAuth.ts 的公开常量惯例）。
2. 登记回调 `redirect_uri`：`nibigo://login`（App 的 scheme 已在 `app/app.json` 定为 `nibigo`；expo-linking 的 `createURL("/login")` 产出该地址）。
3. 授权类型：authorization code + PKCE（S256）；scope 与现有 `NIBI_OIDC_SCOPE` 一致（offline_access + project aud），native app 不需要 client secret。
4. 将新 client id 回填给 GO 侧：`EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID=<id>`（构建期环境变量；开发期写 `app/.env.local`——已被 gitignore，凭据纪律不受影响）。

## 消费方与验收

- 消费方：NIBI-GO App 登录（`app/src/relay/auth.ts`）。
- 验收：真机/模拟器上点击"登录 NIBI 账号"→ 系统浏览器完成登录 → 回跳 `nibigo://login` → 交换成功 → work 屏显示账号名 → 设备列表拉到当前账号设备。
- 顺带验收项：refresh_token 续期（access token 到期前 5 分钟自动续，无需重登）。

## 优先级

A1 真机联调（配对全流程）的前置；不阻塞 A2 协议层工作。
