# T5 · E2E 插桩（桌面侧镜像 e2e-envelope-v1）

> **状态（2026-11-12）：已实现**（nibi-client `9d0fc7c0`），待真机联调。
> 归属：nibi-client 桌面 transport；登记日期 2026-11-11。

## 背景

D9：E2E 密钥藏在握手内，服务端零改动。手机端已在 relay data payload 层实现 `keyneg-init` / `keyneg-response` 握手与 `{nibi_type:"enc",v,n,ct}` 信封（XChaCha20-Poly1305）。桌面侧尚未实现——手机端 3s 无响应会走 D9 的 fail-safe 降级（明文 + UI 明示"未加密连接"）。

**重要修正**：草案原写"材料进 `auth_init.meta`"，实现时确认不可行（meta 是 strictObject 且 relay 不把 terminal meta 转给 device）。v1 规格已改为 **relay data payload 载体**（服务端零改动不变）。

## 需求（桌面侧，按规格镜像）

1. **握手**：收到 `{nibi_type:"keyneg-init",v:1,pub,nonce}`（data payload）→ 校验长度 → 生成临时 X25519 密钥对 → 回 `{nibi_type:"keyneg-response",v:1,pub,nonce}`。
2. **KDF**：`K = HKDF-SHA256(X25519(priv, peerPub), salt=clientNonce‖serverNonce, info="nibi-e2e-v1|<deviceSid>", 32B)`。
3. **信封**：握手完成后，桌面发出的业务 data payload 一律 `{nibi_type:"enc",v:1,n,ct}` 包装；收到的 `enc` 一律解密后再进业务管线。
4. **兼容**：旧手机（不发 keyneg-init）按明文工作；PWA 永远明文（不受影响）。
5. **实现可换**（D11）：可用 libsodium 替换参考实现，**密文格式不变**。

## 验收

- 手机与新版桌面配对 → 手机 work 屏显示"🔒 端到端加密"；抓包 relay 只看到 `enc` 信封与 `keyneg-*` 明文。
- 手机与旧桌面配对 → 3s 后降级，UI 显示"⚠️ 未加密连接"，业务可用（D9 回归）。
- 密文向量（规格 §7）桌面侧能解出同一明文。
- PWA 连接行为不变（回归）。

## 关联

- GO 侧实现：`packages/relay-client/src/{crypto,handshake}.ts` + `test/{crypto,handshake}.test.ts`（KAT 断言）。
- 规格：`docs/design/e2e-envelope-v1.md`。


---

## 实现记录（2026-11-12，nibi-client `9d0fc7c0`）

- 新模块 `packages/desktop/src/main/web-remote-relay/webRemoteControlE2E.ts`：桌面作为纯响应端，
  收 `keyneg-init` → 回 `keyneg-response` → 派生 K → 出向 `enc` 包装、入向解密后进业务管线。
- 接在 `webRemoteControlTransport` 的 `sendPayload` / `onPayload` 两个收口；`measurePayloadBytes`
  复用同一路径，分片计量与实发字节一致。
- 兼容：旧手机不发 init 则明文，PWA 永远明文；非法材料/握手前的 `enc` 丢弃该帧、不断连；
  K 在换 socket 与配对状态离开 `matched` 时重置。
- 规格 §7 密文向量双向验证通过；14 条定向用例（含真实 fake relay + WS 双向环路、重连换钥）。
- **规格修正**：keyneg nonce 以实现为准 **24B**（`relay-client/src/handshake.ts` 硬校验）；
  文档已从 32B 更正，salt 为 48B。桌面按 24B 镜像，未按旧文档实现。
- 依赖：复用 lockfile 已有的 `@noble/{ciphers,curves,hashes}`，未引入新包。
