# 上游协作与票据（D24 后）

> **2026-11-15 D24 定案**：Android 内核 fork 进 NIBI-GO（`kernel/`），Android 的构建、适配与
> 缺陷修复归 GO；上游 nibi-client 只读，不再为 Android 开票据。T1–T9 作为历史记录保留，
> 不再作为上游排期依据。仍走 D17 抽取件流程的只有 `packages/shared-extract/`。

## 历史票据

| 票据 | 状态（2026-11-15） | 内容 |
|---|---|---|
| T1 | 已结案 | android 平台包已发布（`@nibi-studio/cli-android-arm64`） |
| T2 | 已结案 | npm scope 已统一为 `@nibi-studio/cli-<platform>` |
| T3 | 已结案 | NIBI-GO OIDC native app 注册并接入令牌代理；剩真机完整登录 |
| T4 | 已结案（GO 侧修复） | 审批卡恒空；归因修正为客户端缺 V4 握手与 optionId |
| T5 | 已实现（`9d0fc7c0`）；待真机 | nibi-client 桌面 transport |
| T6 | 已完成（上游 `697f86cf`） | android 平台包补 `lib/libnibi.so` |
| T7 | 已完成（上游 `697f86cf`） | web 远程控制 transport 注入口 |
| T8 | S1 已并入 fork 基线；**S2 转 GO 自有** | Android TLS 平台根：S1 退内置根；S2 `attach(JNIEnv*, Context)` 在 fork 的 JNI/Service 侧做 |
| T9 | 临时桥已真机；**正式方案转 GO 自有** | Android shell：`bin/bash -> /system/bin/sh` 过渡；D25 Phase 1/2 的 AndroidSh/三件套接管 |

## D24 之后怎么做

1. **Android 内核改动**：直接在 `kernel/` 改，提交说明写清 Android 条件编译/宿主适配；必须跑
   桌面 target 的 `cargo test` + Android 真机回归（启动/会话/流式/审批/改动卡/折叠/shell）。
2. **上游合并**：只取安全修复与协议能力，记录合并的上游 commit 与 Android 分歧；不为对齐上游
   回退 Android 能力，也不改桌面/CLI 语义。
3. **shared-extract**：仍按 D17 抽取件流程（来源 commit、逐文件抽取、契约测试、升级对比）。
4. **发布**：GO 自建并校验 `libnibi.so`（D24），不再消费上游 Android npm 包；上游
   `rust-npm-packages.yml` 的 android leg 退场由 fork Phase 0 处理。

## 历史的三步流程（仅存档）

1. 票据落仓：给上游维护者看的任务书（现状证据、改动清单、验收、边界承诺）。
2. 上游复核：上游按自身流程决定实现/拒绝/改造，不设 deadline。
3. 本仓被动消费：随上游发版升级 lockfile，并在 ADR-INDEX 登记。

这套流程在 D24 前用于 Android 内核；现在只保留为历史，不再适用于 Android 改动。
