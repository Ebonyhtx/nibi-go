# 插件市场签名索引与防回滚（现行口径）

> 状态：2026-11-23 现行（**混合标准市场 + 两阶段 CI 自动签发**）。契约代码在 `packages/market-index`，
> 端侧消费在 `app/src/plugins/{marketSource,marketStore,installer,license,licenseSync}.ts`。

## 0. 一句话

官方市场索引 `index.json` 由 Ed25519 私钥对**原始字节**签名，客户端用内置公钥验签；
签名只保完整性，**防回滚靠单调递增的 `revision`**；目录与包体分离——ZIP 包安装前校验
`sha256`，纯 JS npm MCP 包校验精确 `name@version` 与 SRI `integrity`。

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
      "id": "npm.modelcontextprotocol.server-memory",
      "name": "知识图谱记忆（Memory）",
      "version": "2.2.1",
      "kind": "mcp",
      "caps": ["mcp.v1", "slots.v1"],
      "runtime": "node",
      "package": {
        "format": "npm",
        "name": "@modelcontextprotocol/server-memory",
        "version": "2.2.1",
        "integrity": "sha512-...",
        "bin": "mcp-server-memory",
        "serverName": "memory_graph"
      },
      "publisher": "Model Context Protocol",
      "publisherGithub": "modelcontextprotocol",
      "license": "MIT"
    }
  ]
}
```

约束（`packages/market-index/src/types.ts` 的 zod schema 机器化）：

- `schemaVersion` 必须为 `1`；`market` 必须为 `nibi-official`；
- `revision` 是 1..MAX_SAFE_INTEGER 的整数，发布链每次发布 +1；
- 插件 `id` 小写、`^[a-z0-9][a-z0-9._-]{0,63}$`，同一份索引内不得重复；
- `package` 为判别联合：
  - `format: "zip"`：`url` 只接受 **https**；`sha256` 必须 64 位小写 hex；`size` ≤ 64 MiB；
  - `format: "npm"`：精确 `version`（禁范围与 `latest`）、合法 npm 包名与 SRI `integrity`（`sha256/384/512-...`）；可选 `bin`/`args`/`env`/`serverName`；
- `paid` 供账号付费授权门禁使用（公开 PR 提交禁止声明 `paid`）。

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

## 6. 发布、自动签发与多源分发

索引与审核记录放在公开独立市场仓 **`Ebonyhtx/nibi-go-market`**：

- `index.json` / `index.json.sig`：官方签名索引与 Ed25519 detached 侧车；
- `submissions/<id>-<version>.json`：PR 提交元数据（支持 `format: "npm"` 纯 JS MCP、外部 HTTPS Release ZIP 或兼容仓内 `packages/*.zip`）；
- `yanked.json`：公开追加式撤回账本。

### 6.1 两阶段自动化流水线（市场仓 CI）

1. **PR 审查门禁（`validate-market`，只读、不接触签名私钥）**：
   - `check-leaks.mjs`：文件白名单、凭据/本机路径/图片 EXIF 与 Action SHA 校验；
   - `scan-package.test.mjs`：扫描规则引擎自检；
   - `check-submissions.mjs` + `scan-package.mjs`：字段与命名一致性、`publisher.github === PR_AUTHOR` 且 `source` 仓库属同一账号、同 `id` 归属不可更换；并实时拉取 npm `.tgz`（校验 `dist.integrity`、禁原生 `.node`/ELF 与 `preinstall`/`install`/`postinstall`）或远端 HTTPS ZIP（校验 `size`/`sha256`、路径安全）做静态扫描（`high` 直接阻断，`review` 打印供人工复核）；
   - `check-yanks.mjs` + `validate.mjs --before`：撤回账本、签名、schema 与历史不变量检查。
2. **合并后自动签发（`auto-sign-market`，受保护 Environment）**：
   - 维护者人工复核 `review` 项并合入 PR 到 `main` 后，命中 `submissions/*.json` 的变更自动触发串行签发队列；
   - `auto-publish.mjs` 扫描 `submissions/*.json` 按版本前进合并进 `index.json`（整批 `revision +1`），读取 Environment Secret 签发 `index.json.sig` 并当场用内置公钥回读自检，随后 `validate.mjs --before HEAD` 复核并由 `nibi-market-bot` 推回 `main`。

```bash
# 维护者本机备用（无 CI 时手工合并签名或应急下架）：
pnpm market:publish ../nibi-go-market ../nibi-go-market/submissions/<id>-<version>.json [--dry-run]
pnpm market:yank ../nibi-go-market <插件 id> --reason "撤回原因" [--version <版本>] [--dry-run]
```

### 6.2 客户端多源分发与防回滚仲裁

客户端（`app/src/plugins/marketSource.ts`）直接面向公共镜像源，顶部支持一键切换「国内源 / 国外源」：

- **国内源（默认）**：索引依次尝试 `cdn.jsdelivr.net` → `fastly.jsdelivr.net` → `raw.githubusercontent.com`；npm 包优先 `registry.npmmirror.com`、回退 `registry.npmjs.org`；
- **国外源**：索引依次尝试 `raw.githubusercontent.com` → `cdn.jsdelivr.net`；npm 包优先 `registry.npmjs.org`、回退 `registry.npmmirror.com`。

刷新判决（`refreshMarketIndexFromSources`）：对所有候选源拉取带 cache-bust 的 `index.json` 与 `.sig` → 逐源验签与 schema 校验 → **取 `revision` 最大的一份**（同 `revision` 不同字节直接报 `revision-conflict`）→ 与本地快照做防回滚和 `checkPluginPins` 校验 → 通过后原子替换 `filesDir/nibi-market.json`。因此某个 CDN 节点缓存短暂滞后不会把客户端降级。

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
- 授权同步与宽限：支持 `checkIntervalHours`（默认 72h）与 `offlineGraceDays`（默认 7 天）宽限策略及账号 `sub` 绑定（换号先清空旧缓存）。

## 9. 生态角色与边界口径

两个公开仓的分工（对外只讲一条线）：

- **NIBI-GO（客户端仓）**：移动客户端源码；插件市场只是客户端里的一个入口。
- **nibi-go-market（市场仓）**：官方插件索引、提交与撤回审查记录的权威来源；公共 CDN（jsDelivr / Fastly）是它的自动分发副本，不是第二份事实来源。

安全边界：

- 自动化静态扫描（`scan-package.mjs`）是启发式护栏，不是杀毒引擎；当前移动端插件运行在隔离插件目录的内置 Node MCP 子进程或声明式技能层，尚无 OS 级运行时沙箱与动态恶意行为监控，因此维持「CI 自动初审 + 维护者人工复核合入 + Actions 自动签名签发」模式。

面向用户的统一口径：

> NIBI-GO 的插件市场只提供官方签名索引与经审查的条目；插件是会在本机运行的代码，
> 审查降低风险但不等于安全保证，只安装你信任的条目。
