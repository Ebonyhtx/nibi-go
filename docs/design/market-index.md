# 插件市场签名索引与防回滚（C2 第一步）

> 状态：2026-11-20 实现。对应 `plan.md` 里程碑 C2 的第一块（签名索引 + 验签/防回滚），
> 市场 UI、安装/更新、付费门禁在后续步骤接。契约代码在 `packages/market-index`。

## 0. 一句话

官方市场索引 `index.json` 由发布链用 Ed25519 对**原始字节**签名，客户端用内置公钥验签；
签名只保完整性，**防回滚靠单调递增的 `revision`**；包字节在安装前用清单里的 `sha256` 校验。

## 1. 为什么是 detached 签名

- 签名对象是文件字节，不做 canonical JSON：客户端先验字节、再 `JSON.parse`，不存在
  “签名时和解析时 JSON 序列化不一致”的整类问题。
- 侧车文件 `index.json.sig` 是 128 位 hex（64 字节 Ed25519 签名）。
- 与桌面端同一思路（桌面是 `.sig` 侧车 + 内置 SPKI 公钥），但 GO 的索引格式、包格式与
  公钥表独立（D13：GO 插件生态与桌面隔离）。

## 2. 索引格式

```json
{
  "schemaVersion": 1,
  "market": "nibi-official",
  "revision": 7,
  "generatedAt": "2026-11-20T00:00:00.000Z",
  "plugins": [
    {
      "id": "nibi.weather",
      "name": "天气",
      "version": "1.0.0",
      "description": "…",
      "minApp": "0.1.1",
      "caps": ["mcp.v1"],
      "runtime": "node",
      "package": {
        "url": "https://…/weather-1.0.0.zip",
        "sha256": "<64 hex>",
        "size": 1024,
        "format": "zip"
      },
      "publisher": "NIBI Studio",
      "license": "Apache-2.0",
      "paid": { "priceId": "…" }
    }
  ]
}
```

约束（`packages/market-index/src/types.ts` 的 zod schema 机器化）：

- `schemaVersion` 必须为 `1`；`market` 必须为 `nibi-official`；
- `revision` 是 1..MAX_SAFE_INTEGER 的整数，发布链每次发布 +1；
- 插件 `id` 小写、`^[a-z0-9][a-z0-9._-]{0,63}$`，同一份索引内不得重复；
- `package.url` 只接受 **https**；`sha256` 必须 64 位小写 hex；`size` ≤ 64 MiB；
- `paid` 本阶段只透传，不做门禁。

## 3. 验签

`verifyMarketIndexBytes(bytes, signatureHex, { keys? })`：

1. 签名必须是 128 位 hex；
2. 用内置公钥表逐个尝试（签名里不带 keyId，轮换时新旧 key 并存即可平滑过渡）；
3. 验签通过后再 `JSON.parse` + schema 校验 + 重复 id 检查；
4. 任一步失败都返回 `{ ok: false, error }`，调用方**保留上一份成功快照**，不引入半可信清单。

错误码：`bad-signature` / `unknown-key` / `bad-json` / `bad-schema` / `duplicate-plugin`。

## 4. 防回滚

签名不能证明“最新”（旧清单的签名同样有效），因此客户端持久化上次接受的快照：

```ts
{ market: "nibi-official", revision: 7, indexSha256: "<hex>" }
```

`evaluateMarketRefresh(previous, next)`：

| 情况 | 判决 |
|---|---|
| 首次（无快照） | `accept` |
| `market` 不一致 | `reject: market-mismatch` |
| `revision` 倒退 | `reject: rollback` |
| `revision` 相同且字节摘要相同 | `unchanged` |
| `revision` 相同但字节不同 | `reject: revision-conflict` |
| `revision` 前进 | `accept` |

插件级不变量（`checkPluginPins`）：

- 同一个 `id` 的版本只能前进（数字段比较，忽略 `-`/`+` 后缀）；
- 同一 `(id, version)` 的包 `sha256` 不可变——重新打包必须发新版本。

## 5. 密钥纪律

- 私钥：`~/.nibi/market/<keyId>.json`（0600），由 `scripts/market/gen-key.mjs` 生成；
  与 Android keystore 同一纪律——不进仓库、不进对话、不写日志。
- **备份**：`scripts/market/key-backup.mjs encrypt` 生成 AES-256-GCM（scrypt 派生）密文，
  存放于运营者的私有保管位置；**本仓不记录保管位置与文件名**。已用 `decrypt` 回读并比对
  sha256 一致。恢复：`key-backup.mjs decrypt <enc> --out <key.json>`。
- 公钥：raw 32 字节 hex，登记在 `packages/market-index/src/keys.ts`，随客户端发布。
- 当前 keyId：`nibi-go-market-2026-11`，fingerprint `09d17d31cb00b43c`。
- 轮换：生成新 key → 追加到公钥表 → 用新 key 签名 → 至少保留旧 key 一个发布周期。
- 索引与包内容放在公开市场仓 `Ebonyhtx/nibi-go-market`（见 §6）。

## 6. 发布流程（人工，尚未接 CI）

索引与包内容放在独立市场仓 **`Ebonyhtx/nibi-go-market`**（公开仓，作为发布来源）：

- `index.json` / `index.json.sig`
- `packages/<id>-<version>.zip`（包字节）
- 客户端按顺序尝试两个源（同一把 key 签名，只认签名不认域名）：
  1. `https://dl.nibistudio.cn/nibi-go-market/index.json`（ESA → 私有 OSS，国内可达）
  2. `https://raw.githubusercontent.com/Ebonyhtx/nibi-go-market/main/index.json`（发布来源）

```bash
# 1) 修改 nibi-go-market/index.json，revision 必须比线上 +1
# 2) 审核通过的提交直接合并进索引并签名（校验包摘要 → revision+1 → 签名 → 回读验签）
pnpm market:publish ../nibi-go-market ../nibi-go-market/submissions/<id>-<version>.json
#    也可以手工改 index.json 后单独签名：
#    node scripts/market/sign-index.mjs ../nibi-go-market/index.json
# 2b) 撤回（下架）：从索引移除条目并追加公开记录 yanked.json
pnpm market:yank ../nibi-go-market <插件 id> --reason "撤回原因"
#    可选 --version <版本>（与索引不一致会拒绝）、--dry-run、--key <keyId>
# 3) 把 index.json 与 index.json.sig 一起提交（包 zip 放 packages/）并 push
# 4) 镜像到 CDN：主线是服务器上的定时任务（每 10 分钟拉取市场仓 main → 验签/校验 →
#    只上传变化文件；失败保留上一份成功状态）。下面是手工补跑用的脚本（不写死主机/桶/密钥）：
MSYS2_ENV_CONV_EXCL='*' MSYS2_ARG_CONV_EXCL='*' NIBI_MARKET_SSH=<ssh-alias> NIBI_MARKET_REMOTE_DIR=<远端临时目录> NIBI_MARKET_OSS_PREFIX=<oss://bucket/prefix> NIBI_MARKET_OSS_CONF=<ossutil 配置路径> NIBI_MARKET_SUDO=1 node scripts/market/mirror-cdn.mjs ../nibi-go-market
# 脚本会先本地验签 + 校验包 sha256，再 ssh cat 到远端并 ossutil cp 到 CDN。
```

客户端刷新顺序：对每个源取 `index.json` 与 `.sig` → 验签 → schema → **取 revision 最大的
一份**（同 revision 不同字节视为冲突）→ 与本地快照比较（`evaluateMarketRefresh` +
`checkPluginPins`）→ 通过后原子替换 `filesDir/nibi-market.json`。镜像落后于市场仓是安全的：
旧 revision 永远不会覆盖新 revision，新装设备也会选到最新的一份。

## 7. 已验证

- 单测 55 项（`packages/market-index`）：正确签名、篡改、坏签名格式、无公钥、坏 JSON、
  坏 schema（带路径）、http 地址、重复 id、包摘要校验、回滚/同 revision 冲突/市场不一致、
  插件版本不变量、刷新判决（accept/unchanged/fetch/verify/rollback/pins）、
  `node:crypto` 签名与客户端验签互通、本机生产私钥签出的索引能通过内置公钥；
  提交合并（版本前进/同版本摘要不可变/包地址约定）与撤回记录（移除/版本不一致拒绝/
  重复撤回/revision 递增/更高版本回归）。
- license 单测 12 项（`packages/plugin-license`）：JWS 验签、payload 篡改、未知 kid、
  错误 iss、claims 形状、覆盖范围/通配、过期、设备不匹配、无凭证、坏凭证。
- CLI 冒烟：`sign-index.mjs` 签出的 `index.json.sig` 用内置公钥验签为 `true`，改一个字节后为 `false`。
- **CDN 自动镜像（2026-11-20 部署）**：服务器定时任务每 10 分钟拉取市场仓 main，
  `openssl pkeyutl` 验签 + 包 sha256/大小 + revision/版本不变量，只上传变化的文件；
  先包后索引，状态文件原子更新。实测：首次全量上传、第二次「已是最新」、cron 连续两分钟
  成功执行；把状态 revision 人为调高后运行被「revision 倒退」拒绝（未覆盖索引）。
- **撤回工具（2026-11-20 实跑）**：在临时市场仓副本执行 `pnpm market:yank`，revision 5 → 6，
  条目移除、签名回读验签通过、`yanked.json` 追加记录；市场仓 `check-yanks.mjs` 对
  「索引仍含被撤回版本」「重复撤回」「revision 不递增」三种夹具均报红，正常记录通过；
  对已移除的 id 再次撤回被拒绝。
- **真机（PHK110 / Android 16，2026-11-20，signed release 0.1.2 测试构建）**：
  - 市场页首次打开自动拉取 revision 2（GitHub raw），验签通过并显示条目；
  - 安装 `nibi.market.hello` 0.1.0：下载 → sha256 校验 → 解包 → 清单 id/version 校验 →
    落盘；插件中心出现「市场示例 / 可用」；
  - 真实模型回合调用 `mcp__market_hello__hello`，内核从插件目录启动 Node MCP 子进程，
    返回「你好，NIBI！这是来自市场插件 market_hello 的问候。」；
  - 发布 revision 3（0.1.1）后刷新显示「可更新」，点更新后徽标变为「已安装 v0.1.1」，
    再次调用工具返回 v0.1.1 文案（证明包与进程都换成了新版本）；
  - 付费门禁：临时发布 revision 4（`paid`）→ 市场页显示「付费/需会员」且安装按钮禁用、
    插件中心该插件变为「需会员」且开关关闭；新会话里模型确认 `mcp__market_hello__hello`
    不存在（工具面被裁剪）。恢复 revision 5（免费）后自动回到「可用」；
  - 网络：raw.githubusercontent.com 在手机侧出现「200 后 body 卡住/超时」；镜像到
    `dl.nibistudio.cn/nibi-go-market/` 后同一份字节 2.7s 拉通，客户端多源回退生效。

## 8. 付费门禁（C2-4，客户端侧）

- 凭证：与桌面端同一签发口径的 compact JWS（Ed25519）；claims 含 `iss=nibi-license`、
  `plugins[]`（`"*"` 全放）、`dev`（设备绑定）、`exp`。
- 判定：`@nibi-go/plugin-license` 离线验签 → exp → 设备 → 覆盖范围；任一不满足即拒绝
  （`not_activated`/`denied`/`expired`/`device_mismatch`/`not_covered`）。
- 凭证存储：`expo-secure-store`（Keystore 加密）；设备 id 首启随机生成后固定。
- 三道门：市场安装（按钮禁用 + installer 复核）、插件启用（`setPluginEnabled` 抛错）、
  工具面（`loadPlugins` 把未授权付费插件按停用处理，MCP 服务器不下发；内核配置同样写 disabled）。
- `paid` 判定取「市场快照 paid ∪ 安装记录 paid」（`nibi-market-installed.json`），
  防复制缓存绕过。
- 凭证同步（复用桌面同一条服务端链路）：`POST /api/v1/licenses/check`
  - 已登录：`Authorization: Bearer <NIBI access token>`（GO 的 OIDC 登录态，续期走 relay 的令牌刷新）；
  - 无登录态但有本机凭证：`X-Nibi-License` 日常检查；
  - 200 + `authorized` + `license.token` → 落 SecureStore 并清 refusal；
  - 401（Bearer）→ 提示登录，不写拒绝；403 / `authorized:false` → 写 `lastRefusal`（判定层立即 deny）；
  - 网络失败不动缓存。
  - 市场页「同步」按钮触发；未登录时明确提示去「连桌面」页登录。
- 本阶段仍不启动收费：没有购买入口/激活码 UI/宽限期；在线拒绝已生效。

## 9. 下一步

1. 凭证获取（账号侧签发/同步）与在线拒绝、宽限期（需要服务端配合）；
2. 下载进度百分比与失败重试（当前是可取消的不确定进度）；
3. ~~镜像监控~~ **已完成（2026-11-20）**：healthchecks「市场同步CHECK」由服务端 cron 每次
   同步上报；GitHub 网络类失败在单次运行内重试 3 次，仍失败只记本地 `fail-streak`，
   连续 3 次（约 30 分钟）才 `/fail`；验签/schema/上传等确定性错误立即 `/fail`。
   ping URL 只配置在服务端私有环境（不进仓库、不进对话）。

## 10. 生态角色与用户口径

两个公开仓的分工（对外只讲一条线）：

- **NIBI-GO（客户端仓）**：移动客户端源码；插件市场只是客户端里的一个入口。
- **nibi-go-market（市场仓）**：官方插件索引、插件包、提交与审查记录。客户端安装内容的
  权威来源；`dl.nibistudio.cn` 上的文件是它的自动镜像，不是第二份事实来源。
- **为什么需要独立市场仓**：签名索引需要可追溯的版本历史与公开的审查记录；CDN 只是分发
  副本，无法承载 PR 审查、否定记录与版本不变量校验。

提交与审查（细节以市场仓为准）：

- 插件作者向市场仓提 PR：`packages/<id>-<version>.zip` + `submissions/<id>-<version>.json`；
  **不修改** `index.json`（签名由维护者在本机完成）。
- CI 门禁：提交字段/包摘要/包内清单一致性/许可与联系信息/已知 caps/泄露白名单；
  索引本身的签名、schema、包摘要、revision 单调与同版本摘要不可变也每次校验；
  撤回记录 `yanked.json` 的形状、重复撤回、revision 递增与「索引里不得仍有被撤回版本」同样校验。
- 撤回是公开、追加式的：`yanked.json` 记录 id、版本、理由、时间与生效 revision；撤回后同一
  id 只能以更高版本回归。客户端市场页把本地已装但已从索引消失的插件单列为「已下架」，
  只提供卸载——已安装副本不会被远程删除。
- 人工审查清单见市场仓 `CONTRIBUTING.md`（许可、隐私、权限面、包内容、可维护性）；
  通过后维护者更新并签名索引，服务器定时任务再把变更镜像到 CDN。

面向用户的统一口径：

> NIBI-GO 的插件市场只提供官方签名索引与经审查的条目；插件是会在本机运行的代码，
> 审查降低风险但不等于安全保证，只安装你信任的条目。
