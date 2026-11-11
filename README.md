# NIBI-GO

简体中文 | [English](README.en.md)

NIBI-GO 是 NIBI 生态的**移动客户端**，双形态：

- **NIBI-WORK**：手机远控桌面（Relay V2 端到端通道 + 会话/审批/任务投影）；
- **NIBI-GO**：本机 AGENT（Phase C 挂起，独立 GO 插件生态，不在本仓库范围）。

本仓库是 NIBI-GO 的公开源码（Android 客户端 + 纯 TS 协议层 + 原生模块）。
Rust 内核不在此仓库——它以独立 npm 平台包（`@nibi-studio/cli-*`）单向消费，
详见 [AGENTS.md](AGENTS.md) 的 D17 纪律。

## 开源范围

本仓库包含：

- `app/`：Expo / React Native 应用（登录、扫码配对、连接状态、聊天、审批、通知、保活、应用内更新）
- `app/modules/`：本地 Expo 原生模块（KeepAlive 前台服务、APK 安装器）
- `packages/relay-client`、`packages/chat-core`、`packages/shared-extract`、`packages/phone-tools`：纯 TS 协议层
- `docs/`：架构决策（D1–D18）、设计规格、调研与验证清单
- `scripts/`：架构门禁与公开仓检查

以下内容**不在**本仓库中：

- Rust 内核（`nibi-client` 仓库的独立项目，经 npm 平台包消费）；
- 发布签名材料（keystore）、发布流水线与运营侧服务；
- 任何私有部署细节或凭据（见 [SECURITY.md](SECURITY.md)）。

`reference/` 是开发者本地可选的只读上游参考（已 gitignore，不参与构建、
不属于本仓库）。

## 环境要求

- Node.js **24.22.2**
- pnpm **10.33.2**
- Git

版本以 [mise.toml](mise.toml) 为准。Android 开发另需 Android SDK（platform 35 /
build-tools 35.0.0 / emulator）与 JDK 17；Windows 上的 CMake 短路径要求由
`app/plugins/withCmakeVersion.js` 自动处理。

## 快速开始

```bash
pnpm install
pnpm -r test
node scripts/check-boundaries.mjs
node scripts/check-public-repo.mjs
```

移动端开发：

```bash
cd app
pnpm exec expo start          # Metro（Expo Go）
pnpm exec expo run:android    # dev-client 构建并安装到模拟器/真机
```

登录需要 NIBI 账号中心的 OIDC native app（回调 `nibigo://login`），通过
`EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID` 注入；未配置时登录会明确报错而不是静默退化。

## 仓库结构

| 目录 | 职责 |
|---|---|
| `app/` | Expo SDK 58 应用（`src/app/` 为 expo-router 路由） |
| `app/modules/nibi-keepalive` | 前台服务保活（Spike 2 实测：Android 后台即断，必须前台服务） |
| `app/modules/nibi-updater` | APK 安装器（FileProvider + PackageInstaller，SHA-256 校验） |
| `packages/relay-client` | Relay V2 terminal 客户端：状态机、配对、workspace bridge、E2E 信封 |
| `packages/chat-core` | 聊天状态机：V4 reducer 宿主、replay/gap、审批状态机、AgentPulse |
| `packages/shared-extract` | 从 nibi-client 抽取的协议契约（来源标注，见 [NOTICE.md](NOTICE.md)） |
| `packages/phone-tools` | 手机工具面接口（多平台适配器，Phase B 落地） |
| `modules/kernel-host` | 内核 JNI 薄层（Phase C 挂起，仅骨架） |
| `docs/` | 决策台账、设计规格、调研、清单（入口 [docs/README.md](docs/README.md)） |
| `scripts/` | 架构门禁、公开仓检查、抽取脚本 |

## 开发与验证

```bash
pnpm -r test                        # 全部测试（relay-client / chat-core 在 Node 上跑）
pnpm -r typecheck                   # 类型检查
node scripts/check-boundaries.mjs   # 层间依赖白名单（协议层禁 react-native/expo）
node scripts/check-public-repo.mjs  # 公开仓策略检查
```

提交前至少运行上述命令。公开仓 CI 在 Linux 上运行同一套门禁，不依赖自托管 runner。

## 配置

| 变量 | 用途 |
|---|---|
| `EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID` | NIBI-GO 的 OIDC native app client id（账号中心注册后填入） |
| `EXPO_PUBLIC_NIBI_ENDPOINT_ORIGIN` | 业务/中继端点 origin 覆盖（联调自建环境用） |
| `EXPO_PUBLIC_NIBI_RELAY_WS_URL` | relay ws2 入口覆盖 |
| `EXPO_PUBLIC_NIBI_RELEASE_REPO` | 应用内更新的发布仓（`owner/repo`） |
| `NIBIGO_CXX_STAGING` / `NIBIGO_CMAKE_VERSION` | Android 原生构建目录/CMake 版本覆盖 |

运行时变量通过构建环境显式设置；示例见 [app/.env.example](app/.env.example)。

## 路线

- **Phase A**（当前，代码侧完成）：NIBI-WORK 远控原生客户端。零内核耦合。
- **Phase C**（挂起）：本机内核。启动信号见 [ADR-INDEX D12](docs/decisions/ADR-INDEX.md)。
- **Phase B**（最后）：WORK 形态手机操控路由（nibi-phone-bridge）。

## 参与贡献

- 提交前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 issue。
- 行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- 架构决策与设计文档入口见 [docs/README.md](docs/README.md)。

## 许可证与来源

本项目以 **Apache License 2.0** 发布。`packages/shared-extract/` 的协议契约代码
抽取自 [nibi-client](https://github.com/Ebonyhtx/nibi-client)（Apache-2.0，
commit `ff1c5f4f`）；上游沿革（ZCode v3.16.2）与第三方声明见
[NOTICE.md](NOTICE.md) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
