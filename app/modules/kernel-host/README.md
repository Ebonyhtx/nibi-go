# app/modules/kernel-host（Phase C · C0 已开工）

> 2026-11-14 上游 T6/T7 已交付（nibi-client `697f86cf`），`@nibi-studio/cli-android-arm64@4.1.0`
> 带 `lib/libnibi.so`（C ABI v1，目标 API 24）与 `build.json.artifacts`。本目录从占位转实现。

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

内核本体不在这里：D17 单向消费，`.so` 来自 npm 平台包；版本由 `scripts/android-kernel/pin.json` 锁定。

## 构建

```bash
node scripts/android-kernel/fetch.mjs          # 按 pin 拉包 + 校验 sha256/ELF/API，落盘 jniLibs
node scripts/android-kernel/fetch.mjs --check  # 只校验已落盘产物（CI/构建前）
cd app/android && ./gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a
```

校验是 fail-closed：`build.json.artifacts` 逐项 sha256、ELF64/AArch64/shared object、
`.note.android.ident` 的 API level ≤ App minSdk（24）、**ELF `LOAD` 段 16 KB 对齐**
（`0x4000`，否则 16 KB 页设备装不上；D22），任何一项不过就不落盘。

> 4.1.0 的 `libnibi.so` 实测是 4 KB 对齐，**不满足 D22**；在上游发 16 KB 的预发布/正式包之前，
> `fetch.mjs` 会拒绝它。JNI 薄层自己的 `libnibi_kernel_jni.so` 由 CMake
> `target_link_options` 对齐到 16 KB。

> 注意：AGP 打包时会 strip `.so`，所以**APK 里的 libnibi.so 与落盘文件 sha256 不同**（实测
> `956a865b…` → `0896c9c9…`）。校验只对「落盘前的包内原件」有意义，别拿 APK 内容去对
> `build.json`。

## 运行契约（来自 nibi-client `docs/android-cdylib-abi.md`）

- 内核在 `start` 时**只读一次**进程环境：模块在 `start()` 前 `setenv`
  `HOME` / `NIBI_DATA_BASE_DIR`（都指向 App 私有 `filesDir`）与 `TMPDIR`（`cacheDir`）。
  `cwd` 是进程级的，Android 上仍是 `/`（只读不写；目前不改）。
- 输出回调在内核线程上调用，`data` 仅当次有效：JNI 层立即复制并按 LF 切成完整行，
  再转成 UTF-8 字符串交给 JS（JSON 行内不会出现裸 LF）。
- 一个进程只允许一个实例；`destroy()` 等待内核线程退出，`OnDestroy` 里兜底调用。
- 内核 panic 会带走 App 进程（`panic=abort`）——看门狗/前台服务待后续切片。

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

## Android shell 桥（T9 临时方案）

内核的 shell 发现只认路径里含 `bash`/`zsh` 的可执行文件，Android 只有 `/system/bin/sh`（mksh）。
宿主在 App 私有目录建 `bin/bash -> /system/bin/sh`，并设 `SHELL` / `NIBI_SHELL` /
`PATH=<files>/bin:/system/bin:/system/xbin`（进程内模块与 `:kernel` Service 的
`prepareEnvironment` 都做）。不随包带可执行文件。

- 已验证：`echo nibi-shell-ok | tr a-z A-Z` → `NIBI-SHELL-OK`，Bash 工具 `success`。
- 局限：语义是 mksh 不是 bash（bashism/`[[ ]]`/数组等可能失败）；hook 固定 `/bin/bash` 仍不可用。
- **D24/D25 后**：正式方案 = 内核 fork 的 `ShellDialect::AndroidSh` + 随包三件套
  （jniLibs + `$NIBI_BIN` symlink，见 `docs/design/android-native-runtime.md`）。本桥是
  Phase 1/2 前的过渡，落地后移除；T9 保留为证据记录。

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
