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
  与 Android keystore 同一纪律——不进仓库、不进对话、不写日志；备份放私有运维仓
  `Ebonyhtx/nibi-go-ops`。
- 公钥：raw 32 字节 hex，登记在 `packages/market-index/src/keys.ts`，随客户端发布。
- 当前 keyId：`nibi-go-market-2026-11`，fingerprint `09d17d31cb00b43c`。
- 轮换：生成新 key → 追加到公钥表 → 用新 key 签名 → 至少保留旧 key 一个发布周期。

## 6. 发布流程（人工，尚未接 CI）

```bash
# 1) 生成索引 index.json（发布链脚本/手工维护，revision 必须比线上 +1）
# 2) 签名
node scripts/market/sign-index.mjs path/to/index.json
# 3) 上传 index.json + index.json.sig 到内容主机（https）
```

客户端刷新顺序：取 `index.json` 与 `.sig` → 验签 → schema → 与本地快照比较
（`evaluateMarketRefresh` + `checkPluginPins`）→ 通过后原子替换快照。

## 7. 已验证

- 单测 23 项：正确签名、篡改、坏签名格式、无公钥、坏 JSON、坏 schema（带路径）、
  http 地址、重复 id、包摘要校验、回滚/同 revision 冲突/市场不一致、插件版本不变量、
  `node:crypto` 签名与客户端验签互通、本机生产私钥签出的索引能通过内置公钥。
- CLI 冒烟：`sign-index.mjs` 签出的 `index.json.sig` 用内置公钥验签为 `true`，改一个字节后为 `false`。

## 8. 下一步

1. 市场 UI（浏览/详情/安装/更新）与安装器：下载 → `verifyPackageDigest` → 解包到
   `filesDir/plugins/<dir>` → 走既有 manifest 解析与启停状态；
2. 快照持久化（`filesDir/nibi-market.json`）与刷新失败时的降级提示；
3. 付费门禁（`paid.priceId` → license 校验；本阶段只占位）。
