# relay-client 接口草案 v0（已评审通过，实现中）

> 状态：**A1-1 已实现 transport + pairing**（packages/relay-client，Node 契约测试全绿）；crypto/handshake 按 plan.md 排 A3，gate.ts 后置 A2 前。App 配对 UI（A1 后半）待做。
> 依据：D8（持久配对）/ D9（E2E 藏握手）/ D10（四态选路）/ D17（内核单向消费）；Relay V2 契约（nibi-client `docs/web-remote-control/relay-v2-pairing.md`）。
> 实现要点对上游的落地差异见 `packages/relay-client/src/transport.ts` 文件头注释（terminal 无重注册/AUTH_FAILED=device-not-owned/移动退避参数）。

## 导出面

```ts
// packages/relay-client/src/index.ts
export { RelayTransport } from './transport';        // 状态机（§1）
export { PairingFlow } from './pairing';             // 配对双路径（§2）
export { CipherEnvelope } from './crypto';           // E2E 信封（§3）
export { KeyExchange } from './handshake';           // 密钥协商（§3.2）
export type { ConnState, RouteKind, PairCredential } from './types';
```

## 1. transport：状态机

状态（照桌面 device transport 移植，Node `ws` → RN WebSocket）：

```
idle ──start──> authenticating ──auth_ack(matched)──> paired
                    │                       │
                    │ HTTP401               │ DEVICE_OFFLINE（15s 宽限）
                    ▼                       ▼
              auth-required              waiting ──重连退避──> authenticating
```

- 心跳 5s ±1s jitter；ACK deadline 15s；KICKED 首次随机 2-5s 恢复，60s 内第二次终止 session-conflict。
- 手机侧退避：500ms × 2ⁿ 最大 10s；桌面侧 1s 起步最大 30s。
- 一次性 token：每次建连前申请，不落盘不进日志。
- **信封插桩点**：`send()` 序列化后 / 消息入口 `parse` 前——仅 `data` 类型过信封，握手类（auth_init/pair_status/ping）明文。

## 2. pairing：配对双路径（D8）

```
首次：登录 OAuth → 扫码（sid/mid，无任何秘密，D7）
      → auth_init.meta 带密钥协商材料 → 桌面回材料 → 双方派生会话密钥 K
      → device 身份（Keystore UUID）持久化
重连：持久凭据直接建连（K 从本地恢复或重协商），不再扫码
重配对：仅 链接过期 / 凭据到期 / 设备被删
```

## 3. crypto：信封与协商

- **信封**：`data.payload` → `{ v:1, nonce:24B, ct:XChaCha20-Poly1305(K, nonce, plaintext) }`。错钥/篡改 → GCM 抛错 → 断连重协商。
- **协商**：进 `auth_init.meta`（relay 契约的自由字段，透传）。双方基于账号身份（JWT 绑定的 userId）+ 随机数做 DH/PSK 派生；**防重放**：nonce 记入会话代次，重连换新 K（持久配对存 device 级 K，轮换策略 C 立项前定）。
- **Cipher 接口**（D11）：`{ encrypt(plain, key, nonce), decrypt(ct, key, nonce) }`——Android=libsodium，iOS=CryptoKit 桥，密文格式一致。
- **降级**：对端不支持协商（旧桌面）→ 放行连接 + UI 显示"未加密连接"（fail-safe，用户已接受的默认）。

## 4. 测试计划

1. `@nibi/shared/testing/fake-relay-v2` 跑：注册/配对/心跳/替换顶踢/全部错误码。
2. 信封向量：固定 key/nonce 已知密文（与桌面实现同一组断言）。
3. 协商防重放：同 nonce 二次握手必须失败。
4. 降级：假 relay 模拟"对端无协商能力" → 状态机落明文 + 上报未加密。

## 5. 原待定项（均已决议，2026-11-11 P1–P5）

- [x] `@nibi/shared` 引用方式：**选 B**——只走 `packages/shared-extract/` 抽取件（AGENTS 规则 6），首次抽取已完成（来源 ff1c5f4f，登记见该包 README）
- [x] device 级 K 持久轮换：**会话级 K + 重连重协商**（P3b），device 级轮换等 C 立项
- [x] RN WebSocket `binaryType`：**JSON 文本帧**（P3c，维持 relay"只接受 JSON 文本"契约）；B 阶段屏幕流如需二进制届时提扩展
