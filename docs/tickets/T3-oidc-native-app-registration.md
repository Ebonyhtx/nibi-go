# T3 · NIBI 账号中心注册 NIBI-GO OIDC native app

> **状态（2026-11-12）：已注册并接入，剩真机走完整登录。** 归属：NIBI 账号中心（Zitadel 管理面）+ 令牌代理（NIBI-Site）。
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


---

## 完成记录（2026-11-12）

**Zitadel app**

| 项 | 值 |
|---|---|
| 名称 | NIBI-GO |
| client id | `399176882886606853` |
| appId | `399176882886541317` |
| 类型 | `OIDC_APP_TYPE_NATIVE` |
| 鉴权 | `OIDC_AUTH_METHOD_TYPE_NONE`（无 secret，PKCE 唯一持有证明） |
| Token | `OIDC_TOKEN_TYPE_JWT` |
| Redirect URI | `nibigo://login`（精确匹配） |
| Grant | authorization_code + refresh_token |

**令牌代理（NIBI-Site `77f7b40`）**：原先两处写死 `nibiWebClientId`。现在按 redirect_uri 反查
public client（白名单：web 的 `/remote/v4` 与本地回环、GO 的 `nibigo://login`）；续期按
「显式 client_id → 上次成功归属缓存 → 白名单逐个候选」三级解析。无 secret，不开放任意 client。

**GO 侧（本仓）**：
- `packages/shared-extract` 新增 `NIBI_GO_OIDC_CLIENT_ID = 399176882886606853`（公开标识），
  `app/src/relay/config.ts` 以它为默认值，`EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID` 仍可覆盖。
- 换码与续期请求体都补上 `client_id`：续期不再需要代理先撞 web client 再回退，少一次 IdP 往返。
- 端点常量从 `nibistudio.top` 切到 `nibistudio.cn`（auth / api / relay ws），与客户端 2026-11-12
  的域名迁移对齐；SECURITY/CODE_OF_CONDUCT 的联系邮箱同步。

**验收**：授权端点对 `nibigo://login` 返回 302、错误 redirect 返回 400（owner 实测）；代理换码/续期
在路由层通过（Zitadel 报 `Errors.User.Code.Invalid` / `RefreshToken.Invalid`，说明 client 与
redirect 均已通过，只是假 code）。**剩真机**：dev build/独立包里走完 `nibigo://login` → 换 token →
refresh 续期一次（Expo Go 的回调是 `exp://`，不适用）。

**运维注意**：代理的 GO client 只在 `NIBI_GO_CLIENT_ID` 环境变量存在时进入白名单（默认空）；
新机器部署必须显式设置，否则 GO 换码会得到 400 `parameter error`。


### 模拟器验收发现并修复（2026-11-12）

在 x86_64 模拟器上跑 debug 包，**实际发出的 redirect_uri 是 `nibigo:///login`（三个斜杠）**，
Zitadel 报 `invalid_request: The requested redirect_uri is missing in the client configuration`。
根因：`Linking.createURL("/login")` 在无 dev server 的独立构建里 host 为空，expo-linking
会补前导斜杠再拼 `${scheme}:/${hostUri}${path}`，得到三斜杠；Zitadel 完全一致匹配，差一个
斜杠就拒。

修法：新增 `app/src/relay/redirectUri.ts::buildRedirectUri`，按 `<scheme>://login` 显式构造
（scheme 取自 `Constants.expoConfig.scheme`，缺失回落 `nibigo`）；`config.ts` 导出
`REDIRECT_URI`，`auth.ts` 不再用 `createURL`。带单测（含「不能出现三斜杠」断言）。

模拟器同时确认：授权 host 是 `auth.nibistudio.cn`、client_id/scope/PKCE 参数正确、
`nibigo` intent-filter 已进 APK、深链能把应用带回前台。**完整登录仍未验证**（无账号凭据）。

### Windows 构建路径约束（迁仓后新增）

仓库迁入 NIBI 工作区后（路径比旧位置多 5 个字符），Android debug 构建在 `react-native-gesture-handler` 的
codegen 对象路径上触发 MAX_PATH（264 字符 > 260）；旧位置恰好 259 压线。
短期绕行是把工作树复制到短路径构建（本次验收即如此做）；彻底解决需要更短的仓库路径
（更短的工作区目录名）或 `subst` 虚拟盘，待 owner 定。
