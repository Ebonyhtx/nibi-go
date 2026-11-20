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
| 2026-11-15 | — | 快照导入，尚无代码改动 | D24 Phase 0 | 内部计划 §7 |
| 2026-11-15 | `crates/net/src/android_trust.rs` | 新增 `attach_android_jvm`：`init_with_env` 初始化平台信任并置位；失败保持内置根兜底 | T8 S2（JVM/Context 交接） | 内部票据 T8 |
| 2026-11-15 | `crates/net/Cargo.toml` / `Cargo.toml` | Android 目标新增直接依赖 `jni`（0.22.4）、`rustls-platform-verifier`（0.7.1，与 reqwest 传递依赖同版本） | T8 S2 | 同上 |
| 2026-11-15 | `crates/cli/src/android_ffi.rs` | 导出 `nibi_app_server_attach_android(env, context)`（仅 Android；返回 0/1） | T8 S2 C ABI | 同上 |
| 2026-11-15 | `crates/net/src/android_trust.rs` | `android_tls_config`：平台 `Verifier::new` + 内置根 `WebPkiServerVerifier` 的合并校验器（reqwest 的 `tls_certs_merge` 在 Android 上不可用，平台后端也没有 `new_with_extra_roots`） | T8 S2 信任合并 | 同上 |
| 2026-11-15 | `crates/net/src/egress.rs` | Android 的 `Anchors::Merge` 走 `use_preconfigured_tls(ClientConfig)`；桌面路径不变 | T8 S2 | 同上 |
| 2026-11-15 | `crates/kernel-api/src/session_prefs.rs` | 新增 `ShellDialect::AndroidSh`（serde `android_sh`） | D25 Phase 1 | 内部票据 T9 |
| 2026-11-15 | `crates/env-local/src/shell.rs` | Android 的 `default_shell`/`hook_shell` 用发现的 POSIX sh 并返回 `AndroidSh`；其它平台不变 | D25 Phase 1 | 同上 |
| 2026-11-15 | `crates/env-local/src/shell/supervise.rs` | `AndroidSh` 复用 GitBash 的 POSIX 启动形态 | D25 Phase 1 | 同上 |
| 2026-11-15 | `crates/cli/src/shell.rs` | Android 发现顺序 `NIBI_SHELL` → `SHELL` → PATH 的 bash/zsh/sh → `/system/bin/sh` | D25 Phase 1 | 同上 |
| 2026-11-15 | `crates/env-local/src/host.rs` | `describe_shell` 把 Android 的 `/system/bin/sh` 显示为 `sh` | D25 Phase 1 | 同上 |
| 2026-11-15 | `app/modules/kernel-host/android/build.gradle`（仓外配套） | 引入 `org.rustls:rustls-platform-verifier:0.2.0` AAR；版本由 `build.mjs` 与 `Cargo.lock` 核对 | T8 S2 JVM 组件 | 同上 |
| 2026-11-17 | `crates/protocol-nibi/src/conversation_intent.rs` | 新增 `plugin_references_part`：把 `pluginReferences` 渲染成 `<plugin_reference>`（identifiers-only，含 skills/mcp_servers/commands）；`model_text`/`canonical` 增加该参数 | GO 手机 COMPOSE 的插件引用（对应 NIBI 客户端 `plugin_reference` reminder） | 内部计划 Phase 4 |
| 2026-11-17 | `crates/protocol-nibi/src/commands.rs` | `sendText` / `editUserQuery` 读取 `payload.pluginReferences`，只注入模型文本，用户行仍显示原文 | 同上 | 同上 |
| 2026-11-17 | `crates/protocol-nibi/src/projection/rows.rs` | userInput 行透传 `pluginReferences`，刷新/冷恢复后仍能回显 | 同上 | 同上 |
| 2026-11-21 | `crates/cli/src/config/project_config_keys.json` | 新增：PROJECT-CONFIG 项目配置白名单 canonical JSON 的 GO 本地副本。上游放在 `packages/shared/src/kernel-contract/`（Node+Rust 共用），GO 没有共享包，改放 Rust 侧并由 `project_scope_tests` 的 `include_str!` 与 mirror 核对 | 82ae3d56 移植（P0-0）；GO 的 Node 侧（app）暂不消费该契约 | §5 同日行 |
| 2026-11-21 | `scripts/check-upstream-gates.mjs` | 新增：内核上游合并门禁。R06 entry 前缀（只查 Rust 侧 `nibi-kernel/` 字面量并禁 `rust-cli/` 回流——GO 的手机宿主走协议、本仓无 Node 读端）+ R12 Cargo.lock CVE 下限（rusqlite/libsqlite3-sys/webpki-root-certs/rustls-webpki/rustix/libz-sys）。路径按 kernel/ 布局调整 | 82ae3d56 移植（R06/R12）；上游把脚本接进 CI `verify:pre-push`，GO 的 CI 接线未随批移植，暂手工执行 `node kernel/scripts/check-upstream-gates.mjs` | 变异夹具验证能失败（改前缀/换 lock 退出码 1） |

## 5. 合并记录

| 日期 | 上游 commit | 内容 | GO 侧调整 | 验证 |
| --- | --- | --- | --- | --- |
| 2026-11-15 | `1369b043` | 基线导入（含 T8 S1 平台根兜底、Android 16 KB 链接参数、`:kernel` 相关上游改动） | 无 | 快照 blob 哈希全等 |
| 2026-11-21 | `db09ae89` | libz-sys 1.1.31 → 1.1.33（RUSTSEC-2026-0544，grep 工具的 vendored zlib） | 无（`cargo update -p libz-sys --precise 1.1.33`，版本与校验和同上游锁一致） | Cargo.lock 锁定 1.1.33；`cargo check --workspace` 通过 |
| 2026-11-21 | `af9fbbe0` | fork 建会话原子化：`SessionStore::create_and_commit`（缺省两步，node-store 单 `begin immediate` 事务），`Actor::fork` 改用它，批次失败不再留空 fork 会话 | `kernel-api/src/store.rs` 缺省实现插在 GO 的 `commit` 与 `load` 之间（GO 的 `session_directory` 等扩展原样保留）；`session/fork.rs` 按现状移植（GO 尚无上游 K6 的父会话 system 快照段，Ok 分支保持 GO 原样，Err 分支补 `tracing::warn!`） | `cargo test -p nibi-kernel-node-store -p nibi-kernel-session` 全绿，含新测试 `a_failing_fork_batch_leaves_no_child_session_row` |
| 2026-11-21 | `39192bf8` | 子代理建会话原子化：`spawn::create` 先备事实、`create_with_facts`（走 `create_and_commit`）成功后再做 MCP/目录/插件继承与 cwd 继承；`MemoryStore` 加 `fail_next_create_and_commit` 注入口 | `spawn.rs`/`test_support.rs`/`testing/store.rs` 原样移植（GO 无 `pending_work`，注入口方法挪到 `set_updated` 之后）；新测试按上游放进 GO 的 `spawn_tests.rs`（GO 该文件仍是基线版，上游同期的生命周期测试重组未随批引入）；另修 GO 存量测试缺 `EnvFacts.runtimes` 字段的 6 处编译错误（与本批无关，`runtimes: None` 补齐） | `cargo test -p nibi-kernel-agents` 全绿，含新测试 `a_failed_child_session_write_registers_nothing` |
| 2026-11-21 | `6faa44b9` | 插件 select 不再把 `__nibi-plugin-host` argv 当 Node-CLI-only 依赖（桌面播种的 Office 插件误杀）：删 `NodeDependency::PluginHost` | 原样移植（保留 GO 的 `ViewHost` 变体与 GO 测试里的 image-search/android-emulator/visualize 基线差异）；全仓检索：`__nibi-plugin-host` 在 GO 只出现在 select.rs/select_tests.rs，GO 的 app/scripts 不播种该 argv 缓存（播种在桌面 Host 的 `official-plugin-runtime.ts`，不在本仓） | `cargo test -p nibi-kernel-ext` 全绿，含新增 2 个测试与改名的 `bundled_plugins_that_need_node_services_are_skipped`；五 crate 定向测试共 1092 通过 0 失败 |
| 2026-11-21 | `82ae3d56` | Tier 0 安全收口（kernel 内部分）：P0-0 项目配置白名单 `project_scope`（只放行 hooks / mcp / plugins.dirs（工作区内 + realpath）/ enabledPlugins=false / options，其余逐键丢弃并报 `config.project_keys.ignored`；`assemble`/`plugin_snapshot`/`project_allow` 全走投影）；P0.5 Bash 安全：只读放行只在 Bash 方言成立（`BASH_TOOL_SHELL`、`is_read_only_for_shell_*`、`Dialect::path_style`；PowerShell/CMD 没有只读表一律不判只读，Bash 工具 `SHELL` 与判决链同源）；session/stop 带 `expectedExecutionId`（wire 字段 `expectedExecutionId`，缺省 None 兼容老客户端；本地/远端环境与 `Shells::stop` 校验执行身份，mismatch 回 `NotRunning` 不误杀新执行，重放账本三元化）；Monitor 停止带 operationId；Bash started/completed/exited 结构化日志带 pid/toolCallId；R12 CVE 下限门禁脚本 | GO 侧调整：① **AndroidSh 不按 legacy shell 关只读证明**——mksh（`/system/bin/sh`）是 POSIX 方言，与 Posix 只读表同一语法类，与 CMD/PowerShell「换语法执行同一段文本」的失效机制不同；`readonly_dialect_for(ShellKind::Bash, Posix)` 在 Android 照常成立，理由写入 `policy/readonly.rs` 与 `tools/bash.rs` 注释；② canonical 白名单 JSON 落 GO 本地（见 §4）；③ 门禁脚本 R06 只查 Rust 侧、CI 接线未移植（见 §4）；④ `shell.rs`/`supervise.rs` 的改动并入 GO 的 Android-aware 版本（`AndroidSh` 复用 GitBash 启动形态、会话级 HOME/TMPDIR 原样保留）；⑤ 顺带补齐 GO 存量测试缺 `EnvFacts.runtimes` 的 18 处编译错误（policy/tools/exec-server/cli，与本批无关） | `cargo check --workspace` 通过；policy/env-local/exec-wire/exec-server/kernel-api/cli 共 1143、tools 345、env-remote 3 全部通过 0 失败（含上游新测试 23 个逐一验证）；gate 脚本 PASS + 变异夹具可失败 |
