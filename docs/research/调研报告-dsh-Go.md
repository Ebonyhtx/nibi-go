# DSH Go 深度调研报告（v2）

> 调研对象：https://github.com/ccch1mneyyy/dsh-Go（克隆于 `reference/dsh-Go`，commit `d5ad25c5`，v1.0.12）
> 调研日期：2026-11-07 · 方法：主线程 + 10 个并行子代理分层深挖，全部结论带文件:行号证据
> v2 相比 v1：补齐手机操控、运行时补丁、插件协议、伴侣系统、服务端、安全分析、测试体系的全部实现细节

---

## 一、项目定位与开发画像

**DSH Go** 是 DeepSeek Harness（DeepSeek 官方开源 AI Agent 引擎）的**第三方 Android 客户端**：Flutter 原生界面 + 纯 Dart 客户端 + 打过补丁的 DSH 引擎运行时（PRoot 内跑 `dsh web`）。与 DeepSeek 无关联。许可 AGPL-3.0（`sdk/`、`examples/`、`site/share` 为 MIT）；名称/logo/吉祥物（Deepy、鲸娘）不在 AGPL 范围（`ASSETS.md`）。Trendshift 全语言日榜 #1（2026-10-30）。

**开发画像**：764 commits / 13 天（2026-10-25 → 11-07），单人作者 chimney（763/764），12 个 release。重度 AI 辅助开发：仓库自带 AGENTS.md（硬规则+审查五原则）、`.agents/skills/{pr,review,bug,vuln-check,audit}` 五个自用技能包、`pro/batch-1..29`/`wave12/13` 批次分支命名。**明确不接受任何外部 PR**（CI 门禁自动关闭）。

**版本演进主线**（docs/changelog.md，24 个版本）：

| 里程碑 | 版本 | 日期 |
|---|---|---|
| 宠物系统/分享卡/E2E 链接/插话排队 | 0.9.0 | 10-25 |
| 插件原生界面一期 | 0.9.2 | 10-26 |
| 设置信息架构重组 | 0.9.7 | 10-28 |
| 改名 DSH Go；离线语音（241MB SenseVoice） | 0.9.8 | 10-29 |
| **第一个公开版本**（AGPL-3.0） | 1.0.0 | 10-30 |
| 手机操控全程自动+解除限制三开关 | 0.9.9 | 10-30 |
| 高刷对抗国产 ROM 60Hz 锁定；三签名 | 1.0.1 | 10-30 |
| 远程可选 P2P/TURN → 默认自动选路 | 1.0.3/1.0.4 | 10-31 |
| 会话永久删除；实时活动（灵动岛式） | 1.0.8 | 11-01 |
| **增量更新上线**（DSHDLT01） | 1.0.9 | 11-02 |
| 定时任务确认护栏；包体 -13MB | 1.0.10 | 11-04 |
| 引擎升 DSH 0.2.2-rc.1 | 1.0.11 | 11-05 |
| **伙伴小屋（Live2D 伴侣）** | 1.0.12 | 11-07 |

**规模**：`app/lib` 312,390 行 Dart（530 UI 文件+99 状态文件）；Kotlin 原生层 51,335 行；`runtime/` 43,903 行（105 补丁+220 测试）；`packages/dsh_client` 19,922 行；`services/share-worker` 9,489 行；`packages/dsh_remote` 6,405 行。

---

## 二、运行时层（runtime/ + Android 原生）

### 2.1 构建与供应链钉死

`runtime/build-runtime.sh`（476 行）交叉构建 Ubuntu Base 24.04.5 + Node 24.22.1 + CPython + pnpm 11.28.5 + `@deepseek-ai/dsh` 0.2.2-rc.1 + **Termux PRoot 5.1.107.98**（从 Termux 主仓库 deb 取，sha256 钉死，源码 zip 仅提取 COPYING）。deb 依赖闭包用 gpgv 验证 InRelease 信任链解析后锁进 `runtime/locks/ubuntu-noble-<arch>.json`。

**`rtbuild.py`（1,490 行）** 是构建核心：自带最小 ELF 读取器做审计/打补丁（把 `libtalloc.so.2` 的 DT_NEEDED 就地改成 `libtalloc.so` 以适配 APK 只装 `lib*.so` 的约束）；按文件名字典序应用 105 个补丁并用 pins.json 的 before/after sha256 双向校验（"a fully patched tree is a valid idempotent input. Never accept an arbitrary intermediate hash"）；分层裁剪文件（Ubuntu 文档/man、外来 prebuild/musl、`.d.ts`/`.map`）；模拟 update-ca-certificates 生成 CA bundle；逐 ELF 校验架构与 16KiB LOAD 对齐；`build-report.json` 记录裁剪字节数、`installScriptsNotRun` 证据、每个 ELF 的机器类型。**runtimeVersion = 所有输入 sha256 的聚合摘要**（含每个补丁文件）。

### 2.2 引擎补丁分类学（105 个 .diff，4,488 行）

全部目标为 `node_modules/@deepseek-ai/*` 已发布字节码，z 前缀数量 = 应用顺序。分类：

| 类别 | 数量 | 代表补丁与内容 |
|---|---|---|
| **Unicode/码点截断**（最大类） | ~20 | `truncateLine` 在边界回退高代理防劈开代理对；`codePointLength` 从 `Array.from().length`（O(n) 分配）改 inline 代理对计数；BOM 写回保留 ×2 |
| **subprocess 读写** | ~6 | UTF-8 字节游标（live 读停在合法序列中间时只留不完整后缀给下次）；spill 整块写；zero-tail 字节进度 |
| **会话生命周期** | ~6 | `session-list-isolation`（233 行，retired header 抛 `SessionPersistenceCorruptionError` 隔离坏会话）；`.dsh-go-lifecycle` 租约/墓碑目录排除枚举 |
| **插件管理器** | ~15 | `cancel-tree-confirmation`（338 行，`catch{return false}` 把一切错误当进程已死 → 只认 ESRCH）；HMR 更新前置校验 `expectedFrom` 防 TOCTOU 版本替换；锁生命周期绑定 abort signal |
| **凭据/脱敏** | 4 | pnpm 安装日志 URL userinfo 剥离；凭据 dispose 后锁内写检查 |
| **fs/text** | ~6 | Android 共享存储拒绝硬链接时保留 `open('wx')` no-clobber 语义 |
| **job/schedule** | ~4 | schedule 授权链路可中止；异步激活后补 `throwIfAborted()` |
| **性能** | ~8 | session id Set 代替数组 includes；reference renderedBytes 缓存 |
| **own-key/原型链** | 4 | `key in obj` → `Object.hasOwn` 防 `__proto__` 假阳性 |
| **owner-dispose** | 5 | 句柄绑定 `ctx.fiber.assertActive()`，owner 已 dispose 不发迟到句柄 |
| **route-guard** | 1 | 71 行，webserver 每条路由过 `dshGoRejectRequest`（守卫详见安全章节） |
| **会话删除** | 1 | 404 行全仓最大，见 §2.4 |
| **direct runtime** | 1 | 164 行，9 个文件打同一模式：`globalThis[Symbol.for("dsh.go.direct")]?.toHost(path) ?? path` 可选探测，无 preload 时 proot 行为一字不改 |

### 2.3 Direct Runtime（绕过 PRoot 直启）

原理：PRoot 是 ptrace tracer，每个路径系统调用都要陷入翻译。Direct 改为 `ld-linux-aarch64.so.1 --library-path … /opt/node/bin/node --import=preload.mjs` **直接启动 rootfs 内的 glibc Node**，路径语义由 6 个模块补：

- `paths.mjs`：**整个 rootfs 以相同绝对路径 bind 到自身**（same-path bind），guest↔host 路径双向映射；`requiresProot`（`/root/.l2s` 下拒绝）；"任意 shell 输出和 Markdown 故意永不改写"。
- `modules.mjs`：模块身份边界——`O_RDONLY|O_NOFOLLOW` 打开 FD 后用 `/proc/self/fd/N` readlink + fstat 五元组前后双重校验（"Resolver URL 是名字，不是正在加载文件的证明"）；**`process.dlopen` 只允许 `native-addons.json` 清单内 sha256 校验的捆绑 `.node`**，经 `/proc/self/fd` 别名 dlopen。
- `dns.mjs`：glibc getaddrinfo 读的是 Android 宿主 /etc 而非 guest，用 c-ares 重建 `dns.lookup`，**每进程每地址族独立 resolver channel**（"拒绝 AAAA 的网络不得拖垮 A 查询 #152"），读 guest resolv.conf + fs.watch 热刷新。
- `processes.mjs`：包装全部 child_process 族，任意可执行文件改走 hash 命名 shell wrapper；ripgrep 动态链接加 `--library-path`。
- `boot-cache.mjs`（203 行）：proot 下每次路径查询都陷入 tracer，DSH 启动期插件 loader 会 canonicalize 同一只读树数千次——**在 stdout 出现 token 行之前**替换 `realpathSync/existsSync/readFileSync`，对 `/opt/{dsh,node,dsh-go}/` 按路径组件缓存（miss 也缓存），启动结束后全部回落原生 fs。

**回退条件**（默认关闭，"Android 的 seccomp filter 在部分手机上会杀 glibc loader"）：`root/.l2s` 非空（PRoot 假硬链接后备仍需其语义）、上次 direct 失败记忆、ABI/preload 缺失。**测试哲学**："A fallback is a successful compatibility outcome, not a successful direct test"（`tests/direct/run-tests.sh:46-52`）——必须出现真实 `mode='direct'` 运行才算数。

### 2.4 会话删除（全仓最大补丁，404 行）

JSONL 持久化没有中央删除 API，sessionId 引用图散布在 projection cache（内存+sqlite FTS）、schedule 任务表、workspace registry、subagent 关系等 9 个包里。`runtime/session-deletion/core.mjs`（200 行）实现：同步 pending fence → draining 已持有 writer → 拒绝 subagent/被引用/有 schedule/goal active → 双租约 → **wx 临时文件 + link 原子落墓碑 + 逐级 fsync（"Durable point of no return"）** → 删日志文件 → 清派生缓存。**ID 永不可复用**（锁 inode 和墓碑永久保留）。`generate.py`（253 行）在内存中重放此前全部补丁后 difflib 生成 404 行补丁并更新 pins.json——补丁本身是生成物，可重现。

### 2.5 Android 原生层

- **Manifest**：26 个插件注册在缓存的 FlutterEngine 上（进程级存活，划掉最近任务通知订阅不断）；权限里 `WRITE_SECURE_SETTINGS` 仅由特权引擎经 Shizuku/ADB `pm grant` 给自己（唯一可授予项）；显式 `tools:node="remove"` 移除 libadb-android 合并进来的 `READ_PHONE_STATE` 和 WebRTC AudioSwitch 的蓝牙权限；`allowBackup=false`（rootfs 有明文凭据）；networkSecurityConfig 只放行 127.0.0.1 明文。
- **proot 启动**：`DshProcess` 从 stdout 抓 token（`redact()` 先脱敏）；proot 忽略 SIGTERM → 先 kill DSH pid（pid 文件由启动命令写）再 SIGQUIT proot；`L2sMigration` 启动前把假硬链接 tidy 成真文件；`RuntimeProcessOwnership` 捕获进程身份防孤儿。
- **前台保活**：DshService/PetOverlayService 都是 `specialUse` 前台服务；versionCode = `(年-2026)×1e8+MMDDhhmm`（构建分钟，防止降级）。

---

## 三、协议层（packages/）

### 3.1 dsh_client：mux 代次与恢复

- **$events 握手**：连接后自动 open `$events`，15s ready 定时器；首帧必须 `{type:"ready",clientId,host:{home}}` 否则协议失败；`MuxGeneration(++counter, clientId, home)` 从 1 递增；`$events` 收 end/error 即整代失效。
- **退避**：500ms→10s 六档 ×0.5–1.0 抖动（与官方 web 客户端同一排程）；401/refused → `unauthorized` 停机等用户。
- **watch resync**：`_SessionWatch` 按 seq 去重（`<=_lastSeq` 丢弃），空洞用 `session/page` 500/页倒序补页；`ChatTranscript` 用 `SplayTreeMap<seq>` 天然幂等去重；assistant 流 revision 跳号抛 `_Resync`；**断线清空 pending approvals，靠 Host 对新代次按同 eventId 重投 + 3s 宽限期后补发 cancel**——"已转发但未重投 = 断线期间已在别处被处理"。
- **API 面**（44 个 `*_api.dart`）：核心 session/prompt/watch/history/approvals/models/providers/workspaces/terminal/goals/schedule；扩展包括 **companion_api**（乐观并发 409）、**dsbot_api**（1,682 行，HTTP+SSE/Remote 双传输）、**speech_api**（16kHz PCM16 WAV 整段转录）、**terminal_api**（双工流：最新附件持输入、旧附件只读收 ack.refusal）、**session_deletion_api**（**从不重试/不跟随重定向**——"响应丢失=结果未知，盲重放不安全"）、**subscriptions_api**（ChatGPT/Claude 订阅登录轮询状态机）。
- **版本兼容策略**：能力探测优先于版本号 + 宽松解析（UnknownEvent 保 seq 连续）+ 唯一硬编码白名单（交互激活只认实测过的 `0.2.2-alpha.2/rc.1`——"宁可用实测过的精确版本也不猜"）。
- **background_session_read**：10 种只读列表搬进 `dart:isolate` worker（自有 HttpClient、JSON 解码全部隔离），8MiB/10 万行/64 深度上限，只 fail 不截断。

### 3.2 dsh_remote：Noise IK 端到端加密

- Noise_IK_25519_ChaChaPoly_SHA256 与上游 fixtures 逐字节对齐；Host 静态密钥必须等于 pin，密钥变化 fail-closed（开 socket 之前就拒）。
- 双通道：Server 中继（Control WS + Relay 节点数据口）或 WebRTC 直连（LAN/P2P/TURN，>8KiB RTCH 分块；首试 STUN-only → TURN relay-only 重试 → Relay 回落，独立 45s 冷却）。**信令与 Noise 握手始终在 Control 口**。
- 能力协商：`harness.remote.v3` 必须；`remote.history.compact.v1` 一经协商锁定，变更报终端 `HISTORY_MODE_CHANGED` 防缓存混格式。
- VERIFICATION.md：Android 模拟器真实 P2P（1,932ms）与 Relay（1,173ms）双链路验证；**WebRTC 使 APK 增 16.5MiB**（依赖打包不移除）；未验证真机/跨公网 NAT/真实 TURN——诚实标注。

---

## 四、应用层（Flutter）

### 4.1 状态架构

`state/` 99 个文件，每领域一个 `*_state.dart`（Notifier/AsyncNotifier）。**本机/SSH/中继统一为 `HostConnection`**（`hosts_state.dart:21` enum HostKind{local,ssh,relay}），`activeConnectionProvider` 是全 app 单一出口。`chat_state.dart`（2,075 行）持有 `ChatTranscript`（消息模型在 dsh_client 包），Controller 只做事件→apply→投影不可变 ChatState。**API key 存 Android Keystore（flutter_secure_storage），普通偏好存 SharedPreferences**——注释即契约。

### 4.2 聊天渲染管线

- `chat_list.dart`（1,421 行）：视口切成两段 sliver（锚点居中）实现反向列表+历史分页；`_FollowPhysics`/`_TopBoundedScrollController` 自定义滚动物理。
- `chat_rows.dart`：sealed class ChatRow 全行型；**整轮折叠行**（TurnProcessRow）key=`tp<startSeq>@<cutSeq>`，插话把一轮切多片各收一行。
- **流式性能**：`ChatRowsCache` 结构性变化才全量 `deriveRows`，纯文本 delta 走 `_reuseTail`——transcript 逐条 identical 复用，只替换最后一行 Element；`StreamPacer` 把成块 token 平滑输出（0.8s 平滑窗口，落后提速、保底 24 字/秒）；完成轮 TurnTrace 实例复用。
- 审批卡/提问卡：「屏幕上最显眼的东西，但不靠大红色」；回合尾注 `47 秒 · 12 步 · 约 ¥0.03 · 36 万 tokens ›` 放不下依次省略。

### 4.3 islands 网页岛

把官方 DSH Web 页面**切片**嵌入原生页面（同一 WebView 技术）：`island_gate.dart` 准入——relay 永不开、SSH 恒可、**本机需双重验证**（bridge 自报 routeGuard + App 无 cookie 实测 `/dsh-go/v1/inventory` 401/403，"Any app on the phone can reach 127.0.0.1, so a self-report alone isn't enough"）。**内存预算**：首岛 ~200MB、每加一岛 +30MB、≥5.5GB 内存 2 岛、≥9.5GB 3 岛；离屏暖 30s、后台 60s 全收。Kotlin 侧接管 webview_flutter 已有 WebView 实例（`WebViewFlutterAndroidExternalApi`），force dark 实现 `prefers-color-scheme`。

### 4.4 通知 / 性能 / 启动 / 诊断

- **通知**：决策在 Dart（"Flutter decides whether; Kotlin owns the channels"）；一个会话一个 group；**锁屏脱敏是主动升级**——锁着时连通知本体都只有公开文本，USER_PRESENT 后静默换真内容。LiveActivity 用 Android 16 标准 Live Updates（POST_PROMOTED_NOTIFICATIONS），HyperOS/ColorOS/MagicOS 画进自家岛；小米 focus 通知 `miui.focus.param` 仅在 SystemUI 放行时附加。
- **性能**：设备分级读**事实而非跑分**（isLowRamDevice/内存/CPU 核频/性能类，带 reasons）；刷新率——国产 ROM 把三方压 60Hz，auto 模式有帧时请求最高刷、**停帧 700ms 交还系统**；温控 ≥MODERATE 进 lightweight。
- **启动**：Android 12+ 系统 splash → 原生量出图标实际位置 → Dart 按量得位置画首帧 → 淡出交接，**中间无可感知切换**；`LaunchClipPlugin` 支持自定义启动视频（MediaPlayer→Flutter texture，尾帧驻留防闪）。
- **诊断**：ZIP 包（summary/settings/crash/engine.log）；**双保险脱敏**（原生 CrashClassifier.redact 写入时脱一次，Dart redact.dart 打包时再脱一次：secret_mask 全格式 → Bearer → 密名赋值 → key/token 形状，私钥块只留 BEGIN/END，已知前缀保留 `sk-•••`）；还有给 agent 读的 `diagnostics.md` 发布进引擎 rootfs（16KB 上限——"超过这个上下文成本就不值得读了"）。

---

## 五、手机操控（约 150 个类）

### 5.1 架构总览

```
PhoneBridge (abstract unix socket, MCP over JSON-RPC 2.0) ── PhoneCore ── SafetyGate
   ├─ MAIN 前台:      PhoneA11yService → MainScreenDriver（s* 屏，无障碍）
   └─ BACKGROUND 后台: BackgroundDisplay → PrivilegedChannel → PrivilegedDisplayCore（b* 屏，shell uid）
UserGate 线性兜底: ControlOverlay（悬浮条） → NotificationGate（通知） → PhonePrompts（应用内卡片）
```

**与引擎接口**：`PhoneBridge.kt` 在 abstract unix socket 上**自实现 MCP server**（JSON-RPC 2.0，协议版本 2024-11-05…2025-11-25）——proot 透传 abstract 地址，proot 里的引擎 guest relay 原样转发字节，手机工具以 `mcp__phone__<name>` 出现在引擎工具列表。认证 = SO_PEERCRED uid == App uid + hello token 恒时比较。关键注释："Same-uid code (anything in the rootfs) gets past both checks **by design: the real gate is the person's tap on the confirmation**"。

**固定 13 个工具**（apps/open/intent/notify/clipboard/screen/collect/tap/type/scroll/key/tap_xy/handoff）：**工具面永不依赖权限状态**——"名字/描述/schema 进每次请求，任何变化都会从第一个 token 处打穿 DeepSeek 的 KV cache；跑不了的工具返回可解释错误而不是从列表消失"。

### 5.2 无障碍前台通道

- **捕获**：`TreeCapture`（MAX_NODES=2000/深度 80/预算 2s，跳过 IME，非全屏系统窗当 chrome 忽略）；Android 14+ `accessibilityDataSensitive` 页面（GitHub/银行/密码）只留空布局壳。
- **格式化**（`ScreenFormat.kt`）：扁平化布局节点、TalkBack 阅读单元吸收、顶部(<20%)/底部(>86%)分区、滚动容器缩进；预算 3000 字符超限保留底部并输出「…另有 N 项，用 collect 或 scroll」；**`⚠` 打在 SafetyGate 会问的元素上、`+` 打在相对上一屏新增的元素上**——同一份 `SensitiveWords` 词表喂给标记和守卫，"never drift apart"。
- **打码**（`ScreenMask.kt`）：身份证过 **GB 11643 MOD 11-2 校验位**、银行卡过 **Luhn 校验**且前 8 字符不含排除词（订单/单号/运单/快递…）才替换为 `«身份证 ****XXXX»`；所有打码发生在**离开手机之前**；截图路径同样处理（检测到打码标记就拒绝附图）。
- **驱动**（`MainScreenDriver`）：每个动作前重新抓树比对 fingerprint，不匹配拒绝并附新屏；写操作硬拒绝（自身界面/受保护页/密码框）；`type` 有回读校验；`ScreenVerdict` 的核心原则："**缺少观测依据不等于界面没变**"——不可比较时如实说「动作已提交，但无法验证结果」。
- **ProtectedPages**：整包保护（packageinstaller/permissioncontroller/各家安全中心）+ 设置类包标题词表（无障碍/开发者选项/设备管理/锁屏密码/生物识别…）——"agent 永远不能给自己授权"，这些页面**可读不可写**。

### 5.3 后台特权通道（不打扰模式）

四条通道同一特权引擎：Shizuku/Sui（bindUserService）、自连 ADB（RSA 2048 自签 + mDNS 配对，`app_process` 跑 shell uid 的 PrivilegedDisplayMain）、root（`su -c` 固定模板）。特权引擎（shell uid）：

- **虚拟屏**：短边 720，flags 反射解析，**故意不申请 SECURE**（受保护内容保持受保护）；`launchPackage` 用 PendingIntent + `ActivityOptions.launchDisplayId` 绕过 caller 检查把目标 App 拉到虚拟屏。
- **读树**：手写 `IUiAutomationConnection` 动态代理 + `UiAutomation.connectWithTimeout(FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)`，只注册到目标包名；密字段命中置 `hasSecrets` → **有秘密时截图必省略**——"打字解锁是写权限，不是看密文的权限"。
- **注入**：反射 `InputEvent.setDisplayId` + `InputManager.injectInputEvent(WAIT_FOR_FINISH)`；`OP_GATE` 在一次性探针屏上验证真实注入能被自建窗口回执（DOWN/UP 坐标±2px 匹配才算送达），**探针绝不碰用户应用**。
- **保活**：PrivilegedKeepJob 只做"一次开机机会，不是常驻服务，也不是授权绕过"；root 模式熄屏保留空闲进程（其余通道熄屏即关）。

### 5.4 安全模型

- **SafetyGate**：`DEFAULT_DENY` 28 个包读写都不碰（支付宝/云闪付/数字人民币/12 家银行 App/同花顺/雪球等）；`DEFAULT_CONFIRM_EVERY_WRITE = ["com.tencent.mm"]`（微信可读每写必确认）；系统包 27 个"只看不动"；ConfirmMode 三档（ASK/TASK/ALWAYS），**任何模式下硬拒绝仍然生效**——防提示注入的核心。
- **SensitiveWords**：confirm 17 中文词 + 19 英文 view-id 词（send/pay/checkout/transfer/hongbao/logout/authorize…），secret 10 条（密码/验证码/支付密码/cvv/otp…）；短标签 <24 字才全匹配防误报。
- **checkWrite 顺序**：KEY 永远放行（退出路径）→ own/deny 拒 → SCROLL 放行 → 系统包拒 → 密钥框拒 → 才进入询问（tap_xy 必问、type+submit 必问、敏感词必问、every-write 应用必问、**首次进 App 必问**）；30s 不选=DENY；答案与任务 owner 绑定，任务被替换后迟到的允许不算数。
- **解除限制三开关**（系统设置/密码验证码/自身界面）默认全 false；开启要**按住 1.5 秒**；**任务进行中不能开启**（"正在开车的 agent 不能自己拓宽权限"）；银行支付类 App 不在这里——在应用名单。
- **确认卡防伪造**（GuardedButton）：拒绝 armed 前的 tap / 注入中的手势 / `FLAG_WINDOW_IS_OBSCURED`（tapjacking）；**事件字段不参与判定**（OPPO/realme 真手指与模拟 stroke 同参），判定不变量是"助手的所有输入都经我们自己的通路并被标记"；`finish()` 执行时再查 owner/撤销/超时；64 格历史"驱逐即 retire，有界历史不得把被遗忘的请求变成授权"。
- **悬浮条**：三态 morph（小球⇄胶囊⇄卡片一次只有一个窗口交换不闪）；**按住 1 秒停止** = 300ms arm + 700ms 填环（帧回调驱动而非 Animator——"移除动画开着时 Animator 立即结束，环永远画不满"）。

---

## 六、原生插件体系

### 6.1 协议 v1 全貌

**清单**（package.json.dshGo）：`v:1`/`minApp` semver/`wants`(draft|clipboard|message)/`assets`（必须包内）/`contributes`；整份 ≤16KiB；id 正则约束 + 同插件内不得重复；**单条出错只丢该条**（JSON Pointer issues，App 插件详情页一行「原生界面 · N 项有误」点开看）。

**contributes 七类 surface**（v1 四种 + 新增三种）：composer.actions(2)/message.actions(2)/composer.strip(1)/panels(4)/composer.tools(2)/session.actions(2)/turn.note(1)——每类有每插件上限和文字上限。

**视图组件**：v1 16 种 / v2 24 种（含输入表单 11 种）；数据绑定 `{ "$": "data.a.b" }`；三档预算（工具卡 8KiB/40 节点/6 层、面板 32KiB/120 节点/8 层、状态条 2KiB/8 节点/3 层）。

**效果白名单**：invoke 直接返回 8 种（insert/command/open/link/toast/copy/refresh/patch）；静态清单只许前 6 种；延后结果只许 4 种；每次 ≤4 个；`command` 拒绝 `name==="permission"`（**权限选择永不归插件**）；`link` 仅 https ≤2048 无凭据；`insert` 1-2000 字**永不自动发送**；**3 秒点按窗口**由 App 执行（防时钟回拨）；v1.1 延后效果（pending→恰一条 done/void 推送）；连续 5 次违规 → `degraded`（停全部 feed、之后视图/invoke 一律 409、App 换网页岛）。

**WS stream**：一台主机一条连接（≤8）；JSON Merge Patch RFC 7386 增量（补丁 >16KiB 降级整份）；rev = epoch.seq 追赶；4Hz 合并；订阅 ≤32/连接；积压 >1MiB 关 1013。

### 6.2 接缝规划（seams/）

`SlotAdapterRegistry.plan` 决策链：slot 目录（DSH 0.2.2-rc.1 的 **103 个 slot 全表**，每项带 SeatPolicy）→ 过滤官方占用者 → **原生面板优先**（声明了 `dsh-go:` 面板的包自动移除其网页条目）→ ui.json override → 原生适配器 → partial 剩余接岛 → 网页岛 → 网页链接 → hidden。消息级 slot（turnTail/assistant-actions 等）一律 `SeatPolicy.message`——"每条消息一个平台视图会拖垮滚动，不做岛"。

### 6.3 能力协商与降级

v1.2 features（audio/voice/micro/overlay）+ v1.3 files：清单声明 + App hello.features 交集；`adaptView` 把 App 不认识的组件换成老组件替身（list→text 行、tabs→stack、gallery→grid…），v:2 视图在无输入能力的 App 上自动降级 v:1。**图标白名单刻意排除锁、钥匙、盾牌、指纹、审批、权限类**——防拼出像授权的界面。

### 6.4 工具卡通道（不经桥）

`presentationMeta` → `tool/result.meta` → 会话 JSONL 持久化 → App 解析 `dsh-go/view`（8KiB 预算）。完全不经桥接、随对话记录走、**中转主机也可用**；`toolCard()` 包装器**永不抛错**（DSH 会让整个工具调用失败，超限回 `{}` 无卡）；官方网页版只读自己认识的 meta 键，多出的键不影响它。

### 6.5 dsh-ui 交互回复

同一解析器两种档案：**模型卡**（```dsh-ui 围栏，10 组件，options/confirm 发 `[dsh-ui reply]` 消息）vs **插件视图**（16/24 组件，走 invoke，永不发回复消息）。用户气泡带「已选择：方案 A」小标签；格式错 → 原始 JSON fallback +「让它重发」。

---

## 七、伙伴小屋（AI 伴侣）

### 7.1 双模式

- **轻量**：手机直调 DeepSeek Anthropic 兼容接口（`api.deepseek.com/anthropic/v1/messages`，deepseek-flash，thinking disabled，SSE 流式）；key 复用设置页（Keystore）；本地对话文件 80 行/带最近 24 行；不经引擎不连主机。
- **完整**：主机 DSH 会话 + `dsh-go-companion-full` 预设（人设 + 标准工具全套 + companion-full-context 注入）；`autoApprove:false` 保持主机权限预设；会话不进抽屉不发通知。
- **旁白协议**：App 在每条消息前加 `〔11月6日 周五 21:14，对方刚才摸了摸你的头〕`；人设说明"这是旁白不是对方说的话，不要念出来"。

### 7.2 Live2D 舞台（stage.js 1,552 行）

一帧顺序：视线弹簧（眼/头/身体三级）→ 闲置漂移（呼吸、能量影响幅度）→ 心情姿态 → 情绪表情 → 动作曲线（smoothstep）→ 口型（文本节奏或 WAV loudness）→ 眨眼（含 18% 双眨）→ 物理 → 尾巴。触摸：摸头拖动=pat（闭眼脸红飘心）、**连戳三下头晕**（1100ms 窗口）、650ms 长按=拥抱、从贝壳盘拖点心喂食（离嘴 80px 算吃、嘴随距离张开）、双指缩放。场景：昼夜四套配色、23-5 点 drowsy 眼皮沉、清晨伸懒腰；性能：闲置 30fps/有事 60fps/睡着 12fps。

**安全机制**：`runtime/`（代码）必须命中**编译期钉死的聚合 SHA-256**（每文件 sha256 → `name\0hash\n` 排序拼接 → 再 sha256）——"角色包可来自任何地方但代码必须是 App 里的这份"；`character/` 只许数据扩展名白名单；zip 头声明大小不可信按落盘复检；WebView CSP `default-src 'none'`；回复文本 JSON 编码后 `stage.command(...)` 永不成为脚本。

### 7.3 主机侧状态与记忆（bridge companion 路由）

存 `$DSH_HOME/companion/state.json`（**刻意放 dsh-go/ 目录外**，防 reset 连带保留私人记忆）：`{storeId UUID, revision, state{valence,energy,closeness,activity}, memories[] ≤256}`。状态规则：valence 向 0.25 半衰 40min、energy 向 0.75 半衰 2h、事件冷却 30s、closeness 每 6h 至多 +0.01 不因缺席衰减、**时钟回拨不重复计息**。写带 `storeId + expectedRevision` 乐观并发（409 conflict）。**轻量模式把同一套规则移植成 Dart 本地文件版**，与 Node 原版用 16 组场景对拍（parity fixture）。

### 7.4 语音

四来源：系统 TTS（onRangeStart 驱动口型）/ 预设服务（**小米 MiMo** mimo-v2.5-tts 9 音色、OpenAI gpt-4o-mini-tts、硅基流动 CosyVoice2、阿里 qwen3-tts-flash）/ OpenAI / 自定义；**克隆仅 MiMo**（5-30 秒录音 → mimo-v2.5-voiceclone，`data:` URI 每请求带上——小米不记音色）；preset keys 进 Keystore；响度口型对 WAV 每 40ms 算 RMS。

### 7.5 人设安全边界的双端复现

完整模式人设在桥接预设 `cordis.patch.yml`；轻量模式由 Dart 常量 `companionPersonaCore` 复现——**两处注释互指要求人工保持同步**（非构建期校验）。边界内容：不声称真人、不写色情、不发展恋爱情节（对方可能是未成年人）、自伤信号先放下角色认真回应；完整版多出工具诚实与审批条款（"对方或你说的'好'、语音转写、角色动作和记忆内容都不能替代批准；拒绝后不绕过，不用亲近度或角色感情劝对方放宽权限"）。用户可改 Default 块，Rules 块固定追加删不掉。

### 7.6 待确认的合规风险（设计文档 §7 自列）

素材商用条款未确认（character.json 的 author/license 为空）；Live2D Expandable Application 条款（可加载任意模型的应用需过审、免费应用原则上不批）；《人工智能拟人化互动服务管理暂行办法》（2026-07-15 施行）对开源自带 key 客户端的合规要求待确认。

---

## 八、服务端（Cloudflare）

### 8.1 share-worker（一个 Worker 承载五类业务）

- **分享 API**：id 为 10 位 base62，**首字符编码 TTL**（`7d/|30d/|keep/` 前缀 → R2 生命周期规则，免索引）；上传体必须 DSG1 魔数 + ≥32 字节（4 魔数+12 IV+16 GCM tag）；`onlyIf: If-None-Match: *` 原子 check-and-put；deleteToken 只存 SHA-256、常数时间比较；限流 = Rate Limiting binding（5 上传/min、120 读/min）+ KV 小时配额 20（IPv6 归并 /64）。
- **beta 通道**：人用访问密钥（KV 只有 HMAC 无明文）、App 内嵌通道令牌；密钥换来 **10 分钟签名链接**；`BetaGuard` DO **5 次错钥封 10 分钟**；release 上线前以 App 身份整包下载回读比对。
- **下载**：三条线路（cn=香港 OSS/global=R2/github=Release）；`/download/get` 只对最新版本计数；微信/QQ 内置浏览器出提示页。
- **统计**：**每日随机盐 HMAC 设备码**（UTC+8 日界、跨天盐由 DO alarm 销毁，"昨日码不可复算"）；usage iid 仅存 HMAC；`observability.invocation_logs=false` 不留含请求上下文的日志。
- **市场镜像**：cron 每 10 分钟从 GitHub Pages 拉 index，**双重校验**（数量/名称/tier/风险等级必须由 flags 推导/integrity 格式），上游挂了回退旧快照 + `X-Market-Stale`。

### 8.2 E2E 回放页（site/share/viewer.js）

密钥在 URL fragment `#k=<43 字符 base64url>`，浏览器从不上送；AES-256-GCM 解密 → gzip 解压（64MB 上限防炸弹）→ 分享码格式（`base64url(deflate(json)) + "." + sha256 前 48bit`）；图片资产按 `sha256(bytes)` 核对；所有文本 textContent/data: URL；**CSP 以内联脚本 sha256 hash pin 死**；测试验证回放时间轴与 Dart 端逐 beat 一致（误差 <1e-6）。

### 8.3 增量更新（DSHDLT01）

80 字节头（magic 8 + 旧 SHA-256 32 + 新 SHA-256 32 + u64 长度）+ op 流（COPY/DATA/END）；**按 zip 条目级比对**——同名且 CRC/尺寸/方法一致且**实际逐字节比对压缩字节**才 COPY；make 写完先 apply 自校验再落盘；≥60% 整包大小的补丁直接丢弃；补丁不改变信任链，最终仍核清单 APK SHA-256 + 签名（"签名是最后防线"——针对 ghfast.top 等可能篡改内容的加速镜像）。

### 8.4 插件市场（market/）

流水线：Ajv 条目校验（**禁止提交 tier**）→ npm 精确版本查询 → tarball 下载核 SHA-512 → strict tar 解包（拒路径穿越/段尾点/冒号/符号链接/Windows 大小写别名冲突/gunzip 先限 maxOutputLength）→ OSI 许可门禁 → 启发式风险扫描（7 条规则：install-scripts/native-code=high、shell/filesystem/obfuscated=medium、network/not-adapted=low，每项记 ≤12 个真实文件路径证据）→ npm bulk advisories（只查该包该版本，**不解析依赖树**）。**PR 自动合并的 ci-entry.mjs 绝不 checkout PR 代码**——用 Git Data API 沿 commit→tree→blob 读，拒符号链接、blob ≤16KB、严格 UTF-8。audit.json 证据结构含 `entryHash`/`publishTimestamp`/`integrity`/evidence 路径。

---

## 九、安全分析

### 9.1 防线清单（设计意图 → 实现 → 质量）

| 防线 | 实现 | 质量信号 |
|---|---|---|
| 凭据分层 | API key Keystore → 引擎 `.credentials.yaml`(0600)；OAuth "Host owns PKCE, tokens never reach the app"；App 只拿脱敏 profile（`138****5678`） | healProviderKeys 只回填不覆盖不推送 |
| 日志脱敏 | 原生写入时 CrashClassifier.redact → 诊断打包时 Dart 再脱 → 引擎补丁 pnpm userinfo 剥离 | 双保险 + 保留 `sk-•••` 前缀可辨识类型 |
| 路由守卫 | webserver 补丁（每路由过 requestRejection，未就绪 **fail closed 503**）+ bridge 兜底包装全部路由 + **金丝雀自测**（无凭据请求金丝雀路由，仅 401/403 且 handler 未执行才判 true，TTL 10s）+ App 侧再实测 | "measured, never assumed, because the app opens local web islands only when this holds" |
| 端口 | 只绑 127.0.0.1（direct 模式二次强校验 `--host`） | 但 proot 不做网络隔离，**全机 App 可达 loopback**（项目自认前提） |
| WebView | 导航白名单（file:///javascript:/intent 一律 block）；岛比网页版更严（外跳要确认）；权限请求一律 deny | 岛 JS 通道"一切消息按不可信输入处理" |
| 手机操控 | 见 §5.4 | 词表单一真源 "never drift apart" |
| 分享 E2E | 密钥 32 字节 Random.secure 只进 fragment；服务端只见 DSG1 字节 | 48bit 校验和是防损坏非防伪造（导入侧按纯数据处理，无注入路径） |
| 更新链 | SHA-256 + APK 签名双保险；delta 自校验；签名比对支持密钥轮换 lineage | "签名是最后防线"针对可篡改镜像 |
| CI 供应链 | ci.yml 9 个 action 全 pin commit SHA；pr-gate 只 checkout 默认分支 + persist-credentials:false；market ci-entry 不 checkout PR 代码 | npm ci --ignore-scripts 全覆盖 |

### 9.2 残余风险清单（按值得关注排序）

1. **引擎/插件与 App 同 uid、无进程隔离**——插件可直接读 `.credentials.yaml`、连 PhoneBridge、读已挂载的 /sdcard；防线完全落在人工确认卡与 prompt 约束。证据：`docs/plugins/files.md:72`、`PhoneBridge.kt:37-38`。
2. **127.0.0.1:3080 对全机 App 暴露，守卫是唯一 HTTP 边界**——守卫补丁与 pins.json 强耦合于特定 DSH 版本；升级失配且远程主机未装 bridge 兜底时，插件路由回到不鉴权状态。缓解面（canary 双重实测）本身质量高。
3. **插件安装端到端完整性不成立**——App 只能做安装前 npm-vs-sidecar 比对，pnpm 安装期与依赖树不受约束（项目自己在 market/README.md 承认）。
4. **部分 workflow 未 pin 到 SHA**（pr-gate.yml、market/*.yml 用裸 tag；publish.yml 持 pages/id-token 写权限）——pin 纪律不一致。
5. **/sdcard 全盘读写授权**——开启后引擎内任意代码（含 LLM 驱动的 shell）可写整个共享存储，只有 prompt 规则约束。
6. **确认卡守卫对 adb/其他无障碍服务不设防**（设计自认："它们本来就能控制整台手机"）。
7. **脱敏为启发式正则链**——非常规命名的秘密、短 token 可能穿透（项目自己要求人工复核）。
8. **伴侣素材包在线分发源未启用**（`companionPackSource == null`）——将来启用时 url+sha256 分发可信度是新增攻击面；另有拟人化服务合规待确认。

**总体观察**：安全设计的核心模式是「**fail closed + 实测而非假定 + 诚实自述边界**」。薄弱点集中在它自己反复承认的两个结构性事实上：Android 上没有真正的沙箱后端，以及 loopback 在单用户网络命名空间内等于全机可达。

---

## 十、测试体系与工程纪律

### 10.1 规模

**约 9,232 个测试用例**：app/test 882 文件 6,814 用例（含 55 个 goldens 目录 **1,005 张 golden PNG**、252 处 matchesGoldenFile）；packages 88+26 文件 828 用例；runtime/tests 128 文件 780 用例 + direct 35 + live 系列 38 个；share-worker 259；plugin-kit 99；market 23；site 26；Python 148。

### 10.2 golden 跨平台稳定的三层机制

1. **真字体、严格模式**：显式加载 JetBrains Mono 四字重 + Noto Sans CJK，**缺字体直接抛错**绝不落 box 字体；
2. **CI 端字体钉版**：apt 装 Ubuntu 20230817 版 CJK + 从 noto-emoji 拉 v2.051 Color Emoji 带 sha256 校验（"goldens 是用 2.051 画的，Ubuntu 自带 2.047 字形不同"）；
3. **确定性环境**：宠物浮层禁用、性能通道替换、**默认 locale 固定 zh-CN**（英文测试显式 opt-in）。CI 失败上传 failures/*.png 工件。

### 10.3 CI 分层

6 个 job：changes（paths-filter 三域，过滤含"测试会读的文件"）→ checks（生成物同步 --check ×3 + make_replay_viewer 实跑 diff + Python 工具链 + 4 个 npm test）→ flutter（**3 分片按文件取模**，注释解释不用 `--total-shards` 因每分片仍全量编译）→ dart（enforce-lockfile）→ runtime（**一次性打补丁的 DSH 装进 runner 临时目录**，node --test + run-guard-tests.sh + run-native-tests.sh 真引擎两次启动）→ android（仅 JVM 单测）。**无模拟器**——真机验收以 docs/testing 7 篇手册留在 CI 外。聚合门 `CI OK`。

### 10.4 review 技能（96 行 + 204 行 references）

9 阶段流水线：冻结信任边界（trusted-maintainer/trusted-local/untrusted-fork）→ 独立读码先于 PR 叙事 → 引语逐字核对 → 五轴裁决（行为/契约/红线/流程/熵）→ 验证（CONTRIBUTING 命令为唯一真源）→ 最小修改 → 固定报告格式（Verdict/Findings R1[❌|⚠️|💡][defect|slop][A-E]/Validation record/Merge Conditions，**禁止"做得好的地方"章节**）。配套 10 条红线、"门禁自修改的证明义务"（实现与 gate 同改须独立 oracle 证未开后门——"脚本存在、CI 绿均不足"）、反假绿四查。docs/maintenance 61 篇"实施前合同"（45 篇以 -contract 结尾，固定记录基底 commit/引擎版本/是否改 runtimeVersion）。

---

## 十一、评价

### 亮点（值得直接借鉴）

1. **补丁供应链闭环**：105 补丁 × before/after SHA256 双向 pin × 每补丁回归测试 + 字节成本 benchmark（oracle 断言在计时样本之外）× session-deletion 补丁本身由 generate.py 可重现生成——"给上游 monorepo 打 out-of-tree 补丁"的完整工程解。
2. **direct runtime 的失败哲学**："A fallback is a successful compatibility outcome, not a successful direct test"；模块加载 O_NOFOLLOW + /proc/self/fd 五元组双重校验 + native-addons sha256 白名单；DNS per-family channel 防止单一网络策略拖垮另一族查询。
3. **手机操控的纵深**：词表单一真源喂标记和守卫；确认卡判定不变量（"助手所有输入都经我们自己的通路并被标记"）；「agent 永远不能给自己授权」的受保护页可读不可写；工具面永不依赖权限状态（防 KV cache 打穿）；TaskReturn 六事实位兜底。
4. **插件协议的经济性**：单条出错只丢该条、连续违规降级、单项承诺（上限只放宽）、SDK 检查器与 App 解析器逐行孪生 + parity 测试、`toolCard()` 永不抛错、图标白名单排除授权语义。
5. **E2E 全链路**：密钥只进 fragment、服务端只见魔数字节、回放页 CSP hash-pin、测试验证与 Dart 端逐 beat 一致。
6. **无 IP 统计**：每日随机盐 HMAC、跨天盐销毁、invocation logs 关闭——隐私工程的教科书做法。
7. **测试纪律**：9,232 用例、goldens 字体钉版、CI 内真引擎 live、"未运行必须明写"根契约、review 技能反假绿四查。
8. **诚实的自述边界**：market "扫描≠沙箱"、SECURITY.md "在手机上运行不代表模型请求不离开设备"、dsh_remote VERIFICATION 列明未验证项、AGENTS.md "自动打码不能当成保证"。

### 风险与短板

1. **总线因子 = 1**：单人 + 制度性拒收外部 PR；13 天 764 commits 的节奏高度依赖 AI 辅助的可持续性。
2. **补丁墙的结构性脆弱**：105 个补丁耦合于 DSH 精确版本（pins before/after SHA256），上游协议一变就要大规模返工；0.2.1→0.2.2 已可见成本。
3. **安全模型的自认边界**：同 uid 无隔离 + loopback 全机可达 + 插件无沙箱——三层结构事实靠"人工确认卡"单点兜底，而确认卡又自认防不了 adb/其他无障碍服务。
4. **合规灰区**：非官方客户端深度依赖私有 Web API；伴侣系统的拟人化服务合规、Live2D 条款、素材商用授权均未确认（项目自列）。
5. **CI pin 纪律不一致**：主 CI 全 pin 但 pr-gate/market workflow 裸 tag。

### 一句话总结

**这是开源世界目前工程完成度最高的"把 AI Agent 引擎整机装进手机"实现**：运行时（补丁供应链 + direct 直启 + boot-cache）、协议（E2E 远程 + mux 代次恢复）、交互（原生插件协议 + 手机操控纵深 + Live2D 伴侣）三层都有独立可借鉴的设计；它同时是一份"单人 + 重度 AI 辅助如何在两周内交付 66 万行可维护软件、并配套 9,200 测试用例和 61 篇维护合同"的活体样本。主要不确定性在于单人维护、上游依赖补丁墙、和它自己诚实承认的 Android 无沙箱结构边界。

---

## 附：深挖报告索引（本轮 10 个子代理的完整输出）

| # | 方向 | 关键发现位置 |
|---|---|---|
| 1 | dsh_client 协议实现 | mux 代次/resync/宽限期撤销；44 API 面；版本兼容策略 |
| 2 | 手机操控 | a11y 捕获→格式化→打码链；特权虚拟屏；SafetyGate 全逻辑；MCP 工具目录 |
| 3 | runtime 补丁与直启 | 105 补丁分类；direct 6 模块；rtbuild.py；boot-cache；会话删除 |
| 4 | 原生插件协议 | 清单/七 surface/效果白名单/WS stream/接缝规划/能力降级 |
| 5 | App 状态与渲染 | ChatTranscript 投影缓存；islands 准入与内存预算；通知主动升级；启动交接 |
| 6 | Kotlin 子系统 | 权限逐条；深链/分享/快捷方式/更新/usage/图标切换/桌宠/麦克风仲裁 |
| 7 | 伴侣系统 | 双模式；Live2D 校验；状态规则（半衰/冷却/CAS）；语音克隆；人设双端同步 |
| 8 | 服务端 | share-worker 五业务；DSHDLT01；市场流水线；无 IP 统计 |
| 9 | 测试与工程纪律 | 9,232 用例；goldens 三层稳定；review 技能 9 阶段；61 篇维护合同 |
| 10 | 安全审查 | 凭据生命周期；路由守卫三层；残余风险 8 项 |
