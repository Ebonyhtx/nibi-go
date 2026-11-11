# AGENTS.md — NIBI-GO 开发规则

NIBI-GO 是 NIBI 生态的移动客户端：**双形态**（NIBI-WORK 远控投影 + NIBI-GO 本机 AGENT）。本文件是 AI/开发者进入本仓的第一入口；架构决策见 `docs/decisions/`，调研底稿见 `docs/research/`。

## 仓库定位与边界

- 本仓只含 **App 侧代码**（RN/Expo 壳、纯 TS 协议层、Kotlin 原生模块）。
- **Rust 内核不属于本仓**：内核真源在 `nibi-client/kernel/`（自包含、独立 npm 分发 `@nibi-studio/cli-*`）。本仓通过**锁定的 npm 平台包**消费内核（D17 单向消费），不 fork、不开长期分支、不养 Rust 构建链（`modules/kernel-host/rust/` 仅存放 JNI 薄层的构建脚本，内核本体版本由 lockfile 锁定）。
- **GO 插件生态与桌面插件体系彻底隔离**（D13）：本仓的市场、manifest、原生 UI 协议（nibi-go-native-ui）不引用桌面体系任何内容。WORK 形态的桌面插件管理是投影（IPluginManagementService 手机合同），不算耦合。

## 目录契约

| 路径 | 职责 | 禁止事项 |
|---|---|---|
| `app/` | RN/Expo 壳：导航、主题、l10n、屏幕 | 不得 import 内核/平台细节，只能走 packages 接口 |
| `packages/relay-client/` | Relay V2 terminal 客户端（纯 TS，无 UI） | 禁止 import react-native 任何内容（保 Node 可测 + 跨平台保险 D11） |
| `packages/chat-core/` | 聊天状态机（V4 事件 reducer、replay、审批状态机，纯 TS） | 同上；这是 UI 框架可替换的退出保险（D12 反思条款） |
| `packages/phone-tools/` | 手机工具面 TS 接口 + 平台适配器注册 | **多平台适配器设计**（D11）：接口层不得出现 Android 专属类型 |
| `modules/kernel-host/` | 模块 C 的内核绑定（JNI 薄层 + 构建脚本） | 不修改内核源码；内核变更走 nibi-client 票据（D17） |
| `docs/decisions/` | 架构决策记录（D1–D17 编号制） | 决策变更须新文件记录，不覆写历史决策 |
| `reference/` | 上游参考仓（本地可选，已 gitignore，公开仓不含） | **不编译、不执行、不参与本仓构建**；仅 git pull 更新 |

## 硬规则

### 内核消费纪律（D17）

1. 内核依赖 = `@nibi-studio/cli-android-arm64` 的**精确版本**（无 `^`/`~`），升级 = 显式提交 + 台账记录。
2. 发现内核缺能力：**开票据到 nibi-client**（issue），不自行改内核、不开分支。紧急走第 3 级分支过渡时必须 git 依赖锁 commit，且台账记录。
3. 主线永远不等 GO：任何"内核需要为 GO 改"的想法，先想"App 侧能不能解决"。

### 协议层纪律（D11/D12 反思条款）

4. `relay-client` / `chat-core` 与 UI 框架的隔离从**第一个 commit** 执行——它们只能依赖纯 TS（`@nibi/shared` 抽取件、zod、WebSocket、WebCrypto 接口）。
5. crypto 走 `Cipher` 接口抽象（密文格式 XChaCha20-Poly1305 三平台一致，实现可换）。
6. 对 `@nibi/shared` 的复用方式（2026-11-11 定案：**选 B 抽取件**）：类型与契约**只经 `packages/shared-extract/`** 引用——抽取时标注来源 commit（nibi-client dev）、不改写语义；升级 = 对比上游 diff → 逐文件决定抽取/跳过（跳过的登记）→ 跑契约测试 → 更新来源标注。禁止本仓代码直接 import nibi-client 的 `packages/shared`。

### 双形态纪律（D2/D13）

7. 两形态的会话、插件、市场互不引用；WORK 形态只做投影，GO 形态只认 GO 生态。
8. 手机工具面（`phone-tools`）是 App 原生能力，接口按多平台适配器设计；Android 实现放 `modules/`，接口层零 Android 类型。
9. 用户数据不越形态：GO 形态数据不出机（沙箱第 1 层），插件依赖不逃出插件目录。

### 验证纪律

10. 每个功能模块提交前：`relay-client`/`chat-core` 的测试必须能在 Node 环境跑通（不带 RN 运行时）。
11. E2E 加密信封（D9）与 Relay 客户端的契约测试直接复用 `@nibi/shared/testing/fake-relay-v2`。
12. 真机验证不可替代的项（无障碍、jniLibs spawn W^X、iroh 连接迁移），提交说明里明确标注"未在真机验证"及原因。

### Git 与安全

13. 不 `git add .`/`-A`；只暂存明确路径。
14. 凭据/令牌永不进对话、日志、备份、插件目录（license token 纪律，D16）。
15. 未要求不 commit、不 push。

## 命令

```bash
pnpm install                # 安装依赖
pnpm -r test                # 全部测试（relay-client/chat-core 须 Node 可跑）
pnpm --filter relay-client test   # 单包
pnpm --filter chat-core test
node scripts/check-boundaries.mjs # 架构门禁：层间依赖白名单检查
```

（RN 侧 `app/` 的开发命令在 Expo 骨架落地后补充。）

## 现状与路线

- **Phase A**（NIBI-WORK 远控客户端）：进行中——骨架已提交（84a95b5），relay-client 草案待评审后开工 A1。
- **Phase C**（本机内核）：挂起，启动信号 = 主线 kernel 对齐批次收尾 + `@nibi-studio/cli-android-arm64` 发布（D12 修正）。
- **Phase B**（WORK 形态手机操控路由，nibi-phone-bridge）：最后。
- 决策台账 D1–D17 见 `docs/decisions/`；架构总览可视化见 `docs/NIBI-GO架构总览.html`。
