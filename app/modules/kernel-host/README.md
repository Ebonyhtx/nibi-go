# app/modules/kernel-host（Phase C · C0 已完成）

> 2026-11-14 上游 T6/T7 交付（nibi-client `697f86cf`），`@nibi-studio/cli-android-arm64@4.1.0`
> 带 `lib/libnibi.so`（C ABI v1，目标 API 24）；**D24 后 GO 不再消费该包**，内核改由本仓
> `kernel/` 自建（见下文构建）。

## 结构

| 路径 | 职责 |
| --- | --- |
| `index.ts` | JS 绑定（惰性 `requireNativeModule`，模块/`.so` 缺失时静默降级） |
| `android/.../NibiKernelHostModule.kt` | Expo 模块：环境前置、`start/send/stop/destroy`、事件转发；按模式走进程内或 `:kernel` |
| `android/.../KernelService.kt` | **D20 `:kernel` Service**：本进程 dlopen `.so`、socketpair 帧通道 |
| `android/.../KernelServiceClient.kt` | UI 进程侧：Binder 绑定、帧读写、binder death 退避重连 |
| `android/src/main/aidl/.../INibiKernelService.aidl` | **D20 控制面契约**（Binder） |
| `android/src/main/cpp/nibi_kernel_jni.c` | **JNI 薄层**：C ABI 包装 + 内核线程附着 + 按 LF 切帧 |
| `android/src/main/cpp/CMakeLists.txt` | 链接预编译 `libnibi.so`（`IMPORTED` 目标） |
| `android/prebuilt/jniLibs/<abi>/` | 构建期落盘的内核产物（**gitignore，不入库**） |

内核本体不在这里：D24 后内核 fork 在本仓 `kernel/`，由构建链交叉编译出 `.so`（见 `kernel/UPSTREAM.md`）。

## 构建

```bash
node scripts/android-kernel/build.mjs          # 从 kernel/ 交叉编译 + 落盘 + 校验
node scripts/android-kernel/build.mjs --check  # 只校验已落盘产物（CI/构建前）
cd app/android && ./gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a
```

需要 NDK r27+（`ANDROID_NDK_HOME`，或 `ANDROID_HOME/ndk/27.x`）与 Rust 1.95
（`kernel/rust-toolchain.toml` 钉住）。

校验是 fail-closed：ELF64/AArch64/shared object、`.note.android.ident` 的 API level ≤ App
minSdk（24）、**ELF `LOAD` 段 16 KB 对齐**（`0x4000`，否则 16 KB 页设备装不上；D22）、
C ABI v1 的五个导出符号、sha256 与 `.stamp.json`（记录 NDK/rustc/提交）。任何一项不过就不落盘。
JNI 薄层自己的 `libnibi_kernel_jni.so` 仍由 CMake `target_link_options` 对齐到 16 KB。

> 注意：AGP 打包时会 strip `.so`，所以**APK 里的 libnibi.so 与落盘文件 sha256 不同**（实测
> `956a865b…` → `0896c9c9…`）。校验只对「落盘前的产物」有意义，别拿 APK 内容去对
> `.stamp.json`。

## 运行契约（来自 nibi-client `docs/android-cdylib-abi.md`）

- 内核在 `start` 时**只读一次**进程环境：模块在 `start()` 前 `setenv`
  `HOME` / `NIBI_DATA_BASE_DIR`（都指向 App 私有 `filesDir`）与 `TMPDIR`（`cacheDir`）。
  `cwd` 是进程级的，Android 上仍是 `/`（只读不写；目前不改）。
- 输出回调在内核线程上调用，`data` 仅当次有效：JNI 层立即复制并按 LF 切成完整行，
  再转成 UTF-8 字符串交给 JS（JSON 行内不会出现裸 LF）。
- 一个进程只允许一个实例；`destroy()` 等待内核线程退出，`OnDestroy` 里兜底调用。
- 内核 panic 会带走 App 进程（`panic=abort`）——看门狗/前台服务待后续切片。

## TLS 平台信任（T8 S2，2026-11-15）

内核在 Android 上要读系统信任库（用户/企业 CA），`rustls-platform-verifier` 需要 JVM +
`android.content.Context`。内核为此导出 `nibi_app_server_attach_android(JNIEnv*, jobject)`：

- 调用时机：**`nativeStart` 之前**；进程内模块与 `:kernel` 服务的 `start()` 都先调
  `NibiKernelHostNative.nativeAttach(applicationContext)`，失败只记日志、继续启动；
- 失败/未调用时走 S1 兜底：只用内置 Mozilla 根，公开 HTTPS 正常，用户安装的 CA 不生效；
- 内核侧 **不能用 reqwest 的 `tls_certs_merge`**（Android 上直接返回错误，且平台后端没有
  `new_with_extra_roots`）：`net` 自己构造预配置 rustls 配置（平台 `Verifier::new` + 内置根
  `WebPkiServerVerifier` 合并，任一通过），经 `use_preconfigured_tls` 交给 reqwest；
- 构建链断言 `nibi_app_server_attach_android` 必须存在（`scripts/android-kernel/build.mjs`）。

JVM 侧还需要 crate 的 Kotlin 组件（JNI 桥，`org.rustls.platformverifier.CertificateVerifier`）：

- 依赖：`org.rustls:rustls-platform-verifier:0.2.0`，仓库声明与 debug/proguard 覆盖都由
  `app/plugins/withKernelAndroidTrust.js` 在 prebuild 时注入（`app/android/` 是生成目录，不手改）。
  版本必须与 `kernel/Cargo.lock` 的 `rustls-platform-verifier-android` 一致，`build.mjs` 会核对；
- 该 AAR 自带 `networkSecurityConfig`（base 禁明文 + HTTP CRL 白名单）。插件给 debug 变体写
  `src/debug/res/xml/network_security_config.xml` 整体覆盖（允许 Metro 明文 + 信任用户 CA），
  发布变体保留 AAR 的配置；
- R8：插件给 `proguard-rules.pro` 追加 `org.rustls.platformverifier.**` 的 keep（JNI 反射调用，
  R8 看不到引用）。

## D20 进程拆分（service 模式）

开关：**默认 `:kernel` 服务模式**；`EXPO_PUBLIC_NIBI_KERNEL_MODE=inprocess` 可强制退回进程内做对照。
服务启动失败（后台启动限制/机型差异）时首页自动回退进程内，不空屏。

- **进程**：`KernelService` 声明 `android:process=":kernel"`，普通进程（`isolatedProcess`
  没有网络权限，不用）。`.so` 与 JNI 薄层只在 `:kernel` 里加载执行。
- **控制面**：`INibiKernelService.aidl`（`abiVersion/loadError/start/openFrames/stop/destroy/killForTest`）。
- **帧流**：不走 Binder（1 MB 事务上限）。`openFrames()` 用
  `ParcelFileDescriptor.createSocketPair()` 返回宿主端 fd，双向 JSON 行都走这个 fd；
  **先 openFrames 再 start**——启动帧（`startup/storageState`）不会因为通道未建而丢。
- **死亡/重连**：`binder.linkToDeath` → 关通道 → 250/500/1000/2000ms 退避重绑 → 重新
  `openFrames + start`；`onKernelRestart(restarting|ready)` 通知 JS，hook 重建 client/订阅并
  `resumeSession` 当前会话（内核自己落库，watchdog 不重放）。
- **幂等**：宿主 Activity 重建后可能再次 `start`；Service 记住 `kernelStarted`，已在跑时直接返回 true；
  React context 销毁只解绑（`dispose`），显式 `destroy` 才停内核。
- **D20.2 保活**：`startForegroundService` + `START_STICKY` + `dataSync` 前台服务
  （`FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_DATA_SYNC`，通知渠道 `nibi-kernel`）。

真机验证（2026-11-15，PHK110 / Android 16）：

- `ps -A` 同时出现 `top.nibistudio.nibigo` 与 `top.nibistudio.nibigo:kernel`；
- 会话历史、流式、折叠、改动卡在 service 模式下全部正常；
- `run-as ... kill -9 <kernel pid>` → logcat `NibiKernelClient: 内核进程 binder death` →
  新 `:kernel` pid 出现 → UI 恢复「就绪」→ 发 `RECONNECT` 得到完整回合（5.6s / 16 tokens）；
- **杀 UI 进程**（只 kill 主进程）：`:kernel` pid 不变、`dumpsys activity services` 仍
  `isForeground=true`；重开 App 接回同一个内核 pid，发 `AFTERUI` 得到完整回合。

当前边界（⑤）：

- `POST_NOTIFICATIONS`（Android 13+）在服务启动前用 `PermissionsAndroid` 运行时请求；拒绝只影响
  通知栏显示，FGS 状态仍成立（`dumpsys activity services` 可见 `isForeground=true`）。
  本机测试时该权限此前被设成 `USER_FIXED` 拒绝，弹窗路径未在设备上复验。
- Android 15+ `dataSync` 有 6h/24h 上限：`KernelService.onTimeout` 主动停内核 + `stopSelf`，
  避免系统判 ANR；长任务要走 `specialUse` 声明或分段续跑（⑤ 待运营者定）。

## Android shell / 随包运行时（D25 Phase 1+2，2026-11-15）

内核在 Android 上的 shell 发现由 fork 负责，宿主只准备环境：

- `ShellDialect::AndroidSh`（`crates/kernel-api`）：POSIX 启动形态，无 bash/zsh 扩展；
  发现顺序（`crates/cli/src/shell.rs`）：`NIBI_SHELL` → `SHELL` → PATH 里的 bash/zsh/sh →
  `/system/bin/sh`；hook 命令用同一套发现（不再固定 `/bin/bash`）。
  Phase 2 把 bash 放进 `$NIBI_BIN` 后，PATH 命中 bash → 自动切回 `GitBash` 方言。
- 宿主环境：`SHELL`/`NIBI_SHELL` = `filesDir/runtime/bin/bash`（没有运行时则
  `/system/bin/sh`）；`PATH` = `$NIBI_BIN:/system/bin:/system/xbin`。

### 运行时布局

```
jniLibs/arm64-v8a/        # 只能扁平 lib*.so；可 exec
  libbash.so libbusybox.so libgit.so libgit_remote_http.so
  libnibi_run.so libnibi_hook.so
filesDir/runtime/
  bin/                    # symlink -> nativeLibraryDir（bash/busybox/git/nibi-run + 377 applets）
  git-core/               # symlink（151 个 git 内建/helper）+ git-sh-setup 等脚本
  hooks/                  # symlink -> libnibi_hook.so（core.hooksPath）
  share/git-core/templates/
  etc/bash_env.sh         # BASH_ENV：command_not_found_handle + busybox 函数
  terminfo/               # 构建机有 tic 时生成（xterm/screen/linux）
assets/nibi-runtime.{zip,json}  # 由构建脚本生成，不进版本库
```

- 构建：`node scripts/android-runtime/build.mjs`（Linux 或 WSL + NDK r27b）。源码版本/URL/
  sha256 在 `scripts/android-runtime/sources.json`；构建后 fail-closed 校验 ELF 身份、
  `PT_INTERP=/system/bin/linker64`、16 KB LOAD 对齐、API 24 符号面、清单/zip 形状。
  CI：`.github/workflows/android-runtime.yml`。
- 安装：`NibiRuntime.install()` 按 `version` 解包 assets，再重建全部 symlink（APK 升级后
  nativeLibraryDir 会变）；失败只回退 `/system/bin/sh`，不阻塞内核。
- 打包：`app/plugins/withAndroidLegacyPackaging` 固定 `expo.useLegacyPackaging=true`，
  APK 里 `extractNativeLibs="true"`；否则 jniLibs 不会被解压到可执行目录。
- git：受管全局配置 `runtime/etc/gitconfig`（`GIT_CONFIG_GLOBAL`）提供默认身份
  `NIBI-GO <nibi-go@localhost>`、`include ~/.gitconfig` 与 `core.hooksPath=runtime/hooks`；
  不写用户的 `~/.gitconfig`，仓库级配置（husky 等）优先级更高。`nibi-hook` 按 `argv[0]`
  找仓库 `.git/hooks/<name>`，再交给 `nibi-run`。
- HTTPS：随包 Mozilla CA bundle（`etc/cacert.pem`，sha256 固定）+ `GIT_SSL_CAINFO` /
  `CURL_CA_BUNDLE` / `SSL_CERT_FILE`；Android 系统 CA hash-dir 在 OpenSSL 3.5 下不可用。
- `nibi-run`：shebang（bash/node/python）、`$NIBI_BIN`/git-scripts/`$NIBI_PACKAGES`/PATH
  查找、npm `.bin` 入口（含 `$NIBI_BIN/<name> -> nibi-run` 自身跳过）；App 数据 ELF
  明确拒绝（Android 16 noexec），给出可操作错误。

真机验证（2026-11-15，PHK110 / Android 16，`run-as` + App uid）：

- `bash 5.2.37`、`busybox 1.36.1`、`git 2.51.0` 均可执行；管道与 busybox applet 正常；
- `git init/add/commit` 触发 pre-commit → dispatcher → `nibi-run` → 仓库 hook 成功；
- `#!/bin/bash` 脚本经 `nibi-run` 执行成功；`#!/usr/bin/env node` 在 Phase 3 前报
  “node 不可用”（rc 127）；App 数据 ELF 被拒并给出原因（rc 126）。
- **50 命令矩阵通过（2026-11-16）**：shell 基础/管道/重定向/数组/正则/here-string、
  busybox（grep/sed/awk/find/xargs/tar/gzip/diff/cmp/stat/df…）、git
  init/add/commit/log/branch/merge/tag/diff/show/ls-files/remote、本地 clone、
  `git submodule`/`filter-branch` 脚本命令、`script.sh`、两类边界。矩阵抓到并修复了
  `busybox awk` 的 clang 18 `BB_GLOBAL_CONST` 误编译（`build.sh` 的
  `CONFIG_EXTRA_CFLAGS="-DBB_GLOBAL_CONST="`）。
- **HTTPS clone 通过（2026-11-16）**：`git ls-remote https://gitee.com/mirrors/git.git`
  与 `git clone --depth 1 https://github.com/octocat/Hello-World.git` 成功；身份来自受管
  `GIT_CONFIG_GLOBAL`，CA 来自随包 bundle。npm `.bin` 的 symlink→bash 入口可跑，
  `#!/usr/bin/env node` 报 Phase 3 边界。
- **App 启动路径已验（2026-11-16）**：`:kernel` 服务启动时 `NibiRuntime` 安装/建链/写受管
  gitconfig；App 内 mock 模型 → Bash 工具 → 审批 → 真实输出
  `SHELL=…/runtime/bin/bash`、`BASH_VERSION=5.2.37(1)-release`、
  `pwd=/data/data/top.nibistudio.nibigo/files`。该轮修掉两个集成问题：`KernelService`
  漏接 `NibiRuntime`；bash 交叉编译链接了自带的 getcwd 替代实现
  （`bash_cv_getcwd_malloc=yes` 后改用 libc getcwd）。
- 未完成：npm `.bin` 重写安装器（随 Phase 3 的 node）。

## 语言运行时（D25 Phase 3，Python + Node 已完成）

- **Python 3.13.18（自建，非 Termux）**：`scripts/android-runtimes/build-python.sh` 用宿主
  Python + NDK 交叉编译；libffi/zlib/OpenSSL 均自建。jniLibs 里是
  `libpython_bin.so` + `libpython3.13.so` + `libffi.so`（strip 后约 5.3MB），stdlib +
  pip 在 `assets/nibi-langs.zip`（约 13MB，解压后 `filesDir/runtime/python`）。
  `NibiRuntime` 设置 `PYTHONHOME` / `PYTHONUSERBASE` / `LD_LIBRARY_PATH`（nativeLibraryDir，
  仅语言运行时进程需要），并建 `python3`/`python`/`pip`/`pip3` 链接。
  真机通过：`python 3.13.18 + OpenSSL 3.5.4`、`ssl/zlib/ctypes`、`pip 26.2.2`、
  `pip install requests`、`pyfiglet` console script。
- **Node 24.22.3（自建）已完成**：`scripts/android-runtimes/build-node.sh` +
  `patch-node.py`；`libnode.so` strip 后 91MB（NEEDED `libc++_shared.so`，APK 已带），
  npm 11.19.1 在 `assets/nibi-langs.zip`（解压后 `filesDir/runtime/npm`）。
  - 补丁要点：gyp 的 host 工具集依赖 `CC_host/CXX_host` 环境；宿主 mksnapshot 需要
    arm64 模拟器的 trap handler/simulator 源文件（只对 `_toolset=="host"` 打开，
    target 保留 Android 禁用）；Android 链接加 `-Wl,-z,max-page-size=16384`。
  - `nibi-run` 把 `node_modules/.bin/<name>` 换成指向自己的 symlink，真身存
    `.bin/.nibi-targets/<name>`；从 argv[0] 目录或 cwd 向上找
    `node_modules/.bin/.nibi-targets`，`npm run` 的 `.bin` 命令因此可执行。
  - 真机：`node v24.22.3`、`npm 11.19.1`、`npm install`、`npm run`（cowsay）、
    `require('./hello.node')`（N-API 42）、`#!/usr/bin/env node` 脚本均通过。
  - **App 内 Bash 工具**：内核子进程环境是白名单投影；白名单里补了
    `LD_LIBRARY_PATH`/`PYTHONHOME`/`PYTHONUSERBASE`/`NIBI_*`/`NPM_CONFIG_*`/`GIT_*`
    （不含 `NIBI_API_KEY`/`NIBI_MODEL_*`）。真机一次调用返回
    `v24.22.3 / 11.19.1 / Python 3.13.18 / git 2.51.0 / NIBI-GO`。
  - **不采用 Termux 预编译包**（供应链可控性）。

## 真机结果（2026-11-15，OnePlus PHK110 / arm64-v8a / Android 16）

- `libnibi.so` / `libnibi_kernel_jni.so` 加载成功；`abiVersion()` = v1；`start() → true`。
- 第一帧 `startup/storageState` 已按 LF 切帧送到 JS：**dlopen、JNI、线程、切帧全部成立**。
- 随后内核自己退出：`configuring network egress: … rustls-platform-verifier could not load
  extra certs`。Android 平台信任库需要 JVM + Context，C ABI 目前没有传入口 →
  上游票据 `docs/tickets/T8-android-platform-tls-trust.md`。
- 该轮暴露并已修：Kotlin `Sink` 必须用 `ByteArray` 与 JNI 的 `([B)V` 对齐（用 `String` 会
  `NoSuchMethodError` 直接 abort）；`libnibi.so` 无 SONAME，导入目标会把 `DT_NEEDED` 记成
  构建机绝对路径（改为 `-L` + `-l`）。

## 尚未做（后续切片）

1. ⑤ FGS 策略：`dataSync` 的 6h/24h 上限（长任务 `specialUse`/分段）+ `POST_NOTIFICATIONS`
   运行时请求 + panic 看门狗细化。
2. iroh NDK 与内核共享底座。
3. 产物体积治理：`libnibi.so` 36.9MB + `libc++_shared.so` 1.8MB（arm64 单 ABI）。

## 为什么不写 Rust 薄层

JNI 薄层继续用 C + NDK CMake：Android 构建链里本来就有 NDK/CMake，C 侧只做函数指针桥接与
字节搬运；不为了一个薄层再加 cargo-ndk 目标。D24 后内核 Rust 构建链已在 `kernel/`，
JNI 薄层仍保持 C，与内核构建解耦。
