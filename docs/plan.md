# NIBI-GO 开发计划

> 状态：Phase A **代码侧完成**（A0-A3 手机侧 + Spike 2 + dev-client 构建 + A4 KeepAlive/通知/更新；86 项测试绿）。**公开仓整理完成**：LICENSE(Apache-2.0)/NOTICE/SECURITY/CONTRIBUTING/COC/双语 README、`scripts/check-public-repo.mjs` 门禁（husky+CI 双接入）、CI action SHA pin + 只读权限、本机路径清理。**发布方案已定**（2026-11-11）：分发 = 源码仓 GitHub Releases（A）；签名材料与恢复步骤由运营者在本仓之外的私有运维位置保管（见 `SECURITY.md`）；`scripts/keystore.mjs` / `scripts/release.mjs` / `app/plugins/withReleaseSigning.js` 已落地。上游票据 T1/T2 已落地，T6/T7 上游已完成（`697f86cf`）；剩余 owner 输入：真机验证执行与 Phase C 启动判断。
> 依据：`docs/decisions/ADR-INDEX.md`（D1–D25，权威索引）
> 本计划随决策变更更新；阶段边界与信号由你（owner）定，本文只承载已定的结论与执行细节。

---

## 0. 总览

```
Phase A（已完成）  NIBI-GO 应用主体 + WORK 远控入口    零内核耦合 · 零主线干扰
   │
   ├─ Spike 1/2（已完成）：iroh 实测 / RN 后台长连接
   │
Phase C（待启动）  本机内核                     两个启动信号见 §3
   （信号触发后先跑 Spike 3，再进入实现）
   前置：原 B0 手机工具面（A11y/执行器/确认卡/悬浮条/多任务）

Phase B（已取消）  WORK 形态手机操控路由        见 D6；仅保留 share-sheet 类窄需求预案
```

**为什么这样排**：A 与主线 kernel 迭代完全解耦（A 零内核耦合），已先行完成；C 依赖的稳定面（会话库语义 / ext 付费门禁 / android 平台包）此前还在主线高速对齐期（一晚 31 commits/14.7k 行），过早进入只会追着变化跑。**B 已取消（D6，2026-11-12）**：手机自动化归 C，B0 工具面并入 C 前置，B1 的桥与市场件不做。**D24（2026-11-15）后**：Android 内核改为本仓 fork 自建，C 不再受主线内核节奏约束，后续按 §4 的上游合并策略走。

---

## 1. Phase A：应用主体与 WORK 远控入口（历史交付）

> 2026-11-13 D2/D4 修订：默认 GO 主体，WORK 为入口并经 WebView 承载同源 UI；
> 下列 A0–A4 是已完成的历史交付，原生远控屏已退役，协议层/保活/通知资产继续复用。

### 里程碑 A0 · 项目启动（~半天）

| 任务 | 交付物 |
|---|---|
| 初始提交（当前 staged 的 18 文件） | git 基线 |
| Expo 骨架落地（`app/`） | `pnpm dev` 可跑的空 App + 路由骨架（双形态切换入口占位） |
| `packages/relay-client`、`chat-core`、`phone-tools` 包骨架（tsconfig/vitest/目录） | 各包 `pnpm test` 空跑通过 |
| 门禁接入 CI（本地 husky 或 GitHub Actions） | `check-boundaries.mjs` 每次提交自动跑 |
| 决定 `@nibi/shared` 引用方式（§待决事项 3） | AGENTS.md 规则 6 落定 |

### 里程碑 A1 · 连接与配对（~1-2 周）

依赖：relay-client 草案评审通过（`docs/design/relay-client-interface-draft.md`）。

| 任务 | 交付物 | 验证 |
|---|---|---|
| relay-client/transport.ts | 状态机（authenticating→paired→waiting，心跳/代次/退避） | fake-relay-v2 契约测试 |
| relay-client/pairing.ts | 扫码解析 + 设备注册 + 一次性 token + 持久凭据 | 假 relay + 真桌面联调 |
| App 配对 UI | 扫码/设备列表/连接状态屏 | 真机（Android） |
| **桌面侧触点 1**：transport 加法（若你决定先做 E2E；不做则 A1 无桌面改动） | PR 到 nibi-client | 桌面 CI |

### 里程碑 A2 · 聊天与任务（~2 周）

| 任务 | 交付物 |
|---|---|
| chat-core reducer | V4 事件 → 消息树/工具行/思考行（golden fixture 对齐桌面行为） |
| replay/gap 恢复 | 断线重连快照语义（对照桌面 attachment 合同） |
| App 聊天 UI | 消息流/输入框/工具行原生渲染 |
| sendText | 手机发起消息（inputOrigin: mobile） |

### 里程碑 A3 · 审批路由与 E2E（~1-2 周）

| 任务 | 交付物 | 桌面侧改动 |
|---|---|---|
| approvals.ts 状态机 | 两条不变量（generation 绑定/30s 拒绝）+ 假事件流全生命周期测试 | — |
| Host 审批 capability 开闸（nibi-client PR，~10 行） | interaction 事件到手机 | 小 PR |
| crypto.ts 信封 + KeyExchange | 密文向量测试（与桌面同断言） | transport 两处插桩（~200 行） |
| **桌面侧触点 2/3**：E2E 插桩 | PR 到 nibi-client | 小 PR |

### 里程碑 A4 · 发布准备（~1 周）

| 任务 | 交付物 |
|---|---|
| 通知（任务完成/待审批/提问）+ KeepAlive 前台服务 | 系统通知 + 进程保活 |
| 应用内更新（GitHub Releases + 增量 DSHDLT01 可后置） | SHA-256 校验 + PackageInstaller |
| 签名三链 + 杀软白名单申诉材料 | 发行纪律（dsh-Go 经验）——签名链已落地（config plugin + 密钥库工具；密钥保管见 `SECURITY.md`）；杀软材料待发布后 |
| 真机验证清单执行（AGENTS 规则 12） | 未验证项如实标注 |

### Phase A 退出标准

- 真机（Android 8+）扫码 → 远控桌面全流程可用：聊天/审批/提问/sendText/通知/断线恢复
- E2E 生效路径验证（NIBI-GO↔桌面密文；PWA 行为不变回归）
- 无内核代码、无 GO 形态入口（它们属于后续阶段）

---

## 2. Phase B：已取消（原 WORK 形态手机操控路由）

**2026-11-12 决策：不做**（D6 已改）。原方案是桌面侧 `nibi-phone-bridge` MCP 插件 + relay 路由，
让 WORK 会话的模型驱动手机 UI。取消理由：

1. **方向反了**：手机自动化应由手机上的内核做（C）；B 等于用桌面隔着 relay 驱动手机，绕远路做同一件事。
2. **只能 Android 且脆**：无障碍驱动在厂商后台策略、权限弹窗、Secure surface 下差异大；iOS 做不了。
3. **场景窄**：真正的独占场景只有「App 只在手机上有」，频率低；用户多数宁愿自己点。
4. **风险到账号级**：远端 agent 用无障碍点支付/社交，即使有确认卡，信任成本过高。

### 保留与移交

- **B0 工具面保留** → 并入 C 前置（C 里手机上的 agent 同样需要）：PhoneA11yService、Actuator、
  ScreenFormat/Mask 词表、GuardedButton 三拒绝 + armed 窗口、悬浮条三态、多任务 taskId 维度。
- **B1 不做**：`nibi-phone-bridge` 插件、relay 工具路由、nibi-go-market 官方件。
- **将来的窄需求预案**：若出现「桌面需要读手机内容」，只做 share-sheet（分享到 NIBI）+ 3~4 个显式工具
  （截屏 / 读剪贴板 / 打开链接 / 导出分享文本），不做坐标级的 a11y 远程操控。

---

## 3. Phase C：本机内核（待启动）

### 前置（原 B0，已并入）

手机侧工具面必须在 C 之前或同期具备：PhoneA11yService、Actuator、ScreenFormat/Mask 单一词表、
GuardedButton 三拒绝 + armed 窗口、悬浮条三态、多任务 taskId 贯穿。C 的手机内 agent 直接复用它们。

### 启动信号（由你判断；平台包信号已满足）

1. 主线 kernel 的"对齐 NODE"批次收尾（语义稳定，不再一晚万行地改）——2026-11-12 时 dev 仍在补 memory/cron/commands 对齐
2. ✅ `@nibi-studio/cli-android-arm64` 已发布（T1 已交付；T6 cdylib 产物上游已完成 `697f86cf`）

### Spike 3（信号触发后 ~1 天）

`libnibi.so` 进程内运行 + jniLibs spawn W^X @ targetSdk 36（Node 方案唯一技术风险）。
运行形态与分发载体的口径见 **D19**：进程内 `.so` 运行；npm 平台包 `@nibi-studio/cli-android-arm64`
携带 `lib/libnibi.so` + `build.json`（版本/ABI/sha256），GO 构建时拷进 jniLibs；
子进程形态只用于开发机验证。

### 里程碑 C0–C2（信号后细化）

| 里程碑 | 内容 |
|---|---|
| C0 内核上机 | android target + **JNI host（进程内 transport）** + 会话库；shell/Node/Python 运行时按 D25 Phase 2/3（fork 后自建），子进程 `app-server --stdio` 仅作开发机对照 |
| C1 GO 形态 UI | 独立 UI（非 PWA）：会话/聊天/设置接进程内内核 |
| C2 GO 插件生态 | nibi-go-market 仓 + plugin-kit（SDK 四件套）+ Node Plugin Runtime + native-ui v1 + 用户自开发链路 |

**C0 进展（2026-11-15）**

- 产物消费链：`scripts/android-kernel/fetch.mjs` 按 `pin.json`（当前 `4.1.0`）从 npm 平台包拉取，
  逐项校验 `build.json.artifacts` 的 sha256、ELF64/AArch64/shared object、`.note.android.ident`
  的 API ≤ minSdk(24)，fail-closed；落盘到 `app/modules/kernel-host/android/prebuilt/`（gitignore）。
- JNI 薄层：`app/modules/kernel-host`（Expo 本地模块 + C shim + CMake），暴露
  `abiVersion/start/send/stop/destroy`；输出在内核线程回调、按 LF 切帧后转 UTF-8 行；
  `start` 前由模块 `setenv`（HOME / NIBI_DATA_BASE_DIR / TMPDIR → App 私有目录）。
- 冒烟入口 `nibigo://kernel-smoke`：模块可用性、C ABI 版本、start/stop/destroy 结果与内核输出。
- 已验证（本机）：arm64 debug APK 打包含 `libnibi.so` / `libc++_shared.so` / `libnibi_kernel_jni.so`，
  模块进入 `ExpoModulesPackageList`；`fetch --check` 可复验落盘产物。
- **真机冒烟（2026-11-15，OnePlus PHK110 / arm64-v8a / Android 16）**：
  - `libnibi.so` / `libnibi_kernel_jni.so` 加载成功，`abiVersion()` = v1，`start() → true`；
  - 第一帧 `startup/storageState` 已按 LF 切帧送达 JS —— **进程内运行形态与协议面成立**；
  - 随后内核在 egress 构造处退出：`rustls-platform-verifier could not load extra certs`
    （Android 平台信任库需要 JVM + Android Context，C ABI 没有初始化入口）→ 已立票据 **T8**。
- 真机暴露并已修的两个缺陷：JNI 回调签名不匹配（Kotlin Sink 用 `ByteArray` 而非 `String`，
  原先 `GetMethodID` 抛 `NoSuchMethodError` 导致进程 abort）；`libnibi.so` 无 SONAME 时
  `DT_NEEDED` 会记成构建机绝对路径（改 `-L` + `-l` 后为 `libnibi.so`）。
- **T8 的 S1 已在真机验证**（上游 `feat/android-kernel`）：Android 平台根不可用时退内置
  Mozilla 根，`storageState` 走到 `ready`、内核保持运行（D21/D22 见 ADR-INDEX）。
- **16 KB 页对齐（D22）**：4.1.0 的 `libnibi.so` 实测 4 KB，不满足；上游分支已加
  `-Wl,-z,max-page-size=16384`，GO 的 `fetch.mjs` 与本仓 JNI 薄层同步加断言/链接参数。
- **协议链 + 完整回合已在真机跑通（2026-11-15，本地 mock 模型）**：
  `session/create`（含内核反向的 `session/requestRuntimePreferences` 往返）→ `session/send`
  → `model.request_completed` → `turn.terminal status=success`（139ms / 24 tokens）。
  只用 `NIBI_MODEL_BASE_URL` / `NIBI_API_KEY` / `NIBI_MODEL` 时内核走 **Anthropic 协议**
  （`POST /v1/messages`），本地假服务在 `scripts/dev/mock-openai.mjs`。
- **会话模型已按 dsh-Go 对齐（2026-11-15）**：`kernel-session` 改为订阅 V4 投影
  （`v4/conversation/subscribe` → snapshot + `row.delta`），行模型对齐 ChatRow
  （用户 / 助手含推理与流式光标 / 工具行 / ≥3 收组 / 轮末脚注 / 乐观 pending）；
  真机验证：正文按 `row.delta` 实时增长、完成后脚注 `✓ 已完成 · 用时 …`。
- **审批 / 提问卡（2026-11-15 真机跑通）**：快照 `pendingInteractions` 派生
  `approval` / `question` / `notice` 行（dsh-Go ApprovalRow / QuestionRow 的位置：消息后、乐观气泡前）；
  回答走 `v4/command` 的 `resolveInteraction`（信封必填 `issuedAt`，缺了回 -32602）。
  真机链路：假模型发 `Write` → 审批卡 → 允许本次 → 文件写入成功（内容与入参一致）→
  轮末脚注 `1 个文件 +1`。工具行同时补了 `output.text`（失败时就是内核错误正文）。
- **Bash 工具在 Android 上不可用（2026-11-15 发现）**：内核 shell 发现只认 bash/zsh
  （`kernel/crates/cli/src/shell.rs`），Android 只有 `/system/bin/sh`；同轮 `Write` 正常。
  已立票据 **T9**，归入待定项 ④（可执行内容边界）一起定方案。
  **临时桥已真机验证（同日）**：App 私有目录 `bin/bash -> /system/bin/sh`（mksh），
  `SHELL`/`NIBI_SHELL`/`PATH` 指过去；`echo nibi-shell-ok | tr a-z A-Z` → `NIBI-SHELL-OK`、
  工具 `success`。不随包带可执行文件；bash 专有语法与 hook 的 `/bin/bash` 仍不可用，
  正式方案（上游 sh 方言或静态 bash+busybox 三件套）见 T9。
- **轮末改动卡（2026-11-15 真机跑通）**：走 `v4/conversation/fileChanges`（轮头行 + 快照
  revision/logEpoch 两道 CAS），卡片挂在轮末脚注之后；真机 Write 后显示
  `改动了 1 个文件 / nibi-approval-test.txt / +1`。**工具输出里没有 `file_diff`**
  （Rust 内核不发，那是桌面/Node 的展示面），不能从 tool display 推改动。
- **轮折叠（2026-11-15 真机跑通）**：completedSuccess 且有过程的轮收成
  `✓ 已完成 · N 次工具 · M 条消息` 一行，点开展开思考/工具；最终回答与脚注留在外面。
  失败/中断/运行中不折；普通问答不折（思考本来就在气泡里）。
- **会话列表分组/搜索（2026-11-15 真机跑通）**：抽屉按 `今天 / 昨天 / 本周 / 更早` 分组
  （周一起算，UTC 固定日轴防 DST）；搜索按标题大小写不敏感、空标题按“新对话”匹配，带清除键。
  纯函数在 `app/src/components/sessionGroups.ts`，6 条单测钉住。
- **子智能体卡（已映射，等内核产出行）**：`subagent` 行 → 类型/状态/摘要 + 子会话下钻；
  单测覆盖。真机核对：4.1.0 内核在 Agent 前台与后台调用下都只投影 Agent 工具行 +
  后台通知回合，**没有 subagent 行**。`artifact` 行内核投影不产生，暂不做。
- **D20 进程拆分（2026-11-15 真机跑通）**：D20.1 `KernelService` 跑在
  `android:process=":kernel"`，控制面 Binder（AIDL）、帧流 socketpair；binder death 后
  250–2000ms 退避重绑，hook 重建 client 并 resume 当前会话。D20.2 加
  `startForegroundService` + `START_STICKY` + `dataSync` 前台服务：**只杀 UI 进程时 :kernel pid
  不变、前台状态仍在**，重开 App 接回同一个内核并得到完整回合。默认已切 service
  （`EXPO_PUBLIC_NIBI_KERNEL_MODE=inprocess` 可强制回退，服务失败也自动回退）；
  `dataSync` 的 6h/24h 上限与 `specialUse` 归 ⑤。⑤ 已落：`POST_NOTIFICATIONS` 运行时请求、
  `onTimeout` 主动停内核避免 ANR；剩 `specialUse`/分段续跑（运营者决策）与看门狗细化。
- **D24/D25 已定案（2026-11-15，设计基线）**：Android 内核 fork 进本仓（基线 nibi-client
  `dev` `1369b043`）；Android 原生运行时 = AndroidSh + bash/busybox/git + Node/Python +
  `nibi-run`，targetSdk 36、无 rootfs/PRoot。真机已验证：jniLibs 可执行 ELF 从 `:kernel` exec、
  App 私有目录 symlink → nativeLibraryDir 的 direct/PATH exec。**Phase 0（fork）尚未开始**；
  当前 Android shell 用 `bin/bash -> /system/bin/sh` 过渡，正式 shell 面随 Phase 1/2 落地。
- **未做**：真实 Provider 凭据与设置页、panic 看门狗、iroh NDK、D24 fork（Phase 0）、
  D25 Phase 1–6（AndroidSh/hooks、三件套、Node/Python、UI slots、手机双开关、workspace 策略）、
  `dataSync` 之外的 `specialUse`/分段续跑。

---

## 4. 与主线的同步协议（D24 后）

Android 内核不再走 npm 平台包/票据制：`kernel/` 是 GO 自有 fork，构建/适配/修复都在本仓。
上游 nibi-client 只读，按安全修复/协议能力**选择性合并**（记录合并的 commit 与 Android 分歧）；
合并后必须跑桌面 target 的 `cargo test` + Android 真机回归，不能为对齐上游回退 Android 能力。
shared-extract 仍按 D17 的抽取件流程（来源 commit + 契约测试）。上游 Android npm 包与
`rust-npm-packages.yml` android leg 的退场由 D24 Phase 0 一并处理。

---

## 5. 测试与验证纪律（全程）

- relay-client / chat-core：Node 可测（fake-relay-v2 + golden fixture），每 commit 跑
- 门禁：check-boundaries.mjs 每 commit 跑
- **编译验证（2026-11-11 修正）**：expo-router（SDK 58）懒路由——屏代码不在入口 bundle，验证必须按路由 chunk 请求（`/<appDir>/src/app/<route>.bundle?platform=android`），只验入口 bundle 会漏掉全部屏代码
- 真机验证标注：无障碍、jniLibs/`:kernel`/symlink exec、shell/Node/Python、iroh 迁移、PackageInstaller——每提交说明"已验证/未验证"
- golden 对齐：chat-core 的 reducer 输出与桌面 V4 行为逐条对照（dsh-Go 的 parity 测试范式）

---

## 6. 已决事项（2026-11-11 P1–P5 全部拍板，详见 ADR-INDEX 决议追加）

- P1 初始提交 `394fa7d`（身份 Ebonyhtx）✅
- P2/P3a 选 B：shared 走 `packages/shared-extract/` 抽取件，禁直链 ✅
- P3b 会话级 K 先行；P3c JSON 文本帧 ✅
- P4/P5 票据制落地：`docs/tickets/T1`（android 平台包）、`T2`（npm scope 统一）均已交付；后续 T6/T7 也由上游完成（nibi-client `697f86cf`）✅

---

## 7. D24/D25 实施顺序（2026-11-15 定）

> 设计正文 `docs/design/android-native-runtime.md`；每阶段先过门禁再进下一阶段。
> 顺序按“先让内核和 shell 自主，再上大运行时”，Node/Python 与 UI slots 不阻塞前两阶段。

### Phase 0 · fork 落地 + T8 S2

1. 以 nibi-client `dev` `1369b043` 为基线导入 `kernel/`（快照 + `kernel/UPSTREAM.md` 记录上游
   commit/合并策略；后续用 upstream remote diff 选择性合并）。
2. GO 构建链：Rust 1.95 + NDK r27 + cargo lock；CI 产 `libnibi.so`（API 24 / arm64 / 16 KB /
   符号断言）+ sha256/build manifest；`scripts/android-kernel` 改为消费自建产物。
3. 许可证/NOTICE 审计（vendored 代码 + Rust 依赖 + 后续二进制）。
4. T8 S2：`attach(JNIEnv*, Context)` 在 fork 的 JNI/`:kernel` 侧实现，保留退内置根兜底。
5. 回归：桌面 `cargo test` + 真机启动/会话/流式/审批/改动卡/折叠/`:kernel` 服务。
   出口：GO 自建 `.so` 替换上游 4.1.0，全回归通过。

### Phase 1 · AndroidSh + hooks

1. `ShellDialect::AndroidSh`：发现顺序 jniLibs bash（若有）→ `/system/bin/sh`；hooks 用同一套
   发现（不再固定 `/bin/bash`）；prelude/命令规则/错误文案按 sh 方言。
2. 宿主设 `SHELL`/`NIBI_SHELL`/`PATH`；移除 `bin/bash -> /system/bin/sh` 过渡桥。
3. 系统提示注入环境事实（Android/workspace/shell/node/python/手机模式）。
4. 真机：无 bash（sh）与有 bash 两种；管线、审批、hook 全通。
   出口：没有三件套也能用 sh + hooks。

### Phase 2 · 三件套 + nibi-run

1. 构建/引入 bash/busybox/git（Android/bionic；静态需 TLS 对齐；16 KB；GPL notices）。
2. jniLibs `lib*.so` + `$NIBI_BIN` symlink；`useLegacyPackaging=true`。
3. `nibi-run`：shebang、npm `.bin`、pip console、App 数据 ELF 报错；**先做 npm `.bin` spike**
   （安装后把 `.bin` 改写成 nibi-run symlink，或 PATH 交给 nibi-run）。
4. git hooks：`filesDir/runtime/hooks` symlink → `libnibi_hook.so`，`core.hooksPath`；
   50 条命令矩阵 + git commit/hook + `script.sh`。
   出口：shell/git 接近桌面；CLI 支持边界写进产品文案。

### Phase 3 · Node/Python

1. 先 spike：App 数据 `.node`/C 扩展 `dlopen` 是否可行；Node 22/24、Python 3.12 的 bionic 来源。
2. jniLibs `libnode.so`/`libpython.so` + wrappers；npm/pip 装到 `filesDir/packages`；
   `--ignore-scripts` / wheel 策略。
3. 纯 JS/Python 包 + 至少 3 个 Android 原生包；不支持项明确报错。
   出口：纯语言包可用，原生 addon 边界明确。

### Phase 4–6

4. UI slots：工具卡、`composer.actions`、`panels` 先行；3 个样例插件、版本兼容/降级。
5. 手机双开关：无障碍；Shizuku/无线调试检测/引导/状态/断开降级；capability flags。
6. workspace/策略/指标：配额、路径策略、cwd/env、审批、50 命令矩阵。

### 并行与门禁

- 真实 Provider/设置页不受 fork 阻塞，可并行。
- ⑤ `specialUse`/分段续跑在发布前定；FGS 6h/24h 已有 `onTimeout` 兜底。
- 上游安全修复按 `kernel/UPSTREAM.md` 节奏合并；每阶段过 `check-boundaries`、
  `check-public-repo`、相关测试/typecheck；Android 真机改动必须真机验证。
