# 架构决策记录（ADR）索引

> 决策编号 D1–D25 源自 2026-11-07/08、2026-11-11 及后续架构讨论（D18/D19、D20–D25 为后续追加；对话台账完整版在会话记忆；本文是仓内权威索引）。
> 状态图例：✅ 定案 · 📋 预案（未启动） · ⏸ 待启动（等信号）

| # | 决策 | 结论 | 状态 |
|---|---|---|---|
| D1 | 引擎选型 | 不用 DSH，自研 Rust 内核（nibi-client/kernel，ZCode-rs fork 0.1.67 → 自有演进）。Android 交叉编译无硬阻塞（已核实：ring android 目标、rusqlite bundled、vendored rg/bfs/ugrep 全源码） | ✅ |
| D2 | 双形态 | **GO 主体默认（2026-11-13 修订）**：打开即 NIBI-GO（本机 AGENT）主体；NIBI-WORK（远控投影）是 GO 主体内的一个入口，点击才切换；并列双卡切换形态作废 | ✅（2026-11-13 修订） |
| D3 | 会话关系 | 两形态两份独立列表按 owner 分组；不做任何迁移（含冷交接） | ✅ |
| D4 | WORK UI | **同源直接承载（2026-11-13 修订，替代「原生重画」）**：WORK = WebView 承载 PWA/桌面同源 web UI——`@nibi/ui` Root（桌面同一套外壳/任务列表/会话）+ `packages/web/src/web-remote-control/ui/*`（登录卡/选择电脑/ScanPage/连接中/失败页）+ `@nibi/client` transport；原生壳经 `createWebPlatform({ externalWebRemoteControlProxy })`（main.tsx:458 现成接缝）注入平台能力；原生不自绘任何远控屏；桌面插件管理投影随同源 UI 自然获得 | ✅（2026-11-13 修订） |
| D5 | 模块 C 本机内核 | libnibi.so 进程内运行（app-server 形态），一层拓扑无 Node Host；会话库与桌面 schema 互认（迁移账本 0024 三方比对） | ✅ |
| D6 | 模块 B 手机执行器 | **取消**（2026-11-12 重议）。理由：方向反了（手机自动化应由手机上的内核做，即 C）、只能 Android 且无障碍驱动跨厂商很脆、真实场景窄、风险面到账号级。B0 工具面（A11y 服务/执行器/确认卡/悬浮条/多任务 taskId）**移交 C 作为前置**；B1（phone-bridge 插件 + relay 路由 + 市场件）不做。若将来出现「桌面需要读手机内容」的真实需求，只做 share-sheet + 少量显式工具，不做 a11y 坐标驱动的远程操控 | ❌ 取消 |
| D7 | 二维码职责 | 仅路由提示（sid/mid/name），不承载加密决策，桌面 UI 零变化 | ✅ |
| D8 | 配对模型 | 设备级持久配对：登录+扫一次码；免扫重连，仅过期/删除才重配。deviceId（Keystore 持久 UUID）同时是未来 license dev claim | ✅ |
| D9 | E2E 加密 | 做，密钥藏登录握手（账号身份协商，auth_init.meta 透传）。NIBI-GO↔桌面自动密文；**App 内 WORK 经原生隧道（D4 修订后的承载形态）视同原生连接，走同一 E2E 密文（2026-11-13 豁免）**；浏览器打开的 PWA 永远明文；连旧桌面放行+提示未加密；服务端零改动 | ✅（2026-11-13 修订） |
| D10 | 连接拓扑 | 四态自动选路：①本地直连 ②打洞直连（iroh，relay 指路）③中转 E2E ④PWA 明文兜底。桌面零新增监听端口（全出站）。控制信令走 Relay V2 WS，数据面自适应 | ✅ |
| D11 | 跨平台前瞻 | iOS/鸿蒙不做但留口：B 工具面多平台适配器接口（iOS 残血=系统限制）、C 平台无关 C ABI、crypto Cipher 接口化。Rust 三平台一级目标 | ✅ |
| D12 | 实施顺序 | **A → C（B 取消，见 D6）**。A 先行（零内核耦合）；C 待启动（信号：主线 kernel 对齐批次收尾 + cli-android-arm64 发布）；B0 工具面并入 C 前置 | ✅（2026-11-12 修订） |
| D13 | GO 插件生态 | 与桌面彻底隔离，五子项：13.1 独立市场仓 nibi-go-market（npm+PR 双通道、GO manifest、ci-entry 防注入）；13.2 语言层 = Node 24 Plugin Runtime 子进程（stdio MCP）+ 声明式 HTTP；13.3 运行时点名清单 ~75-100MB（bash/busybox/git/Node/py，无 Ubuntu/pnpm/proot）**+ 升级语义 = 管理面/用户面分离**（v1.0.15 先例：升级只替换管理面，用户目录/技能/依赖保留）；13.4 沙箱三层（SELinux 基线/Policy 强翻译/特权 ns 随 B）；13.5 一层拓扑无 Node Host。用户自开发与市场同能力（agent 写→validate→install） | ✅ |
| D14 | 桌宠（预案） | 状态指示器非养成；消费 AgentPulse 投影（A 阶段定义协议）；挂 GO 形态 | 📋 |
| D15 | 伴侣（预案） | 轻量=内核 headless 会话；完整=伴侣 preset 插件；状态存会话库；人设单源 @nibi/shared | 📋 |
| D16 | 付费插件层 | **不启动收费**。4 项无感预留：manifest 占位（拒绝式）/ deviceId（D8 顺路）/ JWT 复用 / market schema 占位。内核门禁主线已建成（PaidPluginGate，2026-11-10）；GO 侧届时补 nibi-platform 的 license 实现。凭据纪律：token 不进插件目录/备份 | ✅ 预留 / 📋 启动 |
| D17 | 内核同步策略 | **单向消费 + 票据制**（替代分支方案）：GO 锁冻结 npm 产物（@nibi-studio/cli-android-arm64，待发布）；缺能力开票据，主线按自身节奏处理；紧急才第 3 级分支过渡（git 依赖锁 commit）。主线永远不等 GO | ✅；**Android 内核部分由 D24 取代（2026-11-15）**，shared 抽取/协议层仍然有效 |
| D18 | 手机工具面多任务化 | 参考 dsh-Go v1.0.14（121 phone commits）：PhoneToolsAdapter 接口带 taskId 维度（多任务并行各自批准/暂停/停止）；新增 observe（实时后台屏 ≤5fps 只读）、按截图坐标操作（30s 有效+首应用许可）、learn-skill（成功轨迹脱敏→技能）；ML Kit OCR 列可选能力（需披露 SDK 统计收集） | ✅ 设计修订 |
| D15a | 伴侣素材授权 | 先例：dsh-Go v1.0.14 经模型作者授权随 App 分发；第三方模型"AI 辅助适配"只传参数名单不发模型文件（隐私设计，照抄进 D15） | 📋 |
| D19 | Android 内核的运行形态与分发载体 | **运行形态 = 进程内 `libnibi.so`（cdylib）**：不 exec 自带的二进制，绕开 targetSdk 36 的 W^X/exec 限制；代价是内核 panic 会带走 App，必须 `panic=abort` + 全局兜底，并新做 JNI host 接口与进程内 transport。**分发载体仍是 npm 平台包**：`@nibi-studio/cli-android-arm64` 的内容从 `bin/nibi-rs` 扩展为 `lib/libnibi.so` + `build.json`（version/target/sha256/ABI 口径不变），GO 构建时拷进 jniLibs；桌面远端执行器继续用同一包里的 `bin/nibi-rs`。子进程形态只作为开发机验证，不进产品路径 | ✅ |
| D20 | 内核的承载进程与重启语义 | **`android:process=":kernel"` 的普通进程 Service**（**不用 `isolatedProcess`**：隔离进程没有网络权限，内核出不了网）。`.so` 与 JNI 薄层都在 `:kernel` 里加载；**控制面走 Binder（AIDL）**，**帧流不走 Binder**（1 MB 事务上限，内核输出是长 JSON 行），用 `socketpair`/`LocalSocket`，fd 经 Binder 的 `ParcelFileDescriptor` 传递。必须定义：Service 的 `START_STICKY`/绑定关系、Binder 死亡回调、重启退避上限、UI 的「内核重启中」状态；恢复口径 = 内核逐条落库 + 宿主重连后请求状态（watchdog 不负责重放）。**实施前提**：协议握手先在单进程跑通，避免同时 debug IPC 与协议。D19 的「不 exec、dlopen 包内 `.so`」不变。这是**新增一个 IPC 契约**，不是顺手改 | ✅ 2026-11-15；**第一片 D20.1 已真机跑通（2026-11-15）**：`:kernel` 普通进程 + Binder 控制面 + `createSocketPair` 帧流 + binder death 退避重连（JS 自动 resume 会话）；**D20.2 也已真机跑通**（`startForegroundService` + `START_STICKY` + `dataSync` 前台服务；只杀 UI 进程时 `:kernel` pid 不变、重开接回同一 pid），默认已切 service；`dataSync` 的 6h/24h 上限与 `specialUse` 归 ⑤ |
| D21 | C0→C1 期间消费上游预发布 | D17「单向消费 + 票据制」的唯一例外：上游在 `feat/android-kernel` 分支开发 Android 平台面，发 **`4.2.0-android.N` + `android-next` dist-tag**，**永不发 `latest`**；GO 的 pin 记录预发布版本与分支 commit；切片合并（每片过五道门：非 Android 三平台产物逐文件一致 / `cargo test --workspace` / Android leg + 符号校验 / 真机验收 / ABI 文档同步）；需确认内核的自动更新路径不会把预发布当最新；上游正式发版后 GO 切回稳定 pin。D17 的「不 fork、不开长期分支」原则不变 | ✅ **历史**；D24 后对 Android 失效（GO 不再消费上游 Android 预发布） |
| D22 | 16 KB page size 打包契约 | 进 APK 的每个 native 库，ELF `LOAD` 段必须 **2^14 = 16 KB 对齐**（Play 对 targetSdk 35+ 的包有此要求，具体生效日期以官方页为准）。落实：上游 `kernel/.cargo/config.toml` 给 `aarch64-linux-android` 加 `-Wl,-z,max-page-size=16384` / `common-page-size=16384` 并在 release workflow 断言；GO 的 JNI 薄层在 CMake 里加同样的 `target_link_options`；GO `scripts/android-kernel/fetch.mjs` 用 `elfLoadAlignment()` 断言 ≥ 16384（**4.1.0 实测 4 KB，不满足，故不用于发布**）。APK 侧另查 `zipalign -c -P 16`（未压缩 `.so` 的 16 KB 对齐） | ✅ 2026-11-15 |
| D23 | ABI 版本与内核升级 | **新增可选导出符号不升 `abi_version`**（老宿主照常工作），只有语义破坏才升；宿主启动时校验自己支持的最低版本，能力差异用查询位表达。内核随 App 发版，**不做热更**（政策与 D17 都不允许）；回滚 = App 降级；完整性靠 `build.json.artifacts` 的 sha256（D19）。C0→C1 期间预发布版本按 D21 消费 | ✅；D24 后 ABI/升级由 GO 自有定义，不再与上游共享节奏 |
| D24 | 内核 fork 到 GO 自维护 | **Android 内核 fork 进 NIBI-GO 公开仓，自包含、自改造**；上游不再为 GO 发 Android npm 包，GO 不再为内核改动向上游提单。GO 自建 `libnibi.so`（D19/D20/D22 保留），Android 原生适配（SH 方言、hooks、环境提示、原生工具）；上游作为只读源按安全/协议能力合并，Android 分支允许持续分叉；D21 对 Android 失效，D23 转为 GO 自有；fork 代码/二进制随包带上游 NOTICE/许可 | ✅ 2026-11-15；**Phase 0 已完成**：快照/构建链/CI/T8 S2 + 桌面 4672 测试 + 真机启动/会话/流式/重连回归；企业 CA 用例待手工 |
| D25 | Android 原生运行时与 targetSdk 36 兼容层 | 三件套（bash/busybox/git）+ Node/Python 进 jniLibs、SHELL 可见；不做 rootfs/PRoot。targetSdk 36 下用 `nibi-run`、npm/npx/pip 包装、git hooks dispatcher、busybox 函数、内核工具重写吸收「App 数据不可 exec」的摩擦；UI 插件走声明式 slots（插件不改外壳）；手机操控两开关（无障碍 / 高级 shell，Shizuku/无线调试引导）；workspace 先定义。硬边界：App 数据 native ELF 不可执行、原生 addon 需 Android 构建、无 root/无别的 App 数据、同 uid 非硬沙箱。正文 `docs/design/android-native-runtime.md` | ✅ 2026-11-15；**实施校正（真机）**：jniLibs 只能扁平 `lib*.so`；App 私有目录 symlink → nativeLibraryDir 可 exec（direct+PATH 已验证），hooks/npm `.bin` 修正见 design §13 |

## 附：关键修正记录

- 2026-11-08：D12 曾被写成"条件立项"，用户纠正后撤回（实施顺序由 owner 定）；D16 原方案"桌面决定加不加密"被用户否决，改为密钥藏握手。
- 2026-11-08：两次误判 NIBI 插件体系（三次纠正）；确认 PWA 远控=桌面投影，管理桌面插件是投影的应有能力。
- 2026-11-08：曾把"手机操控随模块 B"写错，用户点破——工具面是 App 原生能力，GO 形态操控随 A+C，B 只做 WORK 路由。
- 2026-11-11：D17 替代分支方案（用户担心分支干扰主线，成立——主线一晚 31 commits/14,766 行 kernel 变更）。

## 决议追加（2026-11-11 · P1–P5 用户拍板）

- P1 ✅ 初始提交 `394fa7d`（身份 Ebonyhtx，GitHub noreply 邮箱）。
- P2/P3a ✅ **选 B：抽取件**——`packages/shared-extract/`（来源 nibi-client dev @ ff1c5f4f；纪律见 AGENTS 规则 6 新版与本包 README；抽取范围表与升级流程已建）。AGENTS 规则 6 已改写。
- P3b ✅ 第一版会话级 K + 重连重协商（device 级 K 轮换等 C 立项再定）。
- P3c ✅ 信封用 JSON 文本帧（维持 relay 契约；B 阶段屏幕流如需二进制帧届时提扩展）。
- P4/P5 ✅ 票据制落地：T1（android 平台包）、T2（npm scope 统一）、HANDOFF（三步交接：票据落仓 → NIBI 工作区 AI 自主复核排期 → GO 被动消费）。票据与交接已移入内部工程仓（私有）。主线零干扰。

## 附：历史参考仓 pin（2026-11-12 归档前）

> 参考仓已移出本仓，现由维护者在工作区外单独归档；下表是当时的冻结版本，仅作历史对照，不再更新。

| 仓 | 分支 | commit |
|---|---|---|
| nibi-client | dev | `ff1c5f4f`（2026-11-11 复核：无新增） |
| dsh-Go | main | `8f31b2ed`（v1.0.15；2026-11-11 更新） |

重大变化仍可写内部调研记录（私有工程仓）作为历史记录。

- 2026-11-12：**D6 取消（模块 B 不做）**。理由见 D6 行；B0 工具面移交 C 前置，B1 不做；D12 顺序同步改成 A → C。同时新增 D19：Android 内核运行形态 = 进程内 `libnibi.so`，分发载体 = npm 平台包（`lib/libnibi.so` + `build.json`）。
- 2026-11-13：**D2/D4 修订（运营者指正）**。①形态：默认 GO 主体，WORK 只是其中一个入口，并列双卡作废。②WORK UI：不是「原生重画」模仿，是直接承载同源 web UI——源码实证 `packages/web/src/main.tsx:18` 从 `@nibi/ui` 挂载 `Root`（与桌面同一套外壳），main.tsx:480 注释原文「Web 远程控制模式虽然复用了 web UI，但它背后其实挂着 desktop」；main.tsx:458 `createWebPlatform({ externalWebRemoteControlProxy })` 是上游预留的原生壳接缝。原生壳 = WebView 载体 + IPlatformService 桥。Phase A 已建的原生远控屏（work/chat/sessions/devices/scan）退役；relay-client/chat-core/KeepAlive/通知资产按 E2E 方案继续复用。**E2E 已拍板（2026-11-13 当日）：案 A 原生隧道**——连接所有权在原生 RelayTransport（E2E 密文 + 后台通知/保活成立），WebView UI 经 bridge 收发帧流；浏览器 PWA 维持明文；D9 已补 App 内 WORK 豁免；上游注入口立票据 **T7**（web transport 注入口）。
- 2026-11-15：**C0 真机冒烟（OnePlus PHK110 / Android 16 / arm64）**——`libnibi.so` + JNI 薄层加载成功，`abiVersion()`=v1，`start()`=true，第一帧 `startup/storageState` 按 LF 切帧送达；随后内核在 egress 构造退出（`rustls-platform-verifier could not load extra certs`），立票据 **T8**。同日上游分支 `feat/android-kernel` 的 S1（Android 平台根不可用时退内置根）真机验证 `storageState` 走到 `ready`、内核保持运行。**D19 的进程内 dlopen 选择被真机证实成立**；据此新增 **D20（承载进程与重启语义）/ D21（预发布消费）/ D22（16 KB 页对齐）/ D23（ABI 与升级）**。实测 4.1.0 的 `libnibi.so` LOAD 段 4 KB，不满足 D22，故不当发布产物用。
- 2026-11-15：**D24/D25 定案**——Android 内核 fork 进 GO 公开仓自维护（上游不再发 Android npm 包）；Android 原生运行时（jniLibs 三件套 + Node/Python、targetSdk 36 兼容层、声明式 UI slots、双开关手机操控、workspace），不做 rootfs/PRoot。正文 `docs/design/android-native-runtime.md`。

## 待定决策与推进顺序（2026-11-15 定）

> 原则：**只把“这周要动手”的写进 ADR**（本轮 D20–D23），其余留到触发点再定案，避免写过期的预判。

### 推进顺序

> D24/D25 定案后，Android 内核与运行时不再等上游；下列顺序按 D25 的 Phase 走。

1. **第一批 · 已完成**：C0 协议/会话/审批/改动卡/折叠、D20 `:kernel`、D22 16 KB、D20–D23 ADR。
2. **第二批 · 现在**：D24 fork（基线 nibi-client `1369b043`）+ D25 Phase 1 Android SH 方言/hooks；
   ④ 的可执行内容口径随 fork 一起定（D25 已选随包三件套 + Node/Python）。
3. **第三批 · C2 之前**：D25 Phase 2 三件套/`nibi-run`、Phase 3 Node/Python、④ 的插件运行时。
4. **第四批 · 发布前**：Phase 4 UI slots、Phase 5 手机操控、Phase 6 workspace/策略；
   ⑧ 体积/ABI 预算、国内 App 备案、Play FGS 声明。

### 待定项

| 项 | 方向（已达成共识的部分） | 触发点 / 待定 |
|---|---|---|
| ④ 可执行内容边界 | **运行期永不下载可执行代码**；jniLibs 里塞 Node 再 exec 是灰色地带，只作最后手段，优先进程内 JS/WASM。**2026-11-15 真机新增输入**：内核 Bash 工具只认 bash/zsh，Android 只有 `/system/bin/sh`（票据 T9）；GO 已用 `bin/bash -> /system/bin/sh` 临时桥真机跑通管线（不随包带可执行文件），但 bash 语义与 hook 仍需正式方案；**targetSdk 36 可行性已实测**：`useLegacyPackaging=true` 后 jniLibs 可执行 ELF 从 App 进程 exec 成功（无需 targetSdk 28/PRoot），三件套剩体积/许可/Play 审查三项成本；「随包带 bash」正是本条要评估的方案。**D25 已选随包三件套 + Node/Python（jniLibs）**，④ 只剩 Play 政策/许可口径要收 | 与 D25 Phase 2/3 同步定案；插件运行时最晚 C2 前 |
| ⑤ FGS 策略 | `dataSync` 在 targetSdk 35+ 有 6h/24h 上限；长任务走 `specialUse` + Play 声明，或分段续跑。**已落（2026-11-15）**：`POST_NOTIFICATIONS` 运行时请求、`KernelService.onTimeout` 超时主动停内核 + stopSelf | 剩 `specialUse` vs 分段（运营者）+ Play 声明；上架前补 |
| ⑧ 体积/ABI 预算 | 只发 arm64 + App Bundle；**不给模拟器单发 x86_64**（内核只有 arm64，模拟器包只是开发产物） | 发布前；与 D13.3 工具链 75–100MB 叠加时定上限 |
| 国内 App 备案 | 硬门槛（市场不收无备案 App）；侧载 vs 商店二选一 | 发布前，运营者决策 |
| T8 S2 | **attach(JNIEnv*, Context) 后恢复平台根**（企业/用户 CA 在真实环境会碰到）；S1 的内置根只是过渡 | **已实现并真机跑通启动链**（2026-11-15）：attach + 自建 `MergeVerifier` + rustls AAR；企业 CA 信任用例待手工安装验证 |
| D24/D25 实施 | Phase 0 已完成；Phase 1 的 AndroidSh/hooks 已完成并真机验证（Bash 工具与 hook 都经 `/system/bin/sh`），宿主不再建临时 bash 桥；Desktop 4672 测试通过 | Phase 1 剩余：Node/Python/手机模式的环境事实（等 Phase 3/5）→ Phase 2 三件套/`nibi-run` → Phase 3 Node/Python；`.bin`/hooks/dlopen 三个 spike 先做 |

### 记录位置（压缩会话后按这些找回）

- 决策：本文件 D19–D25 + 本节；票据 T8/T9 与 HANDOFF 在内部工程仓（私有）。
- Android 原生运行时/fork 方案正文：`../design/android-native-runtime.md`（D24/D25，含 §13 实施校正）。
- 实施状态与真机结果：`../plan.md`「C0 进展」。
- 协议与架构事实：`../../packages/kernel-session/README.md`。
- 16 KB 落地：`app/modules/kernel-host/android/src/main/cpp/CMakeLists.txt`、`scripts/android-kernel/{build.mjs,lib.mjs}`、
  `kernel/.cargo/config.toml`（D24 fork 后由 GO 自建）与构建断言。
