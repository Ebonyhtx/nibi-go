# modules/kernel-host（模块 C，待启动）

> 启动信号见 `docs/decisions/ADR-INDEX.md` D12：主线 kernel 对齐批次收尾 + `@nibi-studio/cli-android-arm64` 发布。在此之前本目录只有占位与设计笔记，**不写实现**。

## 职责（届时）

- `android/`：前台服务拉起内核（进程内 libnibi.so，app-server 形态）+ stdio 桥
- `rust/`：JNI 薄层构建脚本（**不是内核本体**——内核以 npm 平台包产物消费，D17）
- 内核 spawn 的 Node Plugin Runtime（jniLibs 可执行 Trick）供 MCP server 插件用（D13.2）

## 待 spike（各约 1 天）

1. jniLibs spawn 的 W^X 合法性 @ targetSdk 36（Node 方案唯一技术风险，Termux 高 targetSdk 解法可抄）
2. 内核进程内运行稳定性（panic=abort + 看门狗 + rusqlite 并发）
3. iroh Android NDK（与 libnibi.so 共享 Rust 底座构建脚本）
