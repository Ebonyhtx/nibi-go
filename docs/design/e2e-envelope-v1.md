# E2E 信封与握手 v1（规格）

> 依据：D9（E2E 藏握手）/ 决议 P3b（会话级 K + 重连重协商）/ P3c（JSON 文本帧）。
> 手机侧实现：`packages/relay-client/src/{crypto,handshake}.ts`（测试：`test/{crypto,handshake}.test.ts`）。
> **桌面侧按本规格镜像实现**（plan.md A3 触点 2/3 的 PR 依据）。

## 1. 载体：relay data payload（修正草案的 meta 方案）

草案原写"协商材料进 `auth_init.meta` 透传"，但：

1. 抽取契约里 `meta` 是 **strictObject**（仅 `name/platform/version`），额外字段会被 V2 严格校验拒绝；
2. relay 把 terminal 的 `meta` 存在连接上，**不会转发给 device**（auth_ack/pair_status_ack 都没有 meta 字段）——材料到不了桌面。

因此 v1 载体改为 **relay data payload**：relay 契约里 `data.payload` 是 `z.json()` 不透明透传，**服务端零改动**，语义上仍是"藏在对端数据面里的握手"，符合 D9 的"服务端零改动"目标。

## 2. 消息格式（JSON 文本帧，字段 base64）

> **nonce 长度以实现为准：24B。** 初稿此处写 32B 属笔误；`packages/relay-client/src/handshake.ts`
> 硬校验 24B，nibi-client 桌面侧已按 24B 镜像。下一端实现请勿按旧的 32B 文本实现，否则握手全部失败。

```jsonc
// terminal → desktop（配对成功后立即发送）
{ "nibi_type": "keyneg-init", "v": 1, "pub": "<X25519 公钥 32B>", "nonce": "<24B 随机>" }

// desktop → terminal
{ "nibi_type": "keyneg-response", "v": 1, "pub": "<X25519 公钥 32B>", "nonce": "<24B 随机>" }

// 握手完成后，业务 data payload 全部替换为密文信封
{ "nibi_type": "enc", "v": 1, "n": "<XChaCha20 nonce 24B>", "ct": "<密文+16B tag>" }
```

## 3. 密钥派生

```
shared   = X25519(ephemeral_priv, peer_ephemeral_pub)
salt     = clientNonce ‖ serverNonce          （48B = 24B + 24B）
info     = "nibi-e2e-v1|<context>"            （context = deviceSid，UTF-8）
K        = HKDF-SHA256(shared, salt, info, 32)
```

- 每次建连**新建临时密钥对**、新 nonce、新 K（会话级，P3b；device 级持久轮换等 C 立项）。
- `context` 用 deviceSid 做域分离；不是秘密（relay 也知道），作用是防跨设备串用。
- 双方用同一公式独立派生，无第三条信任根。

## 4. 状态机与降级

```
idle ──begin──> negotiating ──keyneg-response 合法──> secure
                    │
                    │ 3s 无响应 / 非法材料（旧桌面）
                    ▼
                plaintext（放行明文 + UI 明示"未加密连接"，D9 fail-safe）
```

- 握手完成前收到的 `enc` 载荷一律丢弃；`keyneg-response` 只被状态机消费（不进业务面）。
- 握手完成后 `keyneg-*` 消息仍按明文放行（不应再出现；出现也不影响）。
- 对端（旧桌面）不响应协商 → 3s 后降级明文，连接不断（用户已接受的默认）。
- 非法材料（公钥长度错误/非 base64/低阶点异常）→ 同降级路径，不静默断连。

## 5. 防重放

- 每次重连换新临时密钥 + 新 nonce → 新 K；旧密文在新连接上解不开（GCM 校验失败 → 丢弃）。
- 同一连接内重复 `keyneg-response`：状态机在 secure 后不再处理（忽略）。
- 密文信封的 nonce 为随机 24B（XChaCha20 空间足够，碰撞可忽略）；错钥/篡改 → 认证失败 → 丢弃（调用方断连重协商）。

## 6. 桌面侧镜像清单（触点 PR）

1. 收到 `keyneg-init`（data payload）→ 校验 v/pub/nonce 长度 → 生成临时 X25519 密钥对 → 回 `keyneg-response`。
2. 双方用 §3 公式派生 K；之后 desktop 发送的业务 payload 一律 `enc` 包装，收到 `enc` 一律解密后再进业务管线。
3. 旧手机（不发 keyneg-init）：desktop 按明文工作（PWA 永远明文；旧 GO 版本降级）。
4. `Cipher` 接口（D11）：Android/桌面可用 libsodium 替换 @noble 实现，**密文格式不变**；iOS 用 CryptoKit 桥。

## 7. 测试向量（格式漂移守卫）

```
key   = 0x42 × 32
nonce = 0x17 × 24
plain = {"nibi_type":"ping","v":1}
ct    = "rHtk/LRWx9bBzyM4Bk3sfmob1j8yDA4FxhIJY1gIk+T2WVzeHZ0WWtBj"   （base64，含 tag）
```

桌面实现必须解出同一 plain；`packages/relay-client/test/crypto.test.ts` 断言同一向量。
