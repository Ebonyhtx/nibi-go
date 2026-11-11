# T5 · E2E 插桩（桌面侧镜像 e2e-envelope-v1）

> 归属：nibi-client 主线（桌面 transport 两处插桩，~200 行 PR）。GO 侧手机端已实现（A3-1），规格见 `docs/design/e2e-envelope-v1.md`。
> 登记日期：2026-11-11。派发时机由 owner 定；GO 侧不自行实现（D17 单向消费）。

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
