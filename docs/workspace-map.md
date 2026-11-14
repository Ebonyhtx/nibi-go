# NIBI-GO 工作区

> 结构、规则与路线见 [`README.md`](../README.md) 与 [`AGENTS.md`](../AGENTS.md)。

## 顶层布局

```
NIBI-GO/
├── AGENTS.md               # 开发规则（AI/开发者第一入口）
├── README.md               # 项目简介与路线
├── package.json            # pnpm workspace 根（gates/test 脚本）
├── pnpm-workspace.yaml     # workspace = packages/* + app + app/modules/*
├── .gitignore
├── app/                    # RN/Expo 壳（应用主体；WORK 为入口）
├── packages/               # 纯 TS 协议层 + 平台接口（各自 README 有职责与禁止事项）
│   ├── relay-client/
│   ├── chat-core/
│   ├── phone-tools/
│   └── shared-extract/     # @nibi/shared 抽取件
├── modules/kernel-host/    # Phase C 内核绑定（骨架；启动信号见 ADR-INDEX D12）
├── scripts/                # check-boundaries / check-public-repo 等门禁
├── docs/
│   ├── decisions/          # ADR-INDEX.md（D1–D19 决策台账，权威索引）
│   ├── design/             # 设计规格（relay-client 接口草案、E2E 信封 v1）
│   ├── research/           # 调研与实测底稿
│   └── NIBI-GO架构总览.html # 可视化历史快照（浏览器打开；现行决策见 ADR-INDEX）
└── （reference/ 已移出：见下方归档说明）
```

> `reference/` 不再位于本仓。2026-11-12 起，上游参考克隆归档到 NIBI 工作区根目录下的
> `.artifacts/go-reference-archive/`（只读，不参与构建，不进 workspace）。
> 归档时的历史 pin：nibi-client `ff1c5f4f`（dev）、dsh-Go `8f31b2ed`（main，v1.0.15），
> 仅作历史记录，不再更新。

## 常用操作

| 操作 | 命令 |
|---|---|
| 架构门禁 | `node scripts/check-boundaries.mjs` |
| 公开仓检查 | `node scripts/check-public-repo.mjs` |
| 全部测试 | `pnpm -r test`（relay-client/chat-core 须 Node 可跑） |
| 查某个决策 | `docs/decisions/ADR-INDEX.md` 按 D 编号检索 |
| 查历史参考 | 工作区 `.artifacts/go-reference-archive/`（只读，不再随本仓更新） |

## 维护约定

- 决策变更：新写一条追加到 ADR-INDEX 的"关键修正记录"，不覆写历史结论。
- 归档参考仅用于历史对照（dsh-Go 的设计范式 / nibi-client 的实现细节），任何"我们要抄它的什么"都应在 docs/design/ 落成设计文档而不是直接搬代码。
- 上游 npm 包（`@nibi-studio/cli-*`）升级 = 显式提交 + ADR-INDEX 登记（D17 规则 1）。
