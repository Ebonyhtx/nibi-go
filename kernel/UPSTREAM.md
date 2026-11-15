# kernel/ 上游同步说明（NIBI-GO 自有 fork）

> 决策：D24（`docs/decisions/ADR-INDEX.md`）——Android 内核 fork 进本仓，构建/适配/修复都在 GO，
> 上游 nibi-client 只读。本文件记录基线、目录归属、合并流程与 GO 专属改动，**每次合并必须更新**。

## 1. 基线

| 项 | 值 |
| --- | --- |
| 直接上游 | [Ebonyhtx/nibi-client](https://github.com/Ebonyhtx/nibi-client) `dev` |
| 基线 commit | `1369b043d42d95e5b9fde5a824e09abee71d8879`（2026-11-15，`Merge branch 'feat/android-kernel' into dev`） |
| 导入方式 | 快照：`git archive 1369b043 kernel` 解包到本目录，**不带上游 git 历史** |
| 完整性 | 导入时 2870 个文件与上游 `git ls-tree` 的 blob 哈希逐条一致（2026-11-15 核对） |
| 再上游 | ZCode-rs `0.1.67`（`6d349ed4`）+ NIBI 改造；来源、vendored 二进制与安全门禁记录见 `CHANGELOG-FORK.md` |
| 许可 | Apache-2.0：`LICENSE`、`NOTICE.md`、`vendor/THIRD-PARTY-NOTICES.txt` 随快照保留 |

`CHANGELOG-FORK.md` 是 nibi-client 时期的 fork 台账（ZCode-rs → NIBI），保留作来源证明；
GO 自己的同步台账只记在本文件。

## 2. 目录归属

| 路径 | 归属 | GO 改动纪律 |
| --- | --- | --- |
| `crates/` `apps/` `packages/` `prompts/` | 上游代码 | 只在 Android 适配必需处改；每处登记到 §4 |
| `vendor/` | 第三方源码（rg / bfs / ugrep） | 不手改；升级走上游同步 |
| `.cargo/config.toml` | 构建配置 | Android 16 KB 链接参数已在上游基线内 |
| `Cargo.lock` | 依赖锁 | GO 可独立升级（安全修复），升级记录到 §3 |

## 3. 合并流程

只取需要的 commit，不做全量 merge：

```bash
git remote add upstream-client https://github.com/Ebonyhtx/nibi-client.git   # 一次性
git fetch upstream-client dev
git diff <当前基线>..FETCH_HEAD -- kernel/          # 先看上游改了什么
```

1. 按 `kernel/` 路径挑拣：`git cherry-pick -n <commit>` 后只保留 `kernel/` 下的改动，或手工移植。
2. 优先级：安全修复（RUSTSEC/CVE）> 协议/会话能力 > 性能 > 其他。
3. **不为对齐上游回退 Android 能力**；冲突时保留 Android 分支并登记分歧（§4）。
4. 每批合并后：
   - 桌面 target：`cargo test --locked --workspace --no-fail-fast`；
   - Android：`node scripts/android-kernel/build.mjs` + 真机回归（启动/会话/流式/审批/改动卡/折叠/`:kernel`）；
   - 更新本文件的基线与台账。
5. 基线只在整批合并完成后前移，避免半合并状态下无法计算 diff。

## 4. GO 专属改动台账

| 日期 | 路径 | 改动 | 原因 | 票据/记录 |
| --- | --- | --- | --- | --- |
| 2026-11-15 | — | 快照导入，尚无代码改动 | D24 Phase 0 | `docs/plan.md` §7 |
| 2026-11-15 | `crates/net/src/android_trust.rs` | 新增 `attach_android_jvm`：`init_with_env` 初始化平台信任并置位；失败保持内置根兜底 | T8 S2（JVM/Context 交接） | `docs/tickets/T8-android-platform-tls-trust.md` |
| 2026-11-15 | `crates/net/Cargo.toml` / `Cargo.toml` | Android 目标新增直接依赖 `jni`（0.22.4）、`rustls-platform-verifier`（0.7.1，与 reqwest 传递依赖同版本） | T8 S2 | 同上 |
| 2026-11-15 | `crates/cli/src/android_ffi.rs` | 导出 `nibi_app_server_attach_android(env, context)`（仅 Android；返回 0/1） | T8 S2 C ABI | 同上 |
| 2026-11-15 | `app/modules/kernel-host/android/build.gradle`（仓外配套） | 引入 `org.rustls:rustls-platform-verifier:0.2.0` AAR；版本由 `build.mjs` 与 `Cargo.lock` 核对 | T8 S2 JVM 组件 | 同上 |

## 5. 合并记录

| 日期 | 上游 commit | 内容 | GO 侧调整 | 验证 |
| --- | --- | --- | --- | --- |
| 2026-11-15 | `1369b043` | 基线导入（含 T8 S1 平台根兜底、Android 16 KB 链接参数、`:kernel` 相关上游改动） | 无 | 快照 blob 哈希全等 |
