# 票据 · 发布 `@nibi-studio/cli-android-arm64` 平台包

> 提交方：NIBI-GO 仓库。随 Phase C 启动信号一起生效，**不催主线排期**——何时做由你定。
> 期望载体：nibi-client 仓的 `.github/workflows/rust-npm-packages.yml`（一次改动，详见下）。

## 需求

现有平台包矩阵只有 linux-x64-gnu / linux-arm64-gnu / darwin-arm64 三个 target（`rust-npm-packages.yml` 的 matrix，与内核 `Platform::published()`、`scripts/rust-cli/npm/package.mjs` 的 TARGETS 一一对应）。NIBI-GO 手机形态需要第四个：

```
target: aarch64-linux-android
package-id: android-arm64
```

## 具体改动（预计半天的 CI 工作）

1. **matrix 加一行**：`runs-on: ubuntu-24.04`（或任一装了 NDK 的 runner）+ `target: aarch64-linux-android` + `package-id: android-arm64`。
2. **构建命令加 NDK**：`cargo ndk -t arm64-v8a build --locked --release -p nibi-kernel-cli --bin nibi-rs`（需要 runner 装 NDK r26+，或用 `nativelink`/社区 action；与 vendored rg/bfs/ugrep 的 NDK 编译共用环境）。注意 ugrep 的 `build.rs` 按"目标族"取 `config/<族>.h`——需要加 android 族（参考现有 linux 族拷贝改）。
3. **内核 `Platform::published()` 补 entry**（注释写明"与 matrix 一一对应"）——这是让内核自己认得新平台包。
4. **package.mjs 的 TARGETS 同步**（如它也硬编码了平台表）。

## 边界（对 NIBI-GO 的承诺，不影响主线）

- 只加 target/entry，**不改任何现有平台的行为**；
- android 产物**不进**内核其他代码路径（`cfg(target_os = "android")` 分支是另一张票据的活，本票只管"能编译能发布"）；
- 发布节奏照旧（CI pack → 你手动/私有仓 publish，GitHub OIDC trusted publisher 已配好）。

## 验收

- workflow 绿，artifact 里有 `nibi-studio-cli-android-arm64-<ver>.tgz`；
- `tar -tzf` 能看到 `package/bin/nibi-rs`（或 .so 形态，按现行打包约定）；
- `file` 确认是 aarch64 ELF。

## 背景

- 用途：Phase C（NIBI-GO 本机内核）以本包为内核分发载体（决策 D17：GO 单向消费 npm 冻结产物，不养 Rust 构建链）。
- 紧迫性：Phase C 挂起中，无 deadline；但它也是"主线破坏 android 兼容"的持续报警器（进 CI 后每次 kernel commit 都编译 android），早进 CI 早受益。
