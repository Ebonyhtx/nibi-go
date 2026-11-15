# @nibi-go/kernel-session

进程内内核（`libnibi.so`）的会话协议层：纯 TS、Node 可测，**不依赖 react-native**（D11/D12）。

## 分层

```
KernelTransport（nibi-kernel-host 提供的 sendLine/onLine）
  └─ KernelSessionClient     请求/应答配对、内核反向请求应答、通知分发
       ├─ 会话 RPC：session/create | send | messages | list | resume
       └─ ConversationFeed   v4/conversation/subscribe → snapshot + deltas
            └─ ConversationController → deriveRows() → ChatRow[]
```

`ChatRow` 对齐 dsh-Go 的会话模型（`packages/dsh_client` + `chat_rows.dart`）：
用户行、助手行（正文 + 推理 + `streaming` + 模型）、工具行、连续 ≥3 次工具收组、
轮末脚注（用时 / 工具数 / token / 文件改动）、本机已发出的乐观 `pending` 行。

## 协议事实（2026-11-15 真机核对）

- 内核**没有** `session/events`（-32601）；历史/内容走 `session/messages`。
- 实时流走 V4 投影：`v4/conversation/subscribe { topic: "conversation/<id>", connectionId }`
  → 通知 `v4/conversation/frame`。物理帧 wire v3：首帧 `{kind:"snapshot"}`，之后
  `{kind:"deltas"}`；流式文本是 `{op:"row.delta", rowId, path:"text", append}`。
  分片 / CRC / schema 校验复用 `@nibi-go/shared-extract` 的 wire-reassembly，本包不重写。
- `session/list` 的 `workspace` 过滤是精确字符串比较（目录尾斜杠不同即不相等）；
  单工作区阶段先列全部、客户端排序。

## 交互（审批 / 提问）

- 快照的 `pendingInteractions` 是唯一状态源：`permission` / `userInput` / `workspaceHookReview`。
  `rows.ts` 把它们派生为 `approval` / `question` / `notice` 行，放在消息之后、乐观气泡之前（同 dsh-Go）。
- 回答走 `v4/command` 的 `resolveInteraction`：
  `{ commandId, clientId, sessionId, type: "resolveInteraction", payload: { interactionId, answer }, issuedAt }`。
  **`issuedAt` 是必填**：缺了内核回 `-32602 (root): missing`（2026-11-15 真机核对）。
- answer 形状（内核 `protocol-nibi/src/commands.rs::resolve`）：
  - 权限：`{ optionId }`。`optionId` 取自 `payload.options`（`allowOnce` / `allowAlways` / `deny` / 自定义），
    `fullAccess` 来自 `payload.fullAccessOption`；拒绝可带 `freeText`。
  - 提问：`{ action: "accept", content: { answers: { [question]: text } } }`，或 `{ action: "decline" }`；
    计划审批是 `{ action: "accept", content: { answer: "approve" } }`。
- 答完内核把它从 `pendingInteractions` 移除，卡片随下一帧消失；晚到/已收口回 `noop`，这里当成功。
- 工具行带 `output.text`（成功/失败都有），UI 在工具卡里显示前几行。

## 会话管理（归档 / 删除）

- **内核只有删除，没有归档**：`session/list` 的返回没有 archived 字段。归档是 App 本地状态
  （`filesDir/nibi-archived-sessions.json`），主列表按集合过滤；内核不感知。
- **软删除**：`v4/command` 的 `{ type: "deleteSession", payload: {} }`（envelope 带
  `sessionId`）。内核先中断/关闭打开着的会话，再软删（`time_deleted`）；**成功的 ACK 没有
  result**。`kernel-session` 封装为 `deleteSession(sessionId)`。
- **彻底删除 / 释放空间**：`v4/storage/sessionData/purge`（NIBI 客户端「清理数据」用的同一
  能力）：`{ sessionIds, directories }` → `{ deleted: [{sessionId, bytes}], kept, failed,
  memory }`。删除会话行（级联消息/part/待办/输入账本）与 `artifacts|exec|agents|sessions`
  目录、`model-io-<sid>.jsonl`，`bytes` 只算实际删除的文件（数据库行不计入、SQLite 文件不
  收缩，但空闲页会被后续会话复用）。运行中 / 分享钉住 / 工作流引用 / 附件被别的会话引用的
  整棵保留（`kept[].reason`）。`kernel-session` 封装为 `purgeSessionData()`。
- 删当前会话后宿主要自己切到最近一条可见会话（没有就新建）；归档/恢复/全部删除的 UI 在
  `app/src/components/GoDrawer.tsx`。删除流程 = 先 `deleteSession` 关闭，再 `purgeSessionData`
  硬删。

## 子智能体 / 产物

- `subagent` 行 → 子智能体卡（类型 / 状态 / 摘要；有 `childSessionId` 时可下钻子会话）。
  **当前 4.1.0 内核在 Agent 前台/后台调用下都没有投影出 `subagent` 行**（真机核对，只有
  Agent 工具行 + 后台通知回合）；映射按 schema 保留，内核产出行时卡片自动生效。
- `artifact` 行：Rust 内核投影不产生（只有 DWF 的存储产物），GO 暂不做卡片。

## 轮折叠（dsh-Go foldCompletedTurns）

- 只折 **completedSuccess** 的轮；失败/中断/运行中保持原样——停在哪一步要一眼看得到。
- **有过程才折**：工具数 > 0，或中间助手消息 > 0。普通问答（一段思考 + 一段回答）不折。
- `process` 行里放思考、工具行、中间消息；最终回答留在折叠外。脚注 `folded: true` 时
  不再重复“已完成/工具数”（过程摘要行已经说了）。
- 轮范围从这一轮的用户行之后开始（内核先发 turnHeader 再发 userInput）；用户气泡不进折叠。
  轮里夹了用户插话时不折，保持时间顺序。

## 轮末改动卡

- 数据源是 `v4/conversation/fileChanges`。**不要从工具输出推**：Rust 内核不发 `file_diff`
  展示（那是桌面/Node 的 `toolResultDisplaySchema`，真机核对过），按工具输出聚合永远出不了卡。
- 参数：`{ sessionId, target: { rowId, entityId }, baseRevision, baseLogEpoch }`，`target` 必须是轮头行；
  水位取自当前快照。过期回 `proto.staleRevision` / `proto.staleLogEpoch`，用下一帧的新水位重试。
- 返回 `{ files, additions, deletions, items: [{ path, additions, deletions, writeCount, toolNames, patches }] }`；
  UI 把卡挂在轮末脚注之后（dsh-Go `ChangeCardRow` 的位置）。当前只取最近 3 个已结束轮，避免打开会话打一串 RPC。

## 开发期假模型

```bash
node scripts/dev/mock-openai.mjs      # 127.0.0.1:9099，OpenAI/Anthropic 兼容，250ms 分块
adb reverse tcp:9099 tcp:9099
```

`startKernelHost({ NIBI_MODEL_BASE_URL, NIBI_API_KEY, NIBI_MODEL })` 只在 dev 冒烟页使用。

审批/工具卡联调：提示里带 `TOOLTEST` 让假模型回一次工具调用。Android 上内核只认 bash/zsh，
没有 bash（见 `docs/tickets/T9-android-shell-execution.md`），验审批用 Write：

```bash
MOCK_TOOL_NAME=Write \
MOCK_TOOL_INPUT='{"file_path":"/sdcard/Download/nibi-approval-test.txt","content":"nibi approval test"}' \
node scripts/dev/mock-openai.mjs
```

## 测试

```bash
pnpm --filter @nibi-go/kernel-session test        # client / feed / rows / controller
pnpm --filter @nibi-go/kernel-session typecheck
```
