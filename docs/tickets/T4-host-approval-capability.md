# T4 · Host 审批 capability 开闸（interaction 事件到手机）

> 归属：nibi-client 主线（桌面 Host 侧，~10 行 PR）。GO 侧手机端已就绪（A3-2，`ApprovalBoard` + `resolveInteraction` 命令），只等桌面把 interaction 事件放进 V4 conversation 快照。
> 登记日期：2026-11-11。派发时机由 owner 定；GO 侧不自行实现（D17 单向消费）。

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
