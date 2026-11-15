# AGENTS.md — NIBI-GO 开发规则

> **仓库位置**：本仓是独立的公开移动客户端仓库，同时持有 **Android 内核 fork**（`kernel/`，D24）。
> **2026-11-15 状态**：`kernel/` 已导入（基线 nibi-client `1369b043`），自建构建链 `scripts/android-kernel/build.mjs`
> 与 CI `android-kernel.yml` 已落地；上游同步与 GO 专属改动台账见 `kernel/UPSTREAM.md`。
> 内核上游 nibi-client 只作只读合并源，由维护者在本仓之外检出；Android 内核的构建、适配与
> 缺陷修复归本仓，不再向上游提 Android 需求票据。

NIBI-GO 是 NIBI 生态的移动客户端：**默认主体是 NIBI-GO 本机 AGENT，NIBI-WORK 是主体内的远控入口**。本文件是 AI/开发者进入本仓的第一入口；架构决策见 `docs/decisions/`（权威索引 `ADR-INDEX.md`），调研底稿见 `docs/research/`。

## 仓库定位与边界

- 本仓含 **App 侧代码**（RN/Expo 壳、纯 TS 协议层、Kotlin 原生模块）与 **Android 内核 fork**（`kernel/`，Rust workspace）。
- **Android 内核归本仓维护**（D24）：`kernel/` 自包含构建 `libnibi.so` 与 `nibi-rs`；Android 原生适配（SH 方言、hooks、环境提示）在本仓做；上游只读合并安全/协议修复，Android 分歧可持续，不为对齐上游回退 Android 能力。**桌面内核行为不得因 Android 适配而改变**（保护 NIBI 主线成果）。
- 运行时按 D25：targetSdk 36，不 root、不 rootfs/PRoot；bash/busybox/git/Node/Python 随包进 jniLibs，App 数据里的 native ELF 不可执行，由 `nibi-run`/symlink 层吸收（`docs/design/android-native-runtime.md`）。
- **GO 插件生态与桌面插件体系彻底隔离**（D13）：本仓的市场、manifest、原生 UI 协议（nibi-go-native-ui）不引用桌面体系任何内容。WORK 形态的桌面插件管理是投影（IPluginManagementService 手机合同），不算耦合。

## 目录契约

| 路径 | 职责 | 禁止事项 |
|---|---|---|
| `kernel/` | **Android 内核 fork**（Rust workspace、Android SH 方言、`libnibi.so` 构建） | 不引入 rootfs/PRoot/root；不改桌面/CLI 语义；16 KB 对齐与 ABI 契约见 D19/D22/D23 |
| `app/` | RN/Expo 壳：导航、主题、l10n、屏幕 | 不得 import 内核/平台细节，只能走 packages 接口 |
| `packages/relay-client/` | Relay V2 terminal 客户端（纯 TS，无 UI） | 禁止 import react-native 任何内容（保 Node 可测 + 跨平台保险 D11） |
| `packages/chat-core/` | 聊天状态机（V4 事件 reducer、replay、审批状态机，纯 TS） | 同上；这是 UI 框架可替换的退出保险（D12 反思条款） |
| `packages/phone-tools/` | 手机工具面 TS 接口 + 平台适配器注册 | **多平台适配器设计**（D11）：接口层不得出现 Android 专属类型 |
| `app/modules/kernel-host/` | 内核宿主：Expo 模块 + C JNI 薄层 + `:kernel` Service（D19/D20） | 不改内核 Rust 源码（改动放 `kernel/`）；`android/prebuilt/` 不入库 |
| `docs/decisions/` | 架构决策记录（D1–D25 编号制，权威索引 `ADR-INDEX.md`） | 决策变更须新文件记录，不覆写历史决策 |
| `reference/`（不在本仓） | 上游 nibi-client 与 dsh-Go 参考由维护者在仓库之外检出 | **不编译、不执行、不参与本仓构建**；只读对照 |

## 硬规则

### 内核维护纪律（D24）

1. `kernel/` 是 Android 内核的**唯一真源**；上游 nibi-client 只读，Android 需求不再向上游提票据。fork 基线、合并的上游 commit、Android 分歧都记进 `kernel/UPSTREAM.md`（摘要可同步到 ADR-INDEX/plan）。
2. 上游合并只取安全修复与协议能力；合并前跑 Android 真机回归（启动/会话/流式/审批/改动卡/折叠/shell）。**不为对齐上游而回退 Android 能力**，也不改桌面/CLI 行为。
3. 构建可复现：Rust 工具链、NDK、cargo lock 固定；`scripts/android-kernel/build.mjs` 产出 sha256 + `.stamp.json`（NDK/rustc/提交）；16 KB 对齐（D22）与 ABI（D23）断言。桌面 target 仍要能 `cargo test`，Android 适配用条件编译隔离。

### 协议层纪律（D11/D12 反思条款）

4. `relay-client` / `chat-core` 与 UI 框架的隔离从**第一个 commit** 执行——它们只能依赖纯 TS（`@nibi/shared` 抽取件、zod、WebSocket、WebCrypto 接口）。
5. crypto 走 `Cipher` 接口抽象（密文格式 XChaCha20-Poly1305 三平台一致，实现可换）。
6. 对 `@nibi/shared` 的复用方式（2026-11-11 定案：**选 B 抽取件**）：类型与契约**只经 `packages/shared-extract/`** 引用——抽取时标注来源 commit（nibi-client dev）、不改写语义；升级 = 对比上游 diff → 逐文件决定抽取/跳过（跳过的登记）→ 跑契约测试 → 更新来源标注。禁止本仓代码直接 import nibi-client 的 `packages/shared`。

### 双形态纪律（D2/D13）

7. 两形态的会话、插件、市场互不引用；WORK 形态只做投影，GO 形态只认 GO 生态。
8. 手机工具面（`phone-tools`）是 App 原生能力，接口按多平台适配器设计；Android 实现放 `app/modules/`，接口层零 Android 类型。
9. 用户数据不越形态：GO 形态数据不出机（沙箱第 1 层），插件依赖不逃出插件目录。

### 验证纪律

10. 每个功能模块提交前：`relay-client`/`chat-core` 的测试必须能在 Node 环境跑通（不带 RN 运行时）。
11. E2E 加密信封（D9）与 Relay 客户端的契约测试直接复用 `@nibi/shared/testing/fake-relay-v2`。
12. 真机验证不可替代的项（无障碍、jniLibs/`:kernel`/symlink exec、shell/Node/Python、iroh 连接迁移），提交说明里明确标注"未在真机验证"及原因。

### Git 与安全

13. 不 `git add .`/`-A`；只暂存明确路径。
14. 凭据/令牌永不进对话、日志、备份、插件目录（license token 纪律，D16）。
15. 未要求不 commit、不 push。

### 运行时与平台（D25）

16. targetSdk 36 不变；不做 root、rootfs/PRoot、`isolatedProcess` 全功能沙箱。App 数据里的 native ELF 不可 exec；随包可执行文件只走 jniLibs（`lib*.so`），用户态名字用 `$NIBI_BIN` 的 symlink 指向 nativeLibraryDir。
17. shell / Node / Python 是**显式能力面**，不是默认工具面：审批默认开启，workspace 是策略边界不是 OS 沙箱；provider key 只在内核/Keystore，不进子进程 env。
18. 随包二进制/运行时固定版本 + sha256 + 许可证/NOTICE；运行期不下载可执行代码（④）。

## 命令

```bash
pnpm install                # 安装依赖
pnpm -r test                # 全部测试（relay-client/chat-core 须 Node 可跑）
pnpm --filter relay-client test   # 单包
pnpm --filter chat-core test
node scripts/check-boundaries.mjs # 架构门禁：层间依赖白名单检查
node scripts/check-public-repo.mjs # 公开仓门禁：本机路径/凭据/CI 权限检查
node scripts/android-kernel/build.mjs   # libnibi.so（Rust+NDK，jniLibs）
node scripts/android-runtime/build.mjs  # bash/busybox/git（Linux/WSL+NDK，jniLibs+assets）
node scripts/android-runtime/build.mjs --check  # 只校验已落盘运行时产物

# 发布（细节见 docs/checklists/发布检查单.md）
node scripts/keystore.mjs verify <apk>   # 校验 APK 签名证书与发布密钥一致
node scripts/release.mjs 0.1.1           # 版本号→门禁→prebuild→构建→验签→GitHub Release
```

### Windows 本地 Android 构建（MAX_PATH）

Windows 上 ninja 对**对象路径**有 260 字符硬限制，而 `expo-modules-autolinking` 用
`fs.promises.realpath` 解析依赖——虚拟盘（`subst`）和 junction 都会被解析回真实路径，
所以只改盘符没用。仓库路径偏长时（例如放在多层工作区目录下），`react-native-gesture-handler`
的 codegen 对象路径会超过 260，`assembleDebug` 报 `Filename longer than 260 characters`。

可靠做法：把 `node_modules` 实体放到**短的真实路径**，再挂回仓库：

1. 停掉 Gradle daemon（它通过 VFS watch 持有 `node_modules` 里的目录句柄）：`gradlew.bat --stop`。
2. 把仓库里的 `node_modules` 整体移动到短路径（同卷 rename，秒级），然后在原位置 `mklink /J`
   指回短路径。
3. 在短路径目录内再建一条**自引用 junction**：`<短路径>/node_modules -> <短路径>`。
   原因：realpath 之后 Node 从 `<短路径>` 找 `node_modules`，不自引用的话
   `settings.gradle` 的 `require.resolve` 会失败。
4. 删除一次 `app/android/build/generated/autolinking/autolinking.json` 与其 `.sha`：
   autolinking 只按 package.json 哈希判断是否重算，感知不到 realpath 变化，不删会继续用旧长路径。
5. 验证：`fs.promises.realpath("<repo>/node_modules/react-native")` 应返回短路径；随后
   `assembleDebug` 的对象路径应降到 250 以内。

`pnpm install --frozen-lockfile` 不会破坏这两条 junction（已实测）。新机器首次配置一次即可。

（RN 侧 `app/` 的开发命令在 Expo 骨架落地后补充。）

## 现状与路线

- **Phase A**（NIBI-GO 应用主体 + WORK 远控入口）：代码侧完成（A0–A4），仓库已公开（https://github.com/Ebonyhtx/nibi-go）；发布链路已定（源码仓 Releases + 独立签名密钥）。剩余 owner 输入：真机验证。
- **Phase C**（本机内核）：C0 已完成（进程内 `libnibi.so`、D20 `:kernel` + Binder/socketpair、会话流/审批/改动卡/折叠、Android shell 桥均真机跑通）。D24/D25 已定案：内核 fork 进本仓、Android 原生运行时（三件套 + Node/Python + `nibi-run`）分阶段实施；设计与阶段见 `docs/design/android-native-runtime.md`，实施状态见 `docs/plan.md`。
- **Phase B**（WORK 形态手机操控路由）：**已取消**（D6，2026-11-12）。手机自动化归 C；将来只有「桌面读手机内容」的窄需求时才做 share-sheet + 少量显式工具。
- 决策台账 D1–D25 见 `docs/decisions/`；架构总览可视化（历史快照）见 `docs/NIBI-GO架构总览.html`，D24/D25 以 `docs/design/android-native-runtime.md` 为准。
