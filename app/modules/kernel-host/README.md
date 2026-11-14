# app/modules/kernel-host（Phase C · C0 已开工）

> 2026-11-14 上游 T6/T7 已交付（nibi-client `697f86cf`），`@nibi-studio/cli-android-arm64@4.1.0`
> 带 `lib/libnibi.so`（C ABI v1，目标 API 24）与 `build.json.artifacts`。本目录从占位转实现。

## 结构

| 路径 | 职责 |
| --- | --- |
| `index.ts` | JS 绑定（惰性 `requireNativeModule`，模块/`.so` 缺失时静默降级） |
| `android/src/main/java/expo/modules/nibikernelhost/` | Expo 模块：环境前置、`start/send/stop/destroy`、事件转发 |
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
`.note.android.ident` 的 API level ≤ App minSdk（24），任何一项不过就不落盘。

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

## 尚未做（后续切片）

1. **真机 dlopen 冒烟**：当前无 arm64 设备；CI 只验了 ELF/符号，运行时未验。
2. Host ↔ 内核的协议帧收发（`sendKernelLine` 已通，尚未接协议初始化/工具面）。
3. 前台服务 + 看门狗（panic 兜底）、iroh NDK 与内核共享底座。
4. 产物体积治理：`libnibi.so` 36.9MB + `libc++_shared.so` 1.8MB（arm64 单 ABI）。

## 为什么不写 Rust 薄层

JNI 薄层用 C + NDK CMake：Android 构建链里本来就有 NDK/CMake，C 侧只做函数指针桥接与
字节搬运；再引 Rust 就得加 cargo-ndk 工具链，与本仓「不养 Rust 构建链」的边界冲突
（AGENTS.md）。内核变更仍走 nibi-client 票据。
