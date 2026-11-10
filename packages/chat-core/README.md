# Phase A：聊天状态机（纯 TS）

> 层级：协议层。**禁止 import react-native / expo / react**（AGENTS.md 规则 4）。这是 UI 框架可替换的退出保险（D12 反思条款：RN 若撞墙，本包零返工）。

## 职责

V4 协议事件 → 聊天状态投影。移植自桌面 `packages/ui` 的 store 逻辑（hooks/store 是 TS，可抽）：

- reducer：V4 事件流（session/messages、interaction/*）→ 消息树/工具行/思考行
- `replay.ts`：replayable attachment 的 snapshot/gap 断线恢复语义
- `approvals.ts`：审批/提问卡状态机——**两条不变量**：请求绑定 generation（连接重建旧卡作废）+ 30s 超时默认拒绝
- `pulse.ts`：**AgentPulse 状态投影**（D14/D15/通知的共同上游，A 阶段就定协议：枚举持续态 vs 一次性事件）

## 测试

Node 环境跑（jest/vitest + 事件 fixture）。审批状态机用假事件流测完整生命周期（Host capability 未开也能测，D9 讨论·第 3 点的退化路径）。

## 状态

骨架占位。
