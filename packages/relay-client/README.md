# Phase A：Relay V2 terminal 客户端（纯 TS）

> 层级：协议层。**禁止 import react-native / expo / react**（AGENTS.md 规则 4，`scripts/check-boundaries.mjs` 门禁）。

## 职责

NIBI-WORK 形态的连接地基。桌面 `webRemoteControlTransport.ts`（generation/重连退避/注册重试）的移植 + E2E 密文信封（D9）+ 配对双路径（D8：首次扫码/持久凭据重连）。

## 模块规划

| 模块 | 内容 | 上游参考（nibi-client dev @ ff1c5f4f） |
|---|---|---|
| `transport.ts` | WebSocket + 心跳（5s±1s/15s watchdog）+ 代次 + 重连 | `packages/desktop/src/main/web-remote-relay/webRemoteControlTransport.ts` |
| `crypto.ts` | XChaCha20-Poly1305 信封 + 密钥派生（Cipher 接口，D11） | 新实现；测试向量对齐桌面侧 |
| `pairing.ts` | 扫码解析（复用 shared QR 契约）+ 设备注册/token 消费 | `@nibi/shared` web-remote-relay contract |
| `gate.ts` | 连接门禁：WORK 落点判定（直连/E2E 中转/PWA 提示） | `packages/desktop/src/main/web-remote-relay/webRemoteControlV2Http.ts` |

## 测试

- 直接 import `@nibi/shared/testing/fake-relay-v2`（上游夹具）跑契约测试（Node 环境）。
- 密文信封：固定 key/nonce 的已知密文对（与桌面侧 `@nibi/shared` crypto 实现跑同一组断言）。

## 状态

骨架占位。首个实现提交前先定：relay-client 对 `@nibi/shared` 的引用方式（直接 workspace 链接 vs `packages/shared-extract/` 抽取）——见 AGENTS.md 规则 6。
