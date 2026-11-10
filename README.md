# NIBI-GO

NIBI 生态的移动客户端：双形态（NIBI-WORK 远控投影 + NIBI-GO 本机 AGENT）。内核复用 nibi-client 的 Rust 内核（npm 产物单向消费，D17）。

**入口**：[`AGENTS.md`](AGENTS.md)（开发规则）→ [`docs/decisions/ADR-INDEX.md`](docs/decisions/ADR-INDEX.md)（决策台账 D1–D17）→ [`docs/NIBI-GO架构总览.html`](docs/NIBI-GO架构总览.html)（可视化总图）。

## 目录

```
app/                        RN/Expo 壳（Phase A）
packages/
  relay-client/             Relay V2 terminal 客户端（纯 TS）
  chat-core/                聊天状态机（纯 TS，UI 框架可替换保险）
  phone-tools/              手机工具面接口（多平台适配器）
  shared-extract/           @nibi/shared 的抽取件（带来源标注）
modules/kernel-host/        模块 C 内核绑定（挂起；JNI 薄层 + 构建脚本）
docs/
  decisions/                ADR 索引（D1–D17）
  design/                   设计文档
  research/                 调研底稿
  NIBI-GO架构总览.html       可视化总图（浏览器打开）
scripts/                    门禁脚本
reference/                  上游参考仓（只读，不参与构建）
  nibi-client/              dev @ ff1c5f4f
  dsh-Go/                   main @ 8f31b2ed
```

## 路线

- **Phase A**（当前）：NIBI-WORK 远控原生客户端。零内核耦合。
- **Phase C**（挂起）：本机内核。启动信号见 ADR-INDEX D12。
- **Phase B**（最后）：WORK 形态手机操控路由。

## 状态

骨架阶段。pnpm workspace 与 Expo 骨架待落地（`app/` 首个提交后补开发命令）。
