# T4 · Host 审批 capability 开闸（interaction 事件到手机）

> **状态（2026-11-12）：结案——桌面侧无缺口，已在 GO 侧修复。** 结论见文末「归因修正」。
> 原始归属：nibi-client 桌面 Host；登记日期 2026-11-11。

## 背景

手机端审批卡依赖 V4 快照的 `pendingInteractions`（`permissionRequestPayloadSchema`：`{interactionId, kind:"permission", toolCallId, toolName, summary, detail, …}`）。当前桌面 Host 的审批 capability 未向手机侧开闸——快照里 `pendingInteractions` 恒为空，手机看不到审批卡，也无法作答。

## 需求（桌面侧）

1. Host 的 V4 conversation 投影把 `pendingInteractions`（permission 类）放进快照与 delta 更新。
2. 接受来自 terminal 的 `resolveInteraction` 命令（`{interactionId, answer:{action:"accept"|"decline"|"cancel"}}`），与桌面本地审批走同一 broker。
3. 安全边界：仅当手机与桌面处于同一配对会话时下发/接受（现有 connection scope 已覆盖，复核即可）。

## 验收

- 桌面发起一次需要审批的工具调用 → 手机 chat 屏出现审批卡（允许/拒绝 + 30s 超时提示）。
- 手机点"允许" → 桌面继续执行；点"拒绝" → 桌面收到拒绝；30s 无操作 → 桌面收到默认拒绝。
- 桌面本地同时打开同一审批时：桌面先答 → 手机卡静默消失（快照对齐路径已实现）。

## 关联

- GO 侧实现：`packages/chat-core/src/approvals.ts`（两条不变量）+ `app/src/relay/chat.ts`（接线）+ `packages/relay-client/src/bridge.ts`（resolveInteraction 命令）。
- 协议依据：`reference/nibi-client` 的 `nibi-protocol-v4/snapshot.ts`（pendingInteractionSchema）与 `command.ts`（resolveInteraction）。


---

## 归因修正（2026-11-12，上游逐帧核对）

票据的断言「桌面 Host 快照里 `pendingInteractions` 恒为空」**不成立**：

- Rust 内核（默认）：`kernel/crates/protocol-nibi/src/projection/mod.rs` 在 permission 询问时写
  `patch.pendingInteractions`，冷快照固定携带该字段；`commands.rs` 已处理 `resolveInteraction`。
- Node 回退：`bootstrap/src/nibi-protocol-v4/product-projection.ts` 的 `onPermissionRequested`
  产出同样的 `state.updated{pendingInteractions}`。
- CLI 打帧与 Host 扇出不过滤该字段；relay 数据面是不透明 payload。定向测试
  （`cargo test -p nibi-kernel-protocol-nibi projection::tests::`、
  `bootstrap tests/guarded-interaction-lifecycle.test.ts`、`zcodeAgentConnectionScope`）全绿。

真正的两个断点都在**客户端**，已在本仓修复（`850341a`）：

1. **没有 V4 握手**：桌面 connection scope 对 `terminal-client` 先 `assertReady()`，未完成
   `hello` → `clientHello` 时 `subscribeConversationV4` 直接
   `fault.connection.handshakeRequired`。GO 只把 phase 置 error，`store.snapshot` 永远为空，
   `snapshot?.pendingInteractions ?? []` 就表现为「恒为空」。
   修法：attachment 级握手（并发订阅共享一次、旧桌面降级 legacy、clientId 全生命周期稳定）。
2. **`resolveInteraction` 只发 `action`**：桌面权限按 `answer.optionId` 精确匹配快照
   `options[].optionId`，缺 optionId 一律 deny。修法：从快照按 `kind` 取
   `allowOnce`/`allowAlways`/`deny`；无 options 与 cancel 保留 action 兼容。

顺带修正：桌面服务经 `ProxyChannel` 暴露，RPC 实参必须是方法实参数组（裸对象会被解成
0 个实参），订阅/命令/unsubscribe 已改为 `[params]`。

**剩余**：真机验收（手机连桌面 → 审批卡出现 → 允许/拒绝 → 30s 超时默认拒绝）。
