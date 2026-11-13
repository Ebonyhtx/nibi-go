# 票据 · android 平台包补 cdylib 产物 `lib/libnibi.so`（Phase C 进程内内核）

> 提交方：NIBI-GO 仓库。Phase C（本机内核）C0「内核上机」的前置；**不催主线排期**——何时做由你定。
> 期望载体：nibi-client 仓的内核 crate + `scripts/rust-cli/npm/package.mjs` + `.github/workflows/rust-npm-packages.yml`。

## 需求（消费诉求口径）

T1 已交付的 `@nibi-studio/cli-android-arm64@4.0.2` 里只有 `bin/nibi-rs` 可执行文件。
D19（2026-11-12 定案）把 Phase C 的内核运行形态定为**进程内 `libnibi.so`**：App 进程 dlopen
内核 cdylib，不 exec 自带二进制（targetSdk 36 的 W^X/exec 限制）。可执行文件与 cdylib 是两种
编译产物，bin 无法被 dlopen——所以不是包坏了，是包里没有 `.so` 这个产物。

本票诉求（GO 侧被动消费，具体实现形态由上游定）：

1. **android 包新增 `lib/libnibi.so`**：内核本体 cdylib（aarch64-linux-android），版本随包
   版本（`NIBI_RELEASE_VERSION` 同源）。
2. **内核暴露最小进程内入口面**：宿主进程能把它当 app-server 驱动（语义上等价
   `app-server --stdio`，传输由进程内回调/等价机制承载，不要求真实 fd）。入口面用稳定 C ABI
   还是 JNI 直连、符号如何命名，**由上游定**；GO 侧用自己的 JNI 薄层包它（GO 仓
   `modules/kernel-host/`），本票不要求上游写任何 Android 宿主代码。
3. **`bin/nibi-rs` 保留**：D19 明确子进程形态只作开发机对照，仍从这个包取。
4. **`build.json` 能对账 `.so`**：现在 schema 是 `{version, target, sha256}` 单产物
   （`package.mjs:95-97`）；扩成双产物（分字段或数组）即可，GO 只要求能校验 `.so` 的完整性
   （消费端 fail-closed：校验不过不拷进 jniLibs）。
5. **`libc++_shared.so` 的去向**：workflow 注释已预告产物动态链 NDK 的 `libc++_shared.so`
   （`rust-npm-packages.yml:81`），Phase C 打包时进 jniLibs——包里携带或改静态链，二选一由
   上游定；GO 构建会把包内容整份拷进 jniLibs，不能有漏拷的运行时依赖。

## 现状证据（2026-11-13 逐条核实）

- 4.0.2 tarball 实测（registry 下载、sha256 `6dad802f…` 对账一致）：只有 `bin/nibi-rs` +
  `build.json` + `package.json`，无 `.so`。
- `kernel/crates/cli/Cargo.toml`：`nibi-kernel-cli` 只有 `[[bin]] name = "nibi-rs"`，无
  `[lib]`/crate-type——不产 cdylib。
- `scripts/rust-cli/npm/package.mjs:31-37`：TARGETS 已有 android 入口（:36）；`:90` 的 files
  白名单只有 `bin/nibi-rs` / `build.json`。
- `.github/workflows/rust-npm-packages.yml:134-136`：构建命令只编 bin
  （`-p nibi-kernel-cli --bin nibi-rs`）；`:81` 注释已预告 libc++_shared.so 的 jniLibs 归宿；
  `:105` `API=26`（与 GO 侧 minSdk 口径一致）。
- 进程内形态的语义锚点已存在：`kernel/crates/cli/src/app_server.rs`（app-server 形态）。

## 具体改动（参考落点，上游可改造）

1. **内核 crate**：给 android target 产 cdylib——`nibi-kernel-cli` 加 `[lib]`/crate-type
   （或独立薄 crate）；入口面最小化（v1 只要 app-server 等价的启动 + 双向传输），android 专属
   逻辑用 `cfg(target_os = "android")` 收口。
2. **`package.mjs`**：android target 的 files 白名单加 `lib/libnibi.so`（与可选的
   `lib/libc++_shared.so`）；`buildBuildJson`（:95-97）同步双产物 schema。
3. **workflow android leg**：构建命令补 cdylib 目标（`--lib` 或第二条 cargo build）；pack
   步骤带上新文件。android 产物无法在 runner 上执行，`.so` 侧用 `file`/`llvm-readelf` 做头部
   校验即可（bin 侧维持现状的 runner 之外豁免）。
4. **不动 `Platform::published()`**：android 不进 ssh-connect 的 Platform 表（T1 已定，本票
   不改变）。

## 边界承诺（对主线的承诺）

- **纯增量**：四个平台的 `bin/nibi-rs` 内容与行为零变化；linux-x64-gnu / linux-arm64-gnu /
  darwin-arm64 三个包逐文件一致（仅版本字段差异）。
- android 产物不进内核其他代码路径（延续 T1 的边界）；入口面是新增导出符号，不改现有内部
  调用。
- GO 被动消费：包发布后 GO 构建拷进 jniLibs（D19）；JNI host、进程内 transport、panic=abort +
  兜底、iroh NDK 都是 GO 侧自己的活（Spike 3 / C0），不要求上游实现。

## 验收

- workflow 绿；`tar -tzf` 能看到 `package/lib/libnibi.so` 与 `package/bin/nibi-rs`；
- `file` 确认 `.so` 是 `ELF 64-bit LSB shared object, ARM aarch64`；`bin/nibi-rs` 与上一版同
  源构建不变；
- `build.json` 可逐字对账 version/target 与两个产物的校验值；
- 导出符号可查（`llvm-nm -D libnibi.so` 看得到入口面符号，具体符号名以实现为准）；
- 其余三平台包与上一版产物一致。

## 背景

- D19（GO 仓 `docs/decisions/ADR-INDEX.md`，2026-11-12）：Android 内核运行形态 = 进程内
  `libnibi.so`（cdylib），分发载体仍是 npm 平台包（`lib/libnibi.so` + `build.json`）；子进程
  形态只作开发机验证，不进产品路径。
- Phase C 的两个启动信号（主线内核对齐批次收尾 + `@nibi-studio/cli-android-arm64` 发布）均已
  满足；本票是 C0「内核上机」前的最后一张上游票。
- T1 的验收（能编译能发布、tar 里有 `bin/nibi-rs`）依然成立，本票不推翻 T1，只是把
  「能发布」推进到「Phase C 能消费」。
