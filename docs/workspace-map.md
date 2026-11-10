# NIBI-GO 工作区

> 结构、规则与路线见 [`README.md`](README.md) 与 [`AGENTS.md`](AGENTS.md)。

## 顶层布局

```
NIBI-GO/
├── AGENTS.md               # 开发规则（AI/开发者第一入口）
├── README.md               # 项目简介与路线
├── package.json            # pnpm workspace 根（gates/test 脚本）
├── pnpm-workspace.yaml     # workspace = packages/* + app（reference 刻意排除）
├── .gitignore
├── app/                    # RN/Expo 壳（Phase A，骨架待落地）
├── packages/               # 纯 TS 协议层 + 平台接口（各自 README 有职责与禁止事项）
│   ├── relay-client/
│   ├── chat-core/
│   ├── phone-tools/
│   └── shared-extract/     # @nibi/shared 抽取件（引用方式定案后启用）
├── modules/kernel-host/    # 模块 C 绑定（挂起，README 有启动信号与 spike 清单）
├── scripts/                # check-boundaries.mjs 架构门禁
├── docs/
│   ├── decisions/          # ADR-INDEX.md（D1–D17 决策台账 + 修正记录 + 参考仓 pin）
│   ├── design/             # 设计文档（待写：relay-client 接口草案等）
│   ├── research/           # 调研底稿（三份）
│   └── NIBI-GO架构总览.html # 可视化总图（浏览器打开，随决策更新）
└── reference/              # 上游参考仓（只读，不参与构建，不进 workspace）
    ├── nibi-client/        # dev @ ff1c5f4f
    └── dsh-Go/             # main @ 8f31b2ed
```

## 常用操作

| 操作 | 命令 |
|---|---|
| 架构门禁 | `node scripts/check-boundaries.mjs` |
| 全部测试 | `pnpm -r test`（relay-client/chat-core 须 Node 可跑） |
| 更新参考仓 | `cd reference/<仓> && git pull`，然后把新 commit 登记进 `docs/decisions/ADR-INDEX.md` 尾表 |
| 查某个决策 | `docs/decisions/ADR-INDEX.md` 按 D 编号检索 |

## 维护约定

- 决策变更：新写一条追加到 ADR-INDEX 的"关键修正记录"，不覆写历史结论。
- 参考仓仅用于调研对照（dsh-Go 的设计范式 / nibi-client 的实现细节），任何"我们要抄它的什么"都应在 docs/design/ 落成设计文档而不是直接搬代码。
- 上游 npm 包（`@nibi-studio/cli-*`）升级 = 显式提交 + ADR-INDEX 登记（D17 规则 1）。
