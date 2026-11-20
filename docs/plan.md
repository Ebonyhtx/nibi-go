# NIBI-GO 开发计划

> 状态：Phase A **代码侧完成**（A0-A3 手机侧 + Spike 2 + dev-client 构建 + A4 KeepAlive/通知/更新；86 项测试绿）。**公开仓整理完成**：LICENSE(Apache-2.0)/NOTICE/SECURITY/CONTRIBUTING/COC/双语 README、`scripts/check-public-repo.mjs` 门禁（husky+CI 双接入）、CI action SHA pin + 只读权限、本机路径清理。**发布方案已定**（2026-11-11）：分发 = 源码仓 GitHub Releases（A）；签名材料与恢复步骤由运营者在本仓之外的私有运维位置保管（见 `SECURITY.md`）；`scripts/keystore.mjs` / `scripts/release.mjs` / `app/plugins/withReleaseSigning.js` 已落地。上游票据 T1/T2 已落地，T6/T7 上游已完成（`697f86cf`）；剩余 owner 输入：D24 Phase 0 真机回归与 D25 分阶段实施。C0 已完成真机验证。
> 当前状态（2026-11-20）：Phase 0-6 代码与真机验收完成；release 构建（生产签名 + R8 JNI keep）已复验；按会话 workspace 根与 HOME/TMPDIR 已落地；**v0.1.1 已发布**（首次公开版，tag 指 `336c886`，0.1.0→0.1.1 覆盖升级已验证）。下一步：C2 市场 UI/安装器（签名索引 + Ed25519 验签/防回滚已完成，见 C2 进展）；Shizuku 授权后的 `android_shell` 已于 2026-11-20 在 PHK110 真机验证（`uid=2000`，退出码 0）。
> 依据：`docs/decisions/ADR-INDEX.md`（D1–D25，权威索引）
> 本计划随决策变更更新；阶段边界与信号由你（owner）定，本文只承载已定的结论与执行细节。

---

## 0. 总览

```
Phase A（已完成）  NIBI-GO 应用主体 + WORK 远控入口    零内核耦合 · 零主线干扰
   │
   ├─ Spike 1/2（已完成）：iroh 实测 / RN 后台长连接
   │
Phase C（C0 已完成） 本机内核                    D24 fork/Phase 1-6 见 §3
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

## 3. Phase C：本机内核（C0 已完成；D24 fork 待启动）

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

**C2 进展（2026-11-20，第一步：签名索引 + 验签/防回滚）**

- 新包 `@nibi-go/market-index`：索引 schema（zod）、Ed25519 验签（对 index.json 原始字节，
  detached `.sig` hex 侧车）、内置公钥表、包 `sha256` 校验、`revision` 防回滚与插件版本不变量。
- 发布工具：`scripts/market/gen-key.mjs`（私钥落 `~/.nibi/market/`，0600，不进仓库）、
  `scripts/market/sign-index.mjs`（Node crypto 签名，输出 `.sig`）。
- 已生成 keyId `nibi-go-market-2026-11`（公钥已登记，fingerprint `09d17d31cb00b43c`）；
  私钥需运营者备份到私有运维仓。
- 单测 55 项 + CLI 冒烟（签名 → 验签 true，改一字节 → false；node:crypto 与客户端 noble 互通）。
- 市场 UI 与安装器（2026-11-20）：`/market` 页（刷新/安装/更新/卸载、失败原因与 revision 展示）、
  `marketStore`（`filesDir/nibi-market.json` 快照，accept 才覆盖）、`installer`
  （下载 → sha256 → 解包路径校验 → 清单 id/version 校验 → staging 原子替换）、
  `loadPlugins` 改为扫描 `plugins/` 目录（内置在前，市场安装在后）。
- 市场仓 **`Ebonyhtx/nibi-go-market`** 已建（公开，GitHub raw）：revision 2 发布参考插件
  `nibi.market.hello` 0.1.0，revision 3 升到 0.1.1。
- 真机（PHK110，signed release 0.1.2 测试构建）：市场页拉取 revision 2 并验签；安装 0.1.0
  后插件中心出现「市场示例/可用」；真实模型回合调用 `mcp__market_hello__hello` 返回问候；
  刷新到 revision 3 显示「可更新」，更新后再调用返回 v0.1.1 文案。
- 付费门禁（C2-4，客户端侧）：`@nibi-go/plugin-license` 离线验签 compact JWS
  （iss/exp/dev 设备绑定/plugins 覆盖，`"*"` 全放），凭证存 SecureStore，设备 id 首启固定；
  三道门 = 市场安装（按钮禁用 + installer 复核）、插件启用（抛错）、工具面（未授权按停用，
  MCP 不下发）。`paid` 取「市场快照 ∪ 安装记录」防复制缓存绕过。本阶段不启动收费，
  凭证获取/在线拒绝/宽限期待接账号侧。
- 真机（PHK110）：临时 revision 4（paid）下市场显示「需会员」且安装禁用、插件中心变
  「需会员」且开关关闭、新会话里模型确认 `mcp__market_hello__hello` 不存在；恢复
  revision 5（免费）后自动回到「可用」。license 单测 12 项。
- 网络：GitHub raw 在手机侧 body 卡住/超时；市场已镜像到 `dl.nibistudio.cn/nibi-go-market/`，
  客户端多源回退（dl → raw），真机 2.7s 拉通。
- 市场仓 CI `validate-market` 已上线（签名/schema/包摘要/revision 单调/同版本摘要不可变），
  实际 push 跑通；本地负例（改字节不重签）被拒绝。安装支持取消与「下载并校验」状态；
  快照损坏显式提示。
- 授权同步已接（复用服务端 `POST /api/v1/licenses/check`，**无需改服务端**）：Bearer 换证、
  X-Nibi-License 复查、403/authorized:false 写入 refusal 立即拒绝、401 不写拒绝；市场页
  「同步」按钮，未登录明确提示。真机已验证未登录分支；登录后的换证/撤销待有账号态复验。
- 安装进度：XHR 下载进度条 + 百分比（RN fetch 无进度），失败提示可重试；CDN 镜像脚本
  `scripts/market/mirror-cdn.mjs`（不写死主机/桶，先本地验签+包摘要再 ssh cat + ossutil）。
- 公开面门禁：市场仓新增泄露门禁（白名单 + 凭据/路径/基础设施扫描）并接入 CI；NIBI-GO
  `check-public-repo` 增加内部基础设施标识规则；两处都做了负例验证。市场刷新改为多源取
  最高 revision（镜像落后不会卡住新装设备），同 revision 不同字节判冲突。
- CDN 自动镜像已部署（服务端 cron，每 10 分钟；拉取市场仓 → 验签/摘要/revision 校验 →
  只传变化文件；GitHub 不存服务端凭据）。手工补跑仍可用 `scripts/market/mirror-cdn.mjs`。
- 提交流程：`packages/market-index/src/submission.ts`（提交 schema + 合并规则：版本前进、
  同版本摘要不可变、包地址固定）与 `pnpm market:publish`（校验包摘要 → revision+1 → 签名 →
  回读验签）；市场仓新增 `submissions/` 与 CI `check-submissions.mjs`（摘要/清单/许可/
  contact/caps/paid）。临时仓实测 dry-run、正式发布与幂等重跑。
- 撤回（下架）机制：`packages/market-index/src/yank.ts` + `pnpm market:yank`，索引移除
  （revision+1）并追加公开记录 `yanked.json`（id/版本/理由/时间/revision）；市场仓
  `check-yanks.mjs` 校验形状、重复撤回、revision 递增与「索引里不得仍有被撤回版本」；
  客户端市场页把本地已装但已下架的插件单列「已下架」（只提供卸载）。临时仓实跑与三种
  负例（仍含被撤回版本/重复撤回/revision 不递增）均验证。
- 下一步：登录后授权链路复验（换证/撤销/宽限期）；镜像新鲜度告警接入心跳；下载重试/
  断点续传（可选）。
  设计见 `docs/design/market-index.md`。

**C0 进展（2026-11-15）**

- 产物消费链（Phase C 历史）：`scripts/android-kernel/fetch.mjs` 曾按 `pin.json`（`4.1.0`）从
  npm 平台包拉取并校验 `build.json.artifacts`；**2026-11-15 D24 Phase 0 已切换为自建**——
  `kernel/` 快照（`1369b043`）+ `scripts/android-kernel/build.mjs` 交叉编译/校验/落盘，
  旧的 `fetch.mjs`/`pin.json` 已删除。
- JNI 薄层：`app/modules/kernel-host`（Expo 本地模块 + C shim + CMake），暴露
  `abiVersion/start/send/stop/destroy`；输出在内核线程回调、按 LF 切帧后转 UTF-8 行；
  `start` 前由模块 `setenv`（HOME / NIBI_DATA_BASE_DIR / TMPDIR → App 私有目录）。
- 冒烟入口 `nibigo://kernel-smoke`：模块可用性、C ABI 版本、start/stop/destroy 结果与内核输出。
- 已验证（本机）：arm64 debug APK 打包含 `libnibi.so` / `libc++_shared.so` / `libnibi_kernel_jni.so`，
  模块进入 `ExpoModulesPackageList`；`build.mjs --check` 可复验落盘产物。
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
- **T8 S2 已实现并真机跑通（2026-11-15）**：`nibi_app_server_attach_android(JNIEnv*, Context)`
  在 `nibi_app_server_start` 前由进程内模块/`:kernel` 服务调用。关键修正：reqwest 的
  `tls_certs_merge` 在 Android 上直接返回错误，且平台后端没有 `new_with_extra_roots`，
  所以 `net` 自建 `android_tls_config`（平台 `Verifier::new` + 内置根 `WebPkiServerVerifier`
  合并，任一通过）并经 `use_preconfigured_tls` 交给 reqwest。失败/未调用仍走 S1 内置根兜底。
  `build.mjs` 把该符号列为必需导出。企业 CA 真机用例待手工安装验证。
- **D24 Phase 0 已完成（2026-11-15）**：`kernel/` 快照（`1369b043`，2870 文件 blob 哈希
  全等）+ `kernel/UPSTREAM.md`；`scripts/android-kernel/build.mjs` 取代 `fetch.mjs`（API 24 /
  16 KB / ELF / 6 个符号 / sha256 + `.stamp.json`）；CI `android-kernel.yml`；
  `cargo deny --offline check licenses` 通过；许可声明见根 `NOTICE.md` / `THIRD-PARTY-NOTICES.md`。
  桌面 `cargo test --workspace` 4672 通过；真机（PHK110 / Android 16）`:kernel` 启动
  `attach=true`、`storageState` ready、会话恢复/订阅/流式/mock 回合 5.7s 全通，binder death
  → 新 pid → 自动重连；顺带修了首启 `onRestart("ready")` 与首启初始化并发互相关 client 的竞态。
- **16 KB 页对齐（D22）**：4.1.0 的 `libnibi.so` 实测 4 KB，不满足；fork 基线
  （`1369b043`）的 `kernel/.cargo/config.toml` 已带 `-Wl,-z,max-page-size=16384` /
  `common-page-size=16384`，GO 的 `build.mjs` 与 JNI 薄层都做断言/链接参数。
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
- **会话管理：归档 + 归档里彻底删除（2026-11-15 真机跑通）**：参照 NIBI 客户端——
  活动列表每行 `⋯`（或长按）→「归档任务」；抽屉出现「已归档 · N」入口，归档管理里每条可
  「恢复」或垃圾桶删除，顶部「全部删除」（带确认）。归档是 GO 本地状态（内核没有归档字段），
  集合存 `filesDir/nibi-archived-sessions.json`；删除先 `deleteSession` 关闭，再走
  `v4/storage/sessionData/purge` **彻底删行与附件/轨迹文件**（NIBI 客户端「清理数据」的同一
  内核能力），返回实际释放字节；运行中/被引用会保留。真机清掉 25 条测试会话并做过一次离线
  DB 清理：DB 5.0MB+WAL 4.3MB → 426KB，`files/.nibi/cli` 476KB。纯函数
  `app/src/kernel/sessionArchive.ts` 有单测。
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
  App 私有目录 symlink → nativeLibraryDir 的 direct/PATH exec。**Phase 0/1 已完成；Phase 2
  的三件套/打包/nibi-run/hooks/50 命令矩阵/HTTPS 已完成并真机验证（run-as + App 启动路径），
  剩 npm `.bin` 重写（随 Phase 3 的 node）**（2026-11-16）；App 内 mock Bash 工具已实测输出
  `SHELL=…/runtime/bin/bash`、`BASH_VERSION=5.2.37(1)-release` 且 `pwd` 正常；当前 Android
  shell 在运行时安装后自动切 `$NIBI_BIN/bash`，失败回退 `/system/bin/sh`（AndroidSh 方言）。
- **未做**：真实 Provider 凭据与设置页、panic 看门狗、iroh NDK、企业 CA 真机用例、
  D25 Phase 3–6（Node/Python、UI slots、手机双开关、workspace 策略）、
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

### Phase 0 · fork 落地 + T8 S2（1–5 已完成，2026-11-15；企业 CA 用例待手工）

1. ✅ 以 nibi-client `dev` `1369b043` 为基线导入 `kernel/`（快照 + `kernel/UPSTREAM.md`）。
2. ✅ GO 构建链：Rust 1.95 + NDK r27 + cargo lock；`scripts/android-kernel/build.mjs` 产
   `libnibi.so`（API 24 / arm64 / 16 KB / 符号断言）+ sha256/stamp；CI `android-kernel.yml`。
3. ✅ 许可证/NOTICE 审计（`kernel/LICENSE` + vendored notices + 根 `NOTICE.md` /
   `THIRD-PARTY-NOTICES.md`；`cargo deny check licenses` 通过）。
4. ✅ T8 S2：`nibi_app_server_attach_android` + JNI/`:kernel` 调用；Android 侧改用自建
   `MergeVerifier`（平台 + 内置根，reqwest 的 `tls_certs_merge` 在 Android 上不可用）；
   失败退内置根。
5. ✅ 回归：桌面 `cargo test --workspace` 4672 通过；真机（PHK110 / Android 16）`:kernel`
   启动 `attach=true`、egress 构造成功、`storageState` ready、会话恢复/订阅/流式/mock 回合
   （5.7s）全通，binder death → 新 pid → 自动重连。
   出口：GO 自建 `.so` 已替换上游 4.1.0。剩：企业/用户 CA 的信任用例（需手工装 CA）。

### Phase 1 · AndroidSh + hooks（1/2/4 已完成，2026-11-15；3 部分完成）

1. ✅ `ShellDialect::AndroidSh`：发现顺序 `NIBI_SHELL` → `SHELL` → PATH 的 bash/zsh/sh →
   `/system/bin/sh`；hooks 用同一套发现（不再固定 `/bin/bash`）。Phase 2 装了 jniLibs bash 后
   路径含 `bash` 自动切 `GitBash`。
2. ✅ 宿主设 `SHELL`/`NIBI_SHELL`=`/system/bin/sh`、`PATH` 含 `$NIBI_BIN`（`filesDir/runtime/bin`）；
   移除 `bin/bash -> /system/bin/sh` 过渡桥。
3. ◐ 环境段已有 `Platform: android` / `Shell: sh`（`describe_shell`）；Node/Python 版本与手机模式
   要等 Phase 3/5 有可用事实后再注入（现在注入「没有」会误导）。
4. ✅ 真机（无三件套）：UserPromptSubmit hook 经 sh 执行（`$SHELL=/system/bin/sh`）；mock 的
   Bash 工具调用经 sh 执行成功并回传结果；审批卡路径不变（build 模式仍需确认）。
   出口：没有三件套也能用 sh + hooks —— **已达成**。

### Phase 2 · 三件套 + nibi-run（1/2 已完成，3/4 部分完成，2026-11-15）

1. ✅ 构建链：`scripts/android-runtime/` 固定 bash 5.2.37 / busybox 1.36.1 / git 2.51.0
   （含 readline 8.2.13、ncurses 6.5、zlib 1.3.1、openssl 3.5.4、curl 8.16.0）的版本、
   URL、sha256；用 NDK r27b 交叉编译为 **bionic 动态 PIE**（静态 TLS 对齐仍是 8，已弃用），
   全部 16 KB LOAD 对齐、API 24 符号面零越界（仅 OpenSSL 的 `getentropy`/`memfd_create`
   弱符号，旧系统可为空）。`build.mjs` 校验 + `.runtime-stamp.json`；CI `android-runtime.yml`。
   许可与 GPL 对应源码说明进 `NOTICE.md` / `THIRD-PARTY-NOTICES.md`。
2. ✅ 打包：jniLibs `libbash.so` / `libbusybox.so` / `libgit.so` / `libgit_remote_http.so` /
   `libnibi_run.so` / `libnibi_hook.so`；`assets/nibi-runtime.zip` 放 git 脚本/templates/
   `BASH_ENV`/applet 名单；`NibiRuntime.install()` 解包并在 `filesDir/runtime/{bin,git-core,hooks}`
   建 symlink farm；`withAndroidLegacyPackaging` 把 `expo.useLegacyPackaging` 固定为 true。
   debug APK 已核对 `extractNativeLibs="true"`，lib/arm64-v8a 与 assets 均含产物。
3. ◐ `nibi-run` 已完成 shebang 解析、`$NIBI_BIN`/git-scripts/`$NIBI_PACKAGES`/PATH 查找、
   App 数据 ELF 明确拒绝（rc 126）；真机验证 `#!/bin/bash` 脚本可跑、npm `.bin` 的
   symlink→脚本入口可跑、`#!/usr/bin/env node` 在 Phase 3 前报“node 不可用”（rc 127）。
   **npm 安装后把 `.bin/*` 重写成 `$NIBI_BIN/<name> -> nibi-run` 的安装器部分仍在 Phase 3**
   （需要 node 才能跑 npm）；nibi-run 侧解析已就绪。
4. ◐ git hooks：`core.hooksPath` 由受管 `GIT_CONFIG_GLOBAL` 提供（仓库级配置优先，
   husky 不被覆盖），`git` 包装器由 dispatcher 执行仓库 `.git/hooks/<name>`。真机 `run-as`
   验证：`git init/add/commit` 触发 pre-commit、dispatcher 经 nibi-run 跑通。
   **50 命令矩阵已过（2026-11-16）**：shell 基础/管道/重定向/数组/正则/here-string、
   busybox（grep/sed/awk/find/xargs/tar/gzip/diff/cmp/stat/df…）、git
   init/add/commit/log/status/branch/checkout/merge/tag/diff/show/ls-files/remote/
   本地 clone、`git submodule`/`filter-branch` 脚本命令、`script.sh`、node/ELF 边界；
   矩阵还抓到并修复了 `busybox awk` 在 clang 18 下的 `BB_GLOBAL_CONST` 误编译。
   **HTTPS 已通（2026-11-16）**：随包 Mozilla CA bundle + 受管身份；
   `git ls-remote https://gitee.com/mirrors/git.git` 与
   `git clone --depth 1 https://github.com/octocat/Hello-World.git` 真机成功。
   系统 CA 目录在 OpenSSL 3.5 下不可用，bundle 是固定口径。
   **App 启动路径已验（2026-11-16）**：`:kernel` 服务启动时 `NibiRuntime` 安装/建链/写
   受管 gitconfig；App 内 mock 模型 → Bash 工具 → 审批 → 真实输出
   `SHELL=…/runtime/bin/bash`、`BASH_VERSION=5.2.37(1)-release`、`pwd=/data/data/.../files`。
   该轮抓到并修掉：service 模式漏接 `NibiRuntime`；bash 交叉编译用了自带 getcwd 替代实现
   （`bash_cv_getcwd_malloc=yes`）。
   出口：shell/git 接近桌面；CLI 支持边界写进产品文案。

### Phase 3 · Node/Python

1. ✅/◐ 运营者选 **自建而不用 Termux 二进制**（2026-11-16）。已完成：
   - App 数据 `.so`/`.node` 可 `dlopen`（探针 `dlopen-ok value=42`；execve 仍被拒）。
   - **Python 3.13.18 自建完成并真机验证**：宿主 Python + NDK 交叉；自建 libffi/zlib/
     OpenSSL；`python3` + `ssl/zlib/ctypes`、`pip 26.2.2`、`pip install requests`、
     `pyfiglet` console script（nibi-run）全部通过；stdlib zip 11MB、libpython 5.2MB。
   - **Node 24.22.3 自建完成并真机验证**（2026-11-16）：上游 `android-configure` +
     `patch-node.py`（bionic backtrace、V8 宿主 arm64-simulator trap handler、gyp host
     工具集、16 KB LOAD 对齐）；`libnode.so` strip 后 91MB，npm 11.19.1 随包。
     真机：`node v24.22.3 arm64 android`、`npm 11.19.1`、`npm install`（TLS 用随包 CA）、
     `npm run` 的 `.bin` 重写（cowsay 输出）、`require('./hello.node')`（N-API addon 42）、
     `#!/usr/bin/env node` 经 nibi-run。Termux 预编译包因供应链可控性不采用。
   - **App 内 Bash 工具端到端（2026-11-17）**：一次 Bash 工具调用
     `node -v; nibi-run npm --version; python3 -V; git --version; git config user.name`
     返回 `v24.22.3 / 11.19.1 / Python 3.13.18 / git 2.51.0 / NIBI-GO`。
     该轮修掉内核子进程环境白名单缺 `LD_LIBRARY_PATH`、`PYTHONHOME`、`NIBI_*`、
     `GIT_*`（Bash 工具拿不到 nativeLibraryDir 与运行时根：node 链接失败、npm 找不到）；
     模型凭据（`NIBI_API_KEY`/`NIBI_MODEL_*`）仍不投影。开发用 mock 的工具调用 ID
     同时改为每轮唯一（重复 ID 会被内核当成已处理，表现为 `[Tool use interrupted]`）。
   - **体积口径（2026-11-17 运营者定）**：Node 运行时继续随包，不拆按需下载；
     debug APK 约 128MB（`libnode.so` 91MB、`nibi-langs.zip` 16MB），
     release 实测体积出来后再评估是否分 edition/瘦身。
2. jniLibs `libpython3.13.so`/`libnode.so` + wrappers；npm/pip 装到 `filesDir/packages`；
   `--ignore-scripts` / wheel 策略（Python 已接 `PYTHONHOME`/`PYTHONUSERBASE`/`pip` shim）。
3. 纯 JS/Python 包 + 至少 3 个 Android 原生包；不支持项明确报错。
   出口：纯语言包可用，原生 addon 边界明确。

### 可用性收口（2026-11-17）

1. ✅ **Provider 设置页**：内核新增 `provider/state|save|remove|setDefault|setKeys`；
   设置页可看列表/预设、添加/编辑/删除、测试连通性、设默认。API key 存
   `expo-secure-store`（Android Keystore），启动时经 `NIBI_PROVIDER_KEYS` 进内核启动
   env，运行期经 `provider/setKeys` 进内存；`provider_config.json` 不落 key。
   真机：添加指向本机 mock 的 Provider（`http://127.0.0.1:9099/v1`）→ Key 已保存 →
   连通性通过 → 设为默认 → 新会话顶栏显示 `mock-model`，发 `hi` 得到 mock 回复。
2. ✅ **FGS 改为 `specialUse`**：manifest 声明
   `PROPERTY_SPECIAL_USE_FGS_SUBTYPE=on_device_agent_runtime`，`startForeground` 在
   API 34+ 传 `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`；`dumpsys` 实测
   `isForeground=true types=0x40000000`，不再受 `dataSync` 的 6h/24h 上限。
   商店分发时需在 Play 控制台声明用途。

### Phase 4–6

4. ✅ **UI slots 契约 + 渲染（2026-11-17，真机已验证；插件语义/注释第二轮返工）**：
   - `packages/plugin-contract`：`nibi-go.plugin.json` v1、受限 view v1（文字/行/列/卡/
     徽标/分隔/进度/列表/按钮/间距）、三档预算（工具卡 8KiB/40 节点/6 层、面板
     32KiB/120/8、状态条 2KiB/8/3）、效果白名单（每次 ≤4，`insert` 永不自动发送，
     `link` 只收无凭据 https，`command` 不能叫 permission）、`minApp`/`caps` 协商、
     `tabs`/`gallery`/未知组件的 v1 替身与逐条错误隔离；**39 项单测**。
   - 输入 token 语义对齐 NIBI 客户端：`composer.actions`/`composer.tools` 声明
     `token`（`plugin`/`command`/`skill`）+ 生成插件命令用的 `prompt`/`skills`；
     `message.actions` 声明 `command`/`prompt`/`skills`（引用消息执行命令），旧
     `instruction`/`effects` 清单继续兼容。
   - 当前渲染全部声明槽：工具卡、`composer.actions`、`composer.strip`、`composer.tools`、
     `message.actions`、`session.actions`、`panels`、`turn.note`、Web Island。
   - 插件运行时：除 App 的 `nibi-go.plugin.json` 外，还生成内核标准
     `.nibi-plugin/plugin.json` + `commands/*.md` + `skills/*/SKILL.md`，把每个插件目录写进
     `~/.nibi/cli/config.json` 的 `plugins.dirs`/`enabledPlugins`；内核按会话解析插件快照，
     命令由内核展开，技能进入 Skill 目录。MCP 仍由 `session/create|resume.mcpServers` 带入。
   - App：内置 3 个面向用户的样例：天气（MCP 工具卡 + 「查天气」命令）、写作助手（总结/润色/
     周报/邮件命令 + 写作检查技能 + 消息注释 + 面板/会话信息/回合脚注）、专注计时
     （Web Island 25 分钟计时器）。插件中心只展示名称、说明、面板/网页入口。
   - 输入栏语义（统一目录，`app/src/composer/`）：
     - 加号 = **完整能力列表**，按“附件（图片/文件）→ NIBI 命令（compact/goal/plan/
       build/init/workflow）→ 插件命令（NIBI 原生在用户插件前）→ 插件卡片（NIBI 原生在
       前）→ 技能（NIBI 原生在用户技能前）”分组；选中命令/技能/插件卡片只往 COMPOSE
       插入有颜色/图标、不可编辑的 token，插件 token 发送为
       `[@名字](plugin://name@inline)`，内核注入 `<plugin_reference>`（identifiers-only）。
     - COMPOSE 上方胶囊 = **快捷触发**（命令/技能），多层胶囊折叠成按钮，点开向上展开；
       内容与顺序在设置页 `/settings/composer` 配置。加号是完整列表，长按消息是“引用这
       条消息后触发命令/技能”，三处共用稳定 id，目录异步加载时保留未知 id，避免冷启动
       把插件项删掉。
     - 附件走 expo-image-picker/document-picker，发送 `AttachmentRef` 文件引用；内核按
       mime 生成图片/PDF/文本内容块，不把文件内容塞进 COMPOSE 正文。计划模式是
       COMPOSE 里的独立令牌，发送时随 `planEnabled` 提交，不重置权限模式。
     - 长按任意用户/助手消息 → 注释/润色/缩写/插件技能；插件 message.action 声明
       `command`/`prompt`，变成**引用这条消息执行插件命令**（发送 `kind=transform`
       的 conversationQuote，命令只输出改写后的正文）；技能走内核 `/技能名` mention
       （`/plugin:skill`），由内核展开 SKILL.md；旧 `instruction` 仍兼容为注释指令。
       不是把提示词或 SKILL 塞进注释框。
   - 模型设置与会话内切换（2026-11-18）：设置页 `/settings/provider` 是供应商列表 +
     模型行；添加模型时可“按模型名匹配”内核内置 `nibi-builtin.json`（上下文、模态、
     结构化输出/联网/系统消息、思考档位与参数映射），保存为完整 `providerModelRules`。
     内核新增 `provider/resolveModel` 与 `provider/state.modelInfo`，模型配置可覆盖模板
     内置模型（含自定义 Provider 的图片/PDF 输入能力）。会话里点模型 chip 打开供应商 →
     模型 → 思考强度滑轨（NIBI 的蓝紫→橙渐变、流光/浮叶），选择只作用于下一条消息，随
     `sendText.modelSelection` 提交；不立刻改运行中的会话。
   - 权限模式：会话顶栏 chip 显示当前权限（变更前确认/自主/完全访问），点开可切三档；
     切完全访问用应用内统一确认卡（不是系统 Alert）；计划模式是独立令牌，选中后在
     COMPOSE 里显示“计划模式”并可 ×，
     发送走 `planEnabled`，不把权限模式重置。切会话时从内核快照同步模型/权限/计划。
   - 注释：编辑器按行/按句切出可点选段（长消息纵向滚动，选中段在预览里同步品牌色
     高亮，段列表有 ✓）；发送走内核 `conversationQuotes`
     （`kind=annotation`、`comment`、`instruction`、`number`、`messageKey`、`messageRole`），
     用户气泡只显示编号引用卡，不复制整条原文；宠物上方数字进入注释管理（编辑/删除），
     消息下方保留「N 条注释」标记；发送后顶部数字消失。
   - 其它交互：侧边状态改成贴右缘的圆形上下文占用环（带呼吸），可上下拖动，点击展开
     当前上下文用量/上限与缓存命中率；
     去掉了宠物左缘的常驻白色渐隐，宠物整只可拖动（包含下半身）；抽屉打开时宠物保持
     挂载、抽屉覆盖在上层，遮罩降到很淡，不再出现右侧大片阴影。
   - Web Island：`url` 只允许 https，或内联 `html` ≤16KiB；WebView 路由守卫只放行
     `about:blank` 与同源 https，8s 超时/加载失败显示可重试降级页；样例是可交互的
     专注计时器（开始/暂停/重置）。
   - 验证：MCP stdio 手测（initialize/tools/list/tools/call）通过；内核 CLI
     `--mcp-config` 端到端调用成功；Metro Android bundle 200。真机（PHK110 / Android 16）：
     插件中心 3 个样例与启停、加号插件 token、插件引用 reminder、胶囊命令展开（含 skill
     列表）、注释（用户/助手、局部选取、发送、管理、删除）、侧边状态展开/收起/拖动、
     抽屉层级、宠物拖动、天气 MCP 工具卡、专注计时器、Web Island 超时降级。
   - 未做：插件市场与签名/Ed25519 仍属 C2。槽数据两条通道都已落地：工具结果随推
     `_meta.nibiGo.push` → `data.push`（display 随结果落库为 `tool_display` entry，冷恢复
     后工具卡与随推脚注仍在），以及常驻推送 `notifications/nibiGo/slot` →
     `pluginSlot.data`（live-only、会话级连接）。插件设置（text/toggle/select，随 MCP 启动
     env 与 `data.host.settings` 生效）与命令/技能面已在插件中心落地；供应商 logo 从
     NIBI Client 的 `provider-icons` 原样复制 PNG（bigmodel/openrouter/opencode 仅 SVG，
     仍用字标回退），模型行可单独设默认。
5. 手机双开关：无障碍；Shizuku/无线调试检测/引导/状态/断开降级；capability flags。
6. workspace/策略/指标：配额、路径策略、cwd/env、审批、50 命令矩阵。

### Phase 5 进展（2026-11-19）

- 代码完成：`app/modules/nibi-phone`（无障碍服务、loopback MCP、Shizuku）、
  `packages/phone-tools` 接口层、`/settings/phone` 设置页；固定 9 个手机工具，
  内核零改动（`session/create|resume.mcpServers` 的 HTTP 形态）。
- 已验证（Android 15 x86_64 模拟器）：开关 1 与系统无障碍连接；应用内 loopback MCP
  `initialize`/`screen`/`tap` 硬拒绝/`screenshot` 全通；读屏跳过状态栏窗口，
  跨包节点按节点包名判。
- PHK110 真机（2026-11-19）：内核→loopback MCP 真实回合通过（`screen`/`open`/`tap`/`type`：
  Chrome Example Domain、Learn more→IANA、httpbin 表单写入 NIBI 并回读）。
- 已修复：手机工具审批改走原生悬浮卡（`SYSTEM_ALERT_WINDOW`，不抢前台）；PHK110 已验证
  `open` 审批浮在 App 上、`screen` 审批浮在 Chrome 上，`screen` 读到 Chrome 的 `s3`。
  未授权时回退应用内卡片，设置页显示授权状态。
- 已修复（2026-11-19 第二轮）：悬浮审批卡加「始终允许」（内核 `allowAlways`，按工具/参数
  记住规则）；`screen` 改为分页（页尾 `cursor`，同一快照内继续读，元素编号不变）；
  loopback MCP 服务器改用稳定 token/端口、不随 Expo 模块销毁，进程被回收后由无障碍服务
  重启；内核 resume 对同一 MCP 配置幂等复用。针对 `MCP is shut down` 的根因修复。
- 已验证补齐（2026-11-19/20）：`FLAG_SECURE`、无线调试「已开启」分支、进程死亡恢复；
  release 构建复验见下一条。
- 真机第二轮（2026-11-19）：`始终允许`（open 按 URL、screen/scroll/key 按工具）生效；
  `key back` 成功；抓到并修复 `scroll` 误报「屏幕已经切换」（改用活动应用窗口包名，
  不再被输入法/悬浮卡干扰），修复后滚动内容确实变化。Bing 首页/搜索结果均在单页内
  读完；PHK110 另用 40 段本地长页面验证了 cursor 多页（s4 共 47 项，s4:13 → s4:24 →
  s4:35 → 读完，屏幕号与元素编号连续），过期快照的 cursor 会报「屏幕快照已过期」。
- 真机第三轮（2026-11-19）：`FLAG_SECURE` 用自建安全窗口 APK 验证（系统返回全黑图，
  已改成明确错误）；无线调试「已开启」分支已验证后关闭；进程被 `kill -9` 后由无障碍
  服务重启，服务器仍用同一 token/端口 39617 恢复，MCP `initialize` 成功。Shizuku 已
  安装并启动，但 ColorOS 16 的「adb 权限受限」阻止授权，`android_shell` 授权后执行
  未验证（未代为修改系统语言/权限监控设置）。
- release 构建复验（2026-11-20，Android 15 x86_64 模拟器 + 生产签名密钥）：R8 首次抓到
  真缺陷——`libnibi_kernel_jni.so` 用 `GetMethodID` 按名字找 `Sink.onLine/onError`，
  R8 改名后内核线程抛 `NoSuchMethodError` 并 SIGABRT（debug 完全正常）。修复放在被跟踪的
  `app/modules/kernel-host/android/consumer-rules.pro`（`-keep class expo.modules.nibikernelhost.**`），
  不写 prebuild 生成的 `app/android`；`app/test/release-rules.test.ts` 防回归。复验通过：
  无障碍绑定、loopback MCP 9 工具、`screen` 21/29 项、截屏 324x720 JPEG、FLAG_SECURE
  探针返回安全错误、`kill -9` 后同 token/端口 39617 恢复、内核 `nativeStart=true`、
  mock 回合调用 `mcp__phone__screen` 且应用内/悬浮审批都能放行、会话 workspace 仍为
  `files/workspaces/<id>`。arm64 release APK 已用同一密钥签名并校验。
- 真机第四轮（2026-11-20）：Shizuku 13.6.0 已在 PHK110 上启动并授权 NIBI-GO（设置页
  「Shizuku 已连接」，无线调试开启）。真实模型回合调用 `mcp__phone__android_shell`
  （`{"command":"id"}`）→ 悬浮审批卡「允许一次」→ 结果 `uid=2000(shell) gid=2000(shell) …`
  `context=u:r:shell:s0`、退出码 0，证明 shell uid 执行链（非 root）打通。写操作同轮验证：
  `/sdcard/Download/nibi_probe` 创建/读取/删除、`settings put/get/delete global nibi_probe`
  全部成功且无残留（应用管理类写操作见下一条）。
- 真机第五轮（2026-11-20）：自建 8.5 KB 测试 APK 验证应用管理写操作。`pm install` 需先把
  APK 从 `/sdcard`（FUSE，system_server 读不到）`cp` 到 `/data/local/tmp`；ColorOS 会弹系统
  安装器要求点「安装」，确认后安装成功（等待确认会超过工具默认 60 s 超时，但安装已完成）。
  `am start` 后 `pidof`=29552，`am force-stop` 后 `pidof` 为空，`pm uninstall` 返回 `Success`
  且宿主侧确认包已移除。
- 发布（2026-11-20）：`v0.1.1` 已通过 `release.mjs` 发布到 GitHub Releases
  （asset digest `sha256:825d80dd…` 校验通过）；PHK110 上 0.1.0→0.1.1 覆盖升级实测通过
  （versionCode 2、内核/无障碍/39617 正常，数据保留）。

### Phase 6 进展（2026-11-19）

- workspace 边界：`policy` 的写入判决在 deny 规则之后、其它规则之前检查
  workspace（含 `additionalDirectories`）之外的真实路径；判定解析符号链接，
  越界是**询问**不是拒绝，完全访问模式由判决链放行（保持“想写哪里都能写”的能力）。
  实现为 `paths::PathContext::in_workspace_boundary` + `real_within`。
- 配额：`Write` 单次内容上限 16 MiB（`validate_input` 拒绝）。
- 命令指标：`ToolCall` 带 `exit_code`/`error_class`；Bash 成功记 0、失败从
  `Exit code N` 解析；`tool_usage` 的 `exit_code`/`error_type` 落库；
  `v4/usage/stats` 补 `successRate` 与 `errorTypes`。
- 文档口径：workspace 是策略边界不是 OS 沙箱；shell/解释器仍可越界（写进模型提示与
  设计文档）。越界写入按运营者 2026-11-19 的决定保持“询问、完全访问放行”，
  不引入会阻断能力的 workspace 总量/并发硬上限；现有超时、输出截断、进程树回收不变。
- 按会话 workspace 根（2026-11-20）：新会话由 App 先生成 sessionId、建
  `filesDir/workspaces/<sessionId>/`，`session/create` 同时带该 workspace 与 sessionId；
  shell cwd、文件工具与路径策略按会话隔离。删除会话在 purge 确认未被保留后回收目录
  与 `cacheDir/sessions/<id>`；启动清理草稿崩溃留下的空目录；旧会话（workspace=filesDir）
  保持原样、不迁移。Android 宿主设 `NIBI_SESSION_HOME=1`/
  `NIBI_SESSION_TMP_ROOT=<cacheDir>/sessions`，内核把用户命令的 HOME/TMPDIR 指到会话目录；
  桌面入口不设这两个变量，行为不变。
  PHK110 真机验证：新会话 pwd/HOME=`files/workspaces/<id>`、TMPDIR=`cache/sessions/<id>`，
  DB 持久化同一路径；旧会话仍是 `files/`；重启清掉空草稿目录；归档后彻底删除会同时
  移除 workspace、临时目录与 DB 行。
- 50 命令矩阵：沿用 2026-11-16 的 Android 真机记录（本文件 Phase 2），Phase 6 只补
  策略/指标，不重跑矩阵。

### 并行与门禁

- 真实 Provider/设置页不受 fork 阻塞，可并行。
- ⑤ `specialUse`/分段续跑在发布前定；FGS 6h/24h 已有 `onTimeout` 兜底。
- 上游安全修复按 `kernel/UPSTREAM.md` 节奏合并；每阶段过 `check-boundaries`、
  `check-public-repo`、相关测试/typecheck；Android 真机改动必须真机验证。
