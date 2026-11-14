# 票据 · Android 进程内内核的 TLS 信任锚初始化

> 状态（2026-11-15）：**S1 已实现并真机验证**（上游分支 `feat/android-kernel`，`2aa2d6d9`：
> Android 平台根不可用时退内置 Mozilla 根，egress 不再致命）；**S2（attach JVM/Context、
> 恢复平台根）待做**。正式发版后 GO 切回稳定 pin（D21）。
>
> 提交方：NIBI-GO 仓库。Phase C C0「内核上机」真机冒烟时发现；**不催主线排期**——何时做由你定。
> 期望载体：nibi-client 仓 `kernel/crates/net/`（信任锚构造）+ `kernel/crates/cli/src/android_ffi.rs`（入口面）。

## 现象（2026-11-15 真机实测）

设备：OnePlus PHK110 · arm64-v8a · Android 16（SDK 36）· App `top.nibistudio.nibigo`（debug）。
内核：`@nibi-studio/cli-android-arm64@4.1.0`，C ABI v1，进程内 dlopen。

冒烟结果：

1. `libnibi.so` / `libnibi_kernel_jni.so` 加载成功（`nativeloader: ... ok`）；
2. `nibi_app_server_start()` 返回非 NULL，`start() → true`；
3. 第一帧已按 LF 切帧送达宿主：
   `{"method":"startup/storageState","params":{"schemaVersion":1,"attemptId":"…","sequence":1,"databaseId":"…","databaseKind":"session","phase":"checking","elapsedMs":0}}`
4. 随后内核线程退出并回调错误：

```
kernel app-server stopped with an error: configuring network egress:
invalid network policy: invalid request: builder error:
rustls-platform-verifier could not load extra certs
```

也就是说：**进程内运行形态本身成立**（JNI、线程、切帧、协议首位都对），卡在启动序列里的
网络出口构造——`TrustRoots::Platform` 在 Android 上要经 `rustls-platform-verifier` 读平台信任库，
而 cdylib 里拿不到 Android 的 JVM / Context，构造失败，app-server 直接退出。

## 现状证据（2026-11-15 逐条核实，nibi-client `dev`）

- 错误链：`kernel/crates/cli/src/main_setup.rs:84` `.context("configuring network egress")`
  → `kernel/crates/net/src/error.rs:11` `invalid network policy: {0}`
  → reqwest builder error `rustls-platform-verifier could not load extra certs`。
- 信任锚：`kernel/crates/net/src/roots.rs:86-110` `TrustRoots::Platform`（缺省）= 内置 Mozilla 根
  + 平台根（reqwest `tls_certs_merge`）；`:91` 注释写明「内置的 Mozilla 根证书加平台根证书
  （rustls-platform-verifier）」。
- 依赖：`kernel/Cargo.lock:2998-3019` 有 `rustls-platform-verifier` 与
  `rustls-platform-verifier-android`（传递依赖）。
- C ABI（`kernel/crates/cli/src/android_ffi.rs`）目前只有
  `abi_version / start / send / stop / destroy`，**没有给宿主传 JVM 或 Android Context 的入口**。

## 需求（消费诉求口径）

`.so` 在 App 进程内运行时，信任锚必须能按下面任一方式成立（选哪种由上游定）：

1. **首选：给宿主一个初始化入口**。例如在 C ABI 增加
   `nibi_app_server_attach_android(JNIEnv *env, jobject app_context)`（或等价形态），
   内核在构造 egress 之前调用 `rustls_platform_verifier::android` 的初始化（`init_external` /
   `init_hosted`，按你的依赖版本），之后 `TrustRoots::Platform` 正常合并「内置根 + 平台根」。
   GO 侧 JNI 层已经有 `JNIEnv*` 与 `applicationContext`，可以直接传；不需要上游写任何 Android
   宿主代码。
2. **备选：Android 缺省只用内置根**。平台信任库不可用时不当作致命错误，退回
   `Anchors::Only(bundled)` 并打一条 warning；等宿主调用初始化入口后再启用平台根。
   代价：Android 上用户安装的 CA / 企业代理证书默认不生效，需要文档写清。

两种都要：**非 Android 平台行为逐字不变**（桌面/CLI 仍用平台校验器 + 内置根）。

## 边界承诺（对 GO 侧）

- GO 不 fork 内核、不加本地补丁（D17）；本票只描述消费诉求与实测现象。
- 入口命名、传参形态（JNI 直传还是泛化的 `void *env, void *context`）、初始化时机都由上游定；
  GO 的 JNI 薄层照实现包一层即可。
- 若上游选备选方案，GO 侧不额外做事（只要 egress 构造不再 fatal）；若选首选方案，GO 在
  `start` 前调用一次 attach。

## 验收

- Android 真机（arm64，API ≥ 24）：`nibi_app_server_start` 之后 egress 构造成功，
  app-server 不再以 `configuring network egress` 退出；协议能继续往下走。
- 公开 HTTPS（如模型端点）用内置根可通；若实现了平台根初始化，用户安装的 CA 也能生效
  （可用自签 CA + 系统安装验证）。
- 桌面 / Linux / macOS 的信任锚行为与测试逐字不变（`egress_tests.rs` 全绿）。

## 背景

- 上游 T6（`697f86cf`）交付了 `lib/libnibi.so` 与 C ABI v1；本票是 C0 真机冒烟发现的第一个
  Android 专属缺口，与 cdylib 形态本身无关（dlopen / 线程 / 协议帧都已验证通过）。
- 参考：`docs/android-cdylib-abi.md`「宿主前置」一节目前只要求环境变量与 cwd，没有平台上下文。
