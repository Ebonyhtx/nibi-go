# 架构决策记录（ADR）索引

> 决策编号 D1–D17 源自 2026-11-07/08 与 2026-11-11 的架构讨论（对话台账完整版在会话记忆；本文是仓内权威索引）。
> 状态图例：✅ 定案 · 📋 预案（未启动） · ⏸ 挂起待信号

| # | 决策 | 结论 | 状态 |
|---|---|---|---|
| D1 | 引擎选型 | 不用 DSH，自研 Rust 内核（nibi-client/kernel，ZCode-rs fork 0.1.67 → 自有演进）。Android 交叉编译无硬阻塞（已核实：ring android 目标、rusqlite bundled、vendored rg/bfs/ugrep 全源码） | ✅ |
| D2 | 双形态 | NIBI-WORK（远控投影，复用 PWA 形式）+ NIBI-GO（本机 AGENT，UI 独立开发）。App 内切换按钮 | ✅ |
| D3 | 会话关系 | 两形态两份独立列表按 owner 分组；不做任何迁移（含冷交接） | ✅ |
| D4 | WORK UI | 复用现有 PWA 形式原生重画；桌面插件管理 = IPluginManagementService 手机合同投影 | ✅ |
| D5 | 模块 C 本机内核 | libnibi.so 进程内运行（app-server 形态），一层拓扑无 Node Host；会话库与桌面 schema 互认（迁移账本 0024 三方比对） | ✅ |
| D6 | 模块 B 手机执行器 | 方向定了做、最后做。桌面侧 = nibi-phone-bridge MCP 插件（主仓零侵入）。仅 WORK 形态远程路由（GO 形态操控不依赖 B） | ✅ |
| D7 | 二维码职责 | 仅路由提示（sid/mid/name），不承载加密决策，桌面 UI 零变化 | ✅ |
| D8 | 配对模型 | 设备级持久配对：登录+扫一次码；免扫重连，仅过期/删除才重配。deviceId（Keystore 持久 UUID）同时是未来 license dev claim | ✅ |
| D9 | E2E 加密 | 做，密钥藏登录握手（账号身份协商，auth_init.meta 透传）。NIBI-GO↔桌面自动密文；PWA 永远明文；连旧桌面放行+提示未加密；服务端零改动 | ✅ |
| D10 | 连接拓扑 | 四态自动选路：①本地直连 ②打洞直连（iroh，relay 指路）③中转 E2E ④PWA 明文兜底。桌面零新增监听端口（全出站）。控制信令走 Relay V2 WS，数据面自适应 | ✅ |
| D11 | 跨平台前瞻 | iOS/鸿蒙不做但留口：B 工具面多平台适配器接口（iOS 残血=系统限制）、C 平台无关 C ABI、crypto Cipher 接口化。Rust 三平台一级目标 | ✅ |
| D12 | 实施顺序 | **Phase A 先行（立即启动，零内核耦合）；Phase C 挂起**（信号：主线 kernel 对齐批次收尾 + cli-android-arm64 发布）；B 最后。GO 形态手机操控随 A+C | ✅（2026-11-11 修正） |
| D13 | GO 插件生态 | 与桌面彻底隔离，五子项：13.1 独立市场仓 nibi-go-market（npm+PR 双通道、GO manifest、ci-entry 防注入）；13.2 语言层 = Node 24 Plugin Runtime 子进程（stdio MCP）+ 声明式 HTTP；13.3 运行时点名清单 ~75-100MB（bash/busybox/git/Node/py，无 Ubuntu/pnpm/proot）**+ 升级语义 = 管理面/用户面分离**（v1.0.15 先例：升级只替换管理面，用户目录/技能/依赖保留）；13.4 沙箱三层（SELinux 基线/Policy 强翻译/特权 ns 随 B）；13.5 一层拓扑无 Node Host。用户自开发与市场同能力（agent 写→validate→install） | ✅ |
| D14 | 桌宠（预案） | 状态指示器非养成；消费 AgentPulse 投影（A 阶段定义协议）；挂 GO 形态 | 📋 |
| D15 | 伴侣（预案） | 轻量=内核 headless 会话；完整=伴侣 preset 插件；状态存会话库；人设单源 @nibi/shared | 📋 |
| D16 | 付费插件层 | **不启动收费**。4 项无感预留：manifest 占位（拒绝式）/ deviceId（D8 顺路）/ JWT 复用 / market schema 占位。内核门禁主线已建成（PaidPluginGate，2026-11-10）；GO 侧届时补 nibi-platform 的 license 实现。凭据纪律：token 不进插件目录/备份 | ✅ 预留 / 📋 启动 |
| D17 | 内核同步策略 | **单向消费 + 票据制**（替代分支方案）：GO 锁冻结 npm 产物（@nibi-studio/cli-android-arm64，待发布）；缺能力开票据，主线按自身节奏处理；紧急才第 3 级分支过渡（git 依赖锁 commit）。主线永远不等 GO | ✅ |
| D18 | 手机工具面多任务化 | 参考 dsh-Go v1.0.14（121 phone commits）：PhoneToolsAdapter 接口带 taskId 维度（多任务并行各自批准/暂停/停止）；新增 observe（实时后台屏 ≤5fps 只读）、按截图坐标操作（30s 有效+首应用许可）、learn-skill（成功轨迹脱敏→技能）；ML Kit OCR 列可选能力（需披露 SDK 统计收集） | ✅ 设计修订 |
| D15a | 伴侣素材授权 | 先例：dsh-Go v1.0.14 经模型作者授权随 App 分发；第三方模型"AI 辅助适配"只传参数名单不发模型文件（隐私设计，照抄进 D15） | 📋 |

## 附：关键修正记录

- 2026-11-08：D12 曾被写成"条件立项"，用户纠正后撤回（实施顺序由 owner 定）；D16 原方案"桌面决定加不加密"被用户否决，改为密钥藏握手。
- 2026-11-08：两次误判 NIBI 插件体系（三次纠正）；确认 PWA 远控=桌面投影，管理桌面插件是投影的应有能力。
- 2026-11-08：曾把"手机操控随模块 B"写错，用户点破——工具面是 App 原生能力，GO 形态操控随 A+C，B 只做 WORK 路由。
- 2026-11-11：D17 替代分支方案（用户担心分支干扰主线，成立——主线一晚 31 commits/14,766 行 kernel 变更）。

## 决议追加（2026-11-11 · P1–P5 用户拍板）

- P1 ✅ 初始提交 `84a95b5`（身份 Ebonyhtx，GitHub noreply 邮箱）。
- P2/P3a ✅ **选 B：抽取件**——`packages/shared-extract/`（来源 nibi-client dev @ ff1c5f4f；纪律见 AGENTS 规则 6 新版与本包 README；抽取范围表与升级流程已建）。AGENTS 规则 6 已改写。
- P3b ✅ 第一版会话级 K + 重连重协商（device 级 K 轮换等 C 立项再定）。
- P3c ✅ 信封用 JSON 文本帧（维持 relay 契约；B 阶段屏幕流如需二进制帧届时提扩展）。
- P4/P5 ✅ 票据制落地：`docs/tickets/T1`（android 平台包）、`T2`（npm scope 统一）、`HANDOFF.md`（三步交接：票据落仓 → NIBI 工作区 AI 自主复核排期 → GO 被动消费）。主线零干扰。

## 参考仓 pin（本仓调研依据的冻结版本）

| 仓 | 分支 | commit |
|---|---|---|
| reference/nibi-client | dev | `ff1c5f4f`（2026-11-11 复核：无新增） |
| reference/dsh-Go | main | `8f31b2ed`（v1.0.15；2026-11-11 更新） |

更新参考仓 = `git pull` 后在此表登记新 commit；重大变化写 `docs/research/reference-update-<日期>.md`。
