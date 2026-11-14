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

## 开发期假模型

```bash
node scripts/dev/mock-openai.mjs      # 127.0.0.1:9099，OpenAI/Anthropic 兼容，250ms 分块
adb reverse tcp:9099 tcp:9099
```

`startKernelHost({ NIBI_MODEL_BASE_URL, NIBI_API_KEY, NIBI_MODEL })` 只在 dev 冒烟页使用。

## 测试

```bash
pnpm --filter @nibi-go/kernel-session test        # client / feed / rows / controller
pnpm --filter @nibi-go/kernel-session typecheck
```
