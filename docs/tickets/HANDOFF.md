# 交接方式：如何把票据递给 NIBI 工作区的 AI（同时不影响主线开发）

> 背景：NIBI-GO 与 nibi-client 是两个独立工作区（`本仓` / `nibi-client 工作区`），各有各的 AI 会话。本仓（NIBI-GO）发现的内核需求需要 nibi-client 那边的 AI/你来实现——但**主线永远不等 GO**（D17）。

## 推荐交接流程（三步，零主线干扰）

**第 1 步 · 票据落仓**
票据文本已写好在 [`docs/tickets/`](.)，内容已按"给另一个 AI 看的任务书"标准写：现状证据（文件:行号）/ 具体改动清单 / 验收标准 / 边界承诺（不影响主线）。

| 票据 | 归属 | 内容 |
|---|---|---|
| T1 | nibi-client 内核 | android 平台包发布 |
| T2 | nibi-client 内核 | npm scope 统一 |
| T3 | **NIBI 账号中心（Zitadel 管理面）** | NIBI-GO OIDC native app 注册（nibigo://login）——不走本交接流程，owner 直接操作 |
| T4 | nibi-client 桌面 Host | 审批 capability 开闸（interaction 事件到手机，~10 行） |
| T5 | nibi-client 桌面 transport | E2E 插桩（按 docs/design/e2e-envelope-v1.md 镜像，~200 行） |

**第 2 步 · 在 NIBI 工作区的 AI 会话里派发**
在 nibi-client 工作区开一次 AI 会话，把票据文件路径喂给它（例如）：

> 请读 `docs/tickets/T1-android-platform-package.md`，这是一张来自 NIBI-GO 的内核需求票据。先自己核对票据里的现状描述是否属实（文件/行号），然后按你的主线节奏决定是否实现。实现时走你自己的流程（AGENTS.md/五条纪律/CHANGELOG-FORK 记账），不需要照顾 NIBI-GO 的任何偏好——票据里的"验收标准"就是 NIBI-GO 侧的全部诉求。

关键点：**让它自己复核票据、自己排期**——这是第 2 级（票据制）的核心：NIBI-GO 只提需求证据，不指定实现方式、不设 deadline。

**第 3 步 · NIBI-GO 侧被动消费**
实现随主线/CI 发版后，本仓升级 lockfile 里的版本号 + ADR-INDEX 登记新 commit，验证按 plan.md §4 的冒烟清单走。

## 为什么不影响主线

| 顾虑 | 该模型下的现实 |
|---|---|
| 票据会不会打断主线正在做的事 | 不会——票据躺在 `docs/tickets/`，主线 AI 只在被明确指到时才读它，平时不可见 |
| 实现 NIBI-GO 的需求会不会带偏主线方向 | 不会——两张票都是**纯增量**（T1 加一个 target entry；T2 纯改名零行为变化），且票据里写明了边界承诺；nibi-client 的 AI 有权拒绝或改造（复核票据是它的第一步骤） |
| 主线 AI 会不会被要求"为 GO 而设计" | 不会——票据验收只描述 NIBI-GO 的消费诉求（能编译/能拉到包），实现完全按主线自己的规范 |
| 排期压力 | 无 deadline 字段；T2 标注"建议尽早"仅因漂移成本随下游增多而变大 |

## 一个可选的固定仪式（如果你希望更省心）

在 nibi-client 的 AGENTS.md 里加一行（你同意才加，我不代加）：

> 收到 `docs/tickets/` 下的票据时，按"复核→排期→实现/拒绝"处理；票据不设 deadline，不改变主线优先级。

这样以后你只需要说一句"处理一下 GO 的票据"，AI 会自己找到并走完流程。
