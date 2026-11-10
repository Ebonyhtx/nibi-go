# 移动端 AI Agent 同类项目调研汇报

> 调研日期：2026-11-07 · 数据来源：GitHub API（实时星数）、DeepSeek 官方搜索、项目官方 README 原文抓取
> 参照系：dsh-Go（13281★，本仓库调研对象）

## 核心发现：上一轮 GitHub 首搜严重低估了 DSH 移动端生态

用 "deepseek harness mobile/android" 精确检索后，发现了**一个完整的 DSH 安卓生态**——至少 10 个独立项目在做"把 DSH 装进手机"，其中 DSHA 已到 3,116★。dsh-Go 并不是唯一的"DSH 手机版"，而是这个生态里**工程最重、定位最高端**的一个。

---

## 一、DSH 引擎生态的移动端项目（直接同类）

### 1.1 本机运行型（同 dsh-Go 的"内核"路线）

| 项目 | ★ | 语言/许可 | 架构 | 与 dsh-Go 的差异 |
|---|---|---|---|---|
| **[DSH-APP/DSHA](https://github.com/DSH-APP/DSHA)** | **3,116** | Java / MIT | proot + 完整 Ubuntu 24.04 rootfs（278MB APK）+ Node 24 + DSH 0.2.1-rc.2；**UI 是原生 Android（Material3），浏览器只用内嵌 WebView** | 最接近的竞品。设备能力比 dsh-Go 更广（传感器/定位/短信只读/手电筒），数据备份体系（v5 .tar.gz 导出/换机恢复/凭据不进备份）比 dsh-Go 细；但无 Flutter 原生聊天界面（靠 WebUI 移动适配 + 悬浮条），无伴侣/宠物这类产品化功能 |
| **[jackwener/DSH-Android](https://github.com/jackwener/DSH-Android)** | 854 | Kotlin / Apache-2.0 | **"引擎内嵌 App 进程"**（不是 proot 容器）+ 读屏操作 + 改系统设置 + 定时自动化 + 可选 Shizuku | 唯一宣称不走 proot 的——把 Node/DSH 以 bionic 兼容方式内嵌，轻量但环境完整性受限 |
| **[WSK-build/DSHBox](https://github.com/WSK-build/DSHBox)** | 561 | Kotlin / GPL-3.0 | "完整 DSH 工作台"，本机运行 + 内嵌 WebUI 全屏对话 | GPL-3.0 与 dsh-Go 同源许可；功能面较窄 |
| **[Soodok/Deepseek-Harness-Local-Android](https://github.com/Soodok/Deepseek-Harness-Local-Android)** | 489 | Kotlin / MIT | 本机运行 + **扩展中心**（插件中心） | — |
| **[Tongyu3/Tdsh-DSH-Mobile-Android-NO-ROOT](https://github.com/Tongyu3/Tdsh-DSH-Mobile-Android-NO-ROOT)** | 180 | Java | 一键 APK + 无障碍操作 | — |
| **[dphmoblie/deepseek-harness-android](https://github.com/dphmoblie/deepseek-harness-android)** | 107 | Kotlin | Ubuntu 运行环境 + 插件/文件管理 + Shizuku/无障碍 | — |
| **[itiswdwa/dsh-android](https://github.com/itiswdwa/dsh-android)** | 31 | Java | WebView + Ubuntu Proot | — |
| **[pht88888888/DSHAPP](https://github.com/pht88888888/DSHAPP)** | 76 | JavaScript | **Termux 内核**跑 Node + DSH + WebView 官方 GUI（"Termux 派"） | DSHA README 里点名的两条路线之争的另一方 |
| **[sunflower2333/dsh-android](https://github.com/sunflower2333/dsh-android)** | 28 | JavaScript | DSH 自包含离线安装包（完整依赖树 + 预编译原生模块，Termux 专用） | — |

### 1.2 移动客户端/远程型（同 dsh-Go 的"遥控"路线）

| 项目 | ★ | 语言/许可 | 定位 |
|---|---|---|---|
| **[saya-ch/dsh-mobile](https://github.com/saya-ch/dsh-mobile)** | 786 | TypeScript / Apache-2.0 | **安全移动访问插件 + Android App**：局域网/多远程通道、iPhone/iPad PWA、网页推送、设备管理——dsh_remote 包的同类 |
| **[Clarklevis1995/dsh-mobile](https://github.com/Clarklevis1995/dsh-mobile)** | 744 | Kotlin / MIT | 原生 iOS 客户端（经 dsh-plugin-mobile-gateway WebSocket），带执行轨迹，延续官方 WebUI 视觉 |
| **[sorsama/deepseek-harness-mobile](https://github.com/sorsama/deepseek-harness-mobile)** | 267 | Kotlin | Android 伴侣端：聊天/目标/审批/通知，局域网，Jetpack Compose |
| **[zexadev/dsh-tether](https://github.com/zexadev/dsh-tether)** | 95 | JavaScript / MIT | **iroh 点对点**远程访问（无服务器，中继只见密文）；Android 端也能本机跑 dsh |
| **[hongshuxifan321/dsh-mobile-app](https://github.com/hongshuxifan321/dsh-mobile-app)** | 108 | JavaScript | DSH Remote 安卓客户端 |

### 1.3 手机操控插件型（同 dsh-Go 的"手机操控"子系统）

| 项目 | ★ | 形态 | 机制 |
|---|---|---|---|
| **[kunjinkao-os/dsh-mobile-gui-agent](https://github.com/kunjinkao-os/dsh-mobile-gui-agent)** | 12（8 月已停更） | **纯 DSH 插件**（npm 包，跑在电脑 DSH 上） | ADB + UIAutomator：observe→decide→act→verify 循环、元素 stale 校验、语义控件审批（发送/支付/删除必须 Harness approval）、ADB Keyboard 透明启停做 Unicode 输入。**模型拿不到原始 XML 和任意 shell** |
| **[AcidGr/dsh-preset-mobile-use](https://github.com/AcidGr/dsh-preset-mobile-use)** | 95 | DSH preset 插件 | Android 自主后台 headless 控制 |
| **[ZSeven-W/dsh-android](https://github.com/ZSeven-W/dsh-android)** | 220 | DSH 插件 | 在对话里驱动**模拟器/USB 设备直播流**（纯 adb） |
| **[Tony-Chen-Stark/dsh-pet-android](https://github.com/Tony-Chen-Stark/dsh-pet-android)** | 114 | 独立 App | dsh-pet 悬浮桌宠移植（106 段透明动画、甩抛物理），无 AI 不联网 |

> 值得注意：dsh-mobile-gui-agent 的"元素重校验 + 语义审批 + 不给任意 shell"安全设计与 dsh-Go 的 ScreenVerdict/SafetyGate 高度同源——说明这已成为社区共识级的安全范式。

---

## 二、DSHA 深度画像（最强竞品，值得单独看）

来源：GitHub README 原文 + NodeLoc 发布贴。

- **定位**："DeepSeek Harness 安卓启动器"——和 dsh-Go 同解一个问题，但**走"容器 + WebUI"而非"容器 + 原生界面"**。
- **双运行时**：默认 proot，可选 **proroot（零 ptrace 开销）**——即 dsh-Go 的 direct 模式的同类物，但 DSHA 把它做成用户可选项且明确声明"实际性能依设备，不作引擎排名"。
- **设备能力面比 dsh-Go 宽**：无障碍读屏/点按/输入（不需 ADB）+ ADB 无线直连（**TLS 1.3-PSK + SPAKE2 配对，免 Shizuku**）+ Shizuku/Root 备用通道 + 实验性虚拟屏 + **传感器/位置/手电筒/短信只读**（逐项授权，默认关）。
- **安全设计亮点**：设备命令**白名单始终开启**（格式化/分区/SELinux 直接拒绝，返回 `[POLICY_BLOCKED]` 而非弹"仍然允许"）；凭据区路径（`.dsh/.ssh/.android`）读写拒绝；API key 进 Keystore AES/GCM；**零遥测**；安全模型文档诚实列出"无内核级沙箱、历史明文备份、签名密钥待轮换"。
- **可靠性工程**：六步安装流水线（只修失败项）、受管更新**试运行**（新环境隔离区真实启动验证后才提交切换）、组件级自检、"Web 起不来直接点名哪个插件"、脚本热更新**离线验签**（公钥内置，签名不符整批拒绝）。
- **诚实披露风格与 dsh-Go 一致**：明确告知 bubblewrap 沙箱在 Android sepolicy 下两边（容器派/Termux 派）都不可用，约束只能靠 DSH 权限档位。
- **生态位**：README 里主动写了"与同类方案的关系"对比表（容器派 vs Termux bootstrap 派）——这个生态的作者们互相知道对方。

## 三、DSH 生态之外的同类项目（上轮已调研，保留结论）

| 类别 | 项目 | ★ |
|---|---|---|
| 本机 Agent（非 DSH 引擎） | [Operit](https://github.com/AAswordman/Operit)（Kotlin，最成熟的自研引擎手机 Agent） | 9,397 |
| | [Mika](https://github.com/wangzan101/Mika)（隐藏后台屏操作 App/网页） | 7,462 |
| | [Eta](https://github.com/Mangi-11/Eta)（系统级直连，越过沙盒） | 2,672 |
| | [OmniBot](https://github.com/omnimind-ai/OmniBot)（终端+Android 双能力） | 2,113 |
| | [Mobile-Harness](https://github.com/techjarves/Mobile-Harness)（"Claude Code on Android"，同样 no-root 容器路线） | 822 |
| 遥控型 | [happy](https://github.com/slopus/happy)（24,526，赛道最大）/ [happier](https://github.com/happier-dev/happier)（2,164，E2E）/ [ccpocket](https://github.com/K9i-0/ccpocket)（1,093）/ [collie](https://github.com/AltanS/collie)（1,597）/ [opencode-mobile](https://github.com/dzianisv/opencode-mobile)（294，已上 F-Droid） | |
| GUI Agent 框架 | [mobile-use](https://github.com/minitap-ai/mobile-use)（3,369）/ [OpenGUI](https://github.com/Core-Mate/OpenGUI)（1,807） | |

## 四、结论

1. **"DSH 手机版"是一个已形成的开源生态，不是 dsh-Go 独一家**：本机运行型至少 8 个（DSHA 3.1k 领跑）、远程客户端型至少 5 个、手机操控插件型至少 4 个，外加 awesome 列表（[awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) 1,322★ / [插件市场索引](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) 369★，收录 11,000+ 插件）和多个桌面端（dsh-desktop 17.5k / DSH Tauri 3.5k）。
2. **dsh-Go 的差异化护城河**：唯一做到「本机引擎 + 远程主机统一为同一个 DshClient 抽象」；唯一有 Live2D 伴侣/桌宠/插件原生协议这类产品层；工程质量（105 补丁供应链钉死、9,232 测试、direct 直启）在该生态内无对标。
3. **DSHA 是最值得对标的竞品**：星数 1/4 于 dsh-Go 但设备能力面更广（传感器/短信/多通道配对）、备份体系更细、proroot 与 dsh-Go direct 模式同思路；短板是无原生聊天界面和插件原生协议。
4. **安全范式已趋同**：语义审批、元素 stale 校验、命令白名单、不给模型任意 shell——dsh-Go / dsh-mobile-gui-agent / DSHA 三家独立实现高度一致，可以视为社区共识。

---
*来源说明：星数与活跃度为 2026-11-07 GitHub API 实时数据；DSHA/dsh-mobile-gui-agent 画像来自官方 README 原文抓取；DSHBox 来自官网；NodeLoc 贴为 DSHA 发布搬运帖。检索过程中 DeepSeek 官方搜索间歇不可用（账户正常，瞬时故障），最终以 GitHub API + deepseek_fetch 抓取原文为主源。*
