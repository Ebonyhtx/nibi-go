# 手机操控（Phase 5 两开关）实现设计

> 状态：2026-11-19 实施设计。对应 `android-native-runtime.md` §8 与 `plan.md` Phase 5。
> 本文只覆盖开关 1（无障碍）与开关 2（Shizuku / 无线调试）的可执行口径；
> 悬浮条、后台多任务、OCR、意图/剪贴板/通知工具不在本期。

## 0. 一句话

App 进程内的无障碍服务 + loopback MCP 服务，把手机屏幕与操作以
`mcp__phone__*` 工具交给内核；内核不改一行，审批、审计、上下文都走既有链路。

## 1. 为什么不改内核

内核没有"宿主执行工具"的注册口（`Tool` 是编译期注册的 async trait），
而 `session/create|resume` 已支持 HTTP/SSE MCP 服务器。因此：

- 新模块 `app/modules/nibi-phone` 在 App 主进程内：
  - `NibiA11yService`（AccessibilityService）按需读屏、执行手势；
  - `McpHttpServer` 在 `127.0.0.1` 随机端口提供 streamable HTTP MCP；
- App 在 `session/create|resume.mcpServers` 里带上
  `{ name: "phone", type: "http", url, headers }`（只在本机回环）；
- 内核看到 `mcp__phone__<tool>`，工具调用走既有审批链
  （build 默认逐次确认，`yolo` 按内核语义放行）；
- MCP `initialize.instructions` 由内核注入系统提示，模型知道当前能力状态。

内核侧唯一的既有约束：MCP 工具结果支持 `text` 与 `image` 内容块，
截屏可以作为图片结果交给模型。

## 2. 进程与连接

```
UI 进程（默认）
  NibiA11yService ── 屏幕快照/手势 ──► Android
  McpHttpServer 127.0.0.1:<随机端口> ◄── HTTP JSON-RPC ── :kernel 进程
  PhoneModule（Expo）── status / 开关 / MCP 配置 ──► JS
```

- 只绑 `127.0.0.1`，端口优先固定 39617（被占用时回退系统随机端口）；
  bearer token 首次生成后存在应用私有 SharedPreferences，不写日志。token 落盘的目的是
  让进程被系统回收后服务器能用同一配置回来，内核不用换地址。
- 请求上限：header 16 KiB、body 1 MiB、单连接 30 s；只接受 `POST /mcp`、
  `initialize` / `ping` / `tools/list` / `tools/call` / `notifications/initialized`。
- 支持的只到 legacy 握手（`2025-06-18`）；内核 `protocolVersion: auto` 探测现代握手
  收到 `-32601` 后自动回退。
- 服务器不随 Expo 模块销毁：dev reload 只销毁 JS/模块，原生进程里的服务器继续监听；
  进程被系统回收后，系统重新绑定无障碍服务时会用同一 token/端口把服务器带起来。
  App 进程真正退出时 socket 由系统释放。内核侧 resume 对同一配置做幂等复用，
  不会在回合进行中无谓重建 MCP 连接。

## 3. 工具目录（固定）

工具目录**不随权限变化**（避免破坏提示缓存）：能力不足时调用返回可操作错误，
而不是隐藏工具。服务器只在"开关 1 或开关 2 已开启"时交给内核。

| 工具 | 参数 | 行为 |
|---|---|---|
| `apps` | `query?` | 列出可启动应用（名称 · 包名），上限 100 |
| `open` | `app?` / `url?` | 启动应用或 http/https 链接；返回新屏幕 |
| `screen` | `cursor?` | 读取当前屏幕文字快照（脱敏）；返回屏幕号与元素编号。长页面分页：页尾给 `cursor`，原样传回继续读同一快照 |
| `tap` | `index`, `long_press?` | 点按/长按最近一次快照里的元素；返回新屏幕 |
| `type` | `index`, `text`, `submit?` | 向输入框写入文字（可选提交）；返回新屏幕 |
| `scroll` | `index?`, `direction`, `amount?` | 滚动节点或整屏；返回新屏幕 |
| `key` | `back|home|recents|notifications` | 全局按键；返回新屏幕 |
| `screenshot` | — | 无障碍截屏，缩放/压缩后作为图片结果 |
| `android_shell` | `command`, `timeout_ms?` | 仅开关 2 + Shizuku；shell uid 执行一次 |

语义：

- 每次 `screen` 生成新的屏幕号（`s1`、`s2`…）与元素编号；`tap`/`type`/`scroll`
  只认最近一次快照。快照过期、包名/窗口变化或服务重连时返回 `STALE_STATE` 并附新快照。
- 长页面分页：`screen` 单页仍限 3000 字符，页尾输出
  `…还有 N 项；继续调用 screen cursor="s3:37"`。`cursor` 指向同一份快照的节点偏移，
  分页不生成新屏幕号、不改变元素编号，`tap`/`type` 可继续使用已看到的编号。
  cursor 失效（换了屏幕或超过 30 秒）时返回错误，要求不带 cursor 重新读屏。
- 动作成功后统一等待约 400–600 ms 再读屏，返回新快照；`screenshot` 与
  `android_shell` 不附加屏幕文字。
- `screen` 只返回文字；截屏是独立工具，避免每次读屏都把图片写进会话库。
- 输出上限：屏幕文字 3000 字符（超出"…另有 N 项"）；shell 输出 8 KiB；
  截屏最长边 720 px、JPEG、目标 ≤200 KiB。

## 4. 读屏与脱敏

- `rootInActiveWindow` + 活动窗口；跳过输入法窗口；节点上限 2000、深度 80、
  预算 2 s。非活动的 `TYPE_SYSTEM` 窗口（状态栏/导航栏）不进入应用快照，
  避免它们的节点带上应用包名；通知栏打开时它是活动窗口，仍会读到。
- 只收可见、有边界的节点；可点容器吸收后代文字（TalkBack 阅读单元），
  滚动容器缩进一级。
- 头部：`屏幕 sN · <应用名> · 竖屏|横屏 · 键盘展开|收起 · 共 N 项`。
- 元素行：`<编号>. [角色] <标签>[ 当前="值"][ 标志]`；
  标志含 `可点/可滚动/可勾选/已选/禁用/⚠`。
- 密码节点（`isPassword`）与敏感标签（密码、验证码、支付、金额、银行卡、
  身份证、CVV 等）不输出值，标 `⚠`，`type` 直接拒绝。
- 文本脱敏（出国前打码）：18 位身份证（GB 11643 校验）→ `«身份证 ****1234»`；
  15–19 位银行卡（Luhn + 上下文排除订单/物流/编号）→ `«银行卡 ****1234»`。
- `FLAG_SECURE` / 安全窗口：截屏返回系统安全错误时，文字明确"安全页面不可截屏"；
  无可用节点时读屏也明确说明。

## 5. 动作

- `tap`：先 `ACTION_CLICK`（含可点祖先，最多 4 层）；不可点时按节点中心
  `dispatchGesture` 手势；`long_press` 用 600 ms 长按。
- `type`：`ACTION_FOCUS` + `ACTION_SET_TEXT`；不支持时返回可操作错误。
  `submit` 在 API 30+ 用 `ACTION_IME_ENTER`，否则报不支持。
- `scroll`：优先节点 `ACTION_SCROLL_*`；不支持时在节点/屏幕内滑动。
- `key`：`performGlobalAction`；`notifications` 需 API 31+。
- `open`：只收 http/https 与已安装应用；不带任意 Intent/extra。
- `screenshot`：`AccessibilityService.takeScreenshot`（API 30+）；旧系统返回
  "此系统版本不支持无障碍截屏"。

## 6. 硬拒绝（在审批之外的第二层）

以下规则不依赖模型、不可被提示词绕过；命中即返回错误：

- 本应用包名：拒绝 `tap`/`type`/`scroll`/`key` 操作（防自我循环）。
- 支付/银行类包名：只读，拒绝一切写操作。
- 系统包（`android`、设置、SystemUI、权限控制器、安装器）：只读，
  拒绝 `tap`/`type`/`scroll`；`back`/`home` 仍可用。
- 节点来自另一个包（状态栏、权限弹窗）时按节点自己的包名判断，不沿用快照包名。
- 密码/验证码/支付字段：拒绝 `type`。
- 安全页面：截屏交给系统判定（`FLAG_SECURE` 返回明确错误）；无节点时拒绝写动作；
  `KEY` 仍可退出。
- `android_shell`：开关 2 未开、Shizuku 未运行或未授权时拒绝；不提供交互式命令、
  不重试已超时的命令。

审批仍是主门：上述拒绝之外，每次工具调用都由内核按当前权限模式询问。

## 7. 两个开关

开关状态存本机 SharedPreferences（`a11y_enabled` / `shell_enabled`，默认 false）。

- **开关 1 手机操控**：打开前展示"会读取屏幕并模拟点按/输入"的说明；打开后引导去
  系统无障碍设置启用 `NibiA11yService`。系统服务是否连通由状态接口读取
  （`ENABLED_ACCESSIBILITY_SERVICES` + 服务静态引用）。
- **开关 2 高级手机操控**：打开前用应用内确认卡列出能力与风险
  （安装/卸载、强制停止、改系统设置、授予权限；仍是 shell uid，不是 root；
  不能绕过 `FLAG_SECURE`）。状态区分：未安装 Shizuku / 未运行 / 未授权 / 已连接，
  并显示系统无线调试是否开启（Shizuku 用它启动服务；配对在 Shizuku 内完成）。
  无线调试由 Shizuku 自己完成配对，App 只给步骤说明与状态检测。
- 两个开关都关闭时，App 不把 `phone` MCP 服务器交给内核。
- **审批展示**：手机工具的审批优先走原生悬浮卡（`SYSTEM_ALERT_WINDOW`、
  `FLAG_NOT_FOCUSABLE`），目标应用保持前台；未授权或悬浮失败时回退到应用内审批卡。
  设置页显示悬浮审批授权状态并提供跳转。悬浮卡提供「拒绝 / 允许一次 / 始终允许」，
  其中「始终允许」对应内核的 `allowAlways`（按工具记住规则；带 `url` 等参数的工具按
  该参数记住）；完全访问仍在应用内切换。
- 开关变化后，当前会话在空闲时 resume 一次（重新带 MCP 列表）；
  正在运行回合时等回合结束再生效。状态页明确显示"下一条消息生效"。

## 8. 能力标志

`phoneStatus()` 返回：

```
available
a11y:   enabled, connected, canScreenshot
shell:  enabled, installed, running, wirelessDebugging, permission(granted|denied|unknown)
settings: a11yEnabled, shellEnabled
```

MCP `instructions` 在握手时按同一份状态生成（无障碍/截屏/高级模式），
模型不必猜。界面只在设置页显示这些状态，不新增首页常驻元素。

## 9. 审计

- 每次调用都在会话记录里（工具名、参数、结果、审批答案），与既有工具同一份审计。
- `android_shell` 结果包含 `uid`、退出码与截断后的输出。
- `screenshot` 结果文本包含尺寸/格式与是否被安全策略拒绝；图片本体交给模型。
- 原生侧不另写日志文件，不记录屏幕文本或 token。

## 10. 验收

1. 真机（PHK110 / Android 16）：
   - 开关 1 + 系统无障碍授权 → `screen` 能读出浏览器/设置页面（含脱敏）；
   - `tap`/`type`/`scroll`/`key` 在浏览器或笔记应用完成一次真实操作；
   - `screenshot` 返回可看图片；`FLAG_SECURE` 页面明确拒绝；
   - 支付/密码/系统页面命中硬拒绝；
   - 关开关后新会话不再出现 `mcp__phone__*`。
2. 开关 2：有 Shizuku 时 `android_shell` 返回 `uid=2000` 与退出码；
   无 Shizuku 时状态页给出安装/启动/授权引导，工具返回可操作错误。
3. 门禁：`pnpm -r typecheck`、`pnpm test`、`node scripts/check-boundaries.mjs`、
   `node scripts/check-public-repo.mjs`；Kotlin 单测覆盖脱敏、目录、MCP 分发。
4. 真机不能验证的项（如无 Shizuku 环境下的授权后执行）在提交说明中标注。

## 11. 非目标（本期）

- 完整的悬浮条/悬浮球、任务暂停/停止面板、后台并行任务、taskId 隔离
  （本期只有审批悬浮卡）；
- OCR、通知监听、剪贴板、任意 Intent、媒体投影录屏；
- 视觉坐标点按（`tap_xy`）与截图坐标授权；
- 插件把手机工具当自己的工具再次暴露。

## 12. 实施状态（2026-11-19）

已落地：

- `app/modules/nibi-phone`：Expo 模块 + `NibiA11yService` + `TreeCapture`/`ScreenFormat`/
  `ScreenMask`/`SafetyGate`/`PhoneActuator` + loopback `McpHttpServer` + `ShizukuShell` +
  `AppCatalog`；9 个固定工具。
- `packages/phone-tools`：纯 TS 状态/开关/MCP 配置接口与门禁纯函数。
- `app/src/phone/status.ts`：原生桥、变更订阅与会话层 revision。
- `app/src/app/settings/phone.tsx` + 设置入口：两个开关、风险确认、状态、能力摘要。
- `useKernelConversation`：插件与手机 MCP 服务器合并；开关变化后在空闲回合自动 resume。
- 内核零改动：手机服务器经 `session/create|resume.mcpServers` 的 HTTP 形态接入。

已在 Android 15 模拟器（x86_64，API 35）验证：

- 开关 1 打开后系统无障碍服务可启用并显示“已连接”；能力摘要出现读屏/点按/截屏。
- 应用内直接请求 loopback MCP：`initialize` 200；`screen` 200，真实读出
  `屏幕 s1 · NIBI-GO · 竖屏 · 键盘收起 · 共 30 项`；`tap` 对本应用返回
  “这是 NIBI-GO 自己的界面…”（硬拒绝）；`screenshot` 200，
  `已截屏 324x720（JPEG，22686 字节）`并带图片内容块。
- 读屏已跳过状态栏/导航栏窗口；节点带自己的包名，跨包节点不会被快照包名放行。

已在 PHK110（Android 16）真机验证（2026-11-19）：

- 内核经 loopback HTTP MCP 完成真实模型回合：`mcp__phone__screen` 返回
  `s1` / 29 项；`open` + `screen` 读出 Chrome 的 Example Domain；
  `tap` 点开 Learn more 跳到 `iana.org/help/example-domains`（标题 Example Domains）；
  `type` 在 httpbin 表单的 Customer name 写入 `NIBI` 并回读（未提交）。
- 悬浮审批真机验证：`open` 的审批卡浮在 App 上，`screen` 的审批卡浮在 Chrome 上；
  目标应用全程前台，`screen` 读到 Chrome 的 `s3` / Example Domain。

已修复与仍存在的问题：

- **已修复**：build 模式审批抢前台。手机工具审批改走原生悬浮卡
  （`SYSTEM_ALERT_WINDOW`、`FLAG_NOT_FOCUSABLE`），真机已验证目标应用保持前台；
  未授权时回退应用内卡片并在设置页引导授权。
- 系统首次跨应用启动确认框（ColorOS「NIBI-GO 想要打开 Chrome」）会盖住悬浮卡；
  选择「30天内允许」后不再出现。这是系统级弹窗，不是审批层。设置页已加说明与
  「打开应用信息」入口，便于开启 ColorOS 的「后台弹出界面」权限。
- 调试构建切后台/重载后出现过一次 `MCP is shut down`。已按根因处理（不是只加缓解）：
  - 原生服务器不再随 Expo 模块销毁，token/端口稳定；进程被系统回收后由无障碍服务重启
    服务器时沿用同一配置；
  - 内核 `session/resume` 对同一份 MCP 服务器集合做幂等复用（连接健康时不再 stop/重建），
    回合进行中的旧工具不会指向被关闭的 manager。
  release 构建复验已通过（见下文 2026-11-20 条）。
- `screen` 的 3000 字符上限已改为分页：页尾给 `cursor`，模型原样传回即可继续读同一份
  快照，编号不变；不再需要靠搜索 URL 绕过长页面。
- 悬浮审批卡已加「始终允许」（内核 `allowAlways`，按工具/参数记住规则）。
- **真机第二轮验证（2026-11-19，PHK110）**：
  - 悬浮卡「始终允许」生效：`open` 按 URL 记住、`screen`/`scroll`/`key` 按工具记住；
    后续调用不再弹卡，目标应用保持前台。
  - `key back` 成功：从 runoob 页面返回 Bing 搜索结果（新屏幕号）。
  - 抓到并修复 `scroll` 的误判：新鲜度检查原先用 `AccessibilityService.currentPackage`，
    输入法或审批悬浮卡存在时会返回别的包名，导致动作被误报「屏幕已经切换」。
    改为按活动应用窗口（跳过输入法与本应用）的包名判断；修复后 PHK110 上
    `scroll down` 后页面内容确实变化，模型对比滚动前后快照确认。
  - 分页：Bing 首页（22 项）与 Bing 搜索结果（49 项）都在单页 3000 字符内读完；
    PHK110 上另用一条 40 段的本地长页面（`127.0.0.1:8000`，adb reverse）验证了多页：
    `s4` 共 47 项，cursor `s4:13` → `s4:24` → `s4:35` → 读完；每页保持同一屏幕号与
    连续元素编号。快照超过有效期后传旧 cursor 会明确报「屏幕快照已过期」，要求重新读屏。
- 仍未验证/受阻：
  - Shizuku：已安装 13.6.0 并以 shell uid 启动（`shizuku_server` 可见）；但 ColorOS 16
    隐藏了「权限监控」开关，Shizuku 报「adb 权限受限」，无线调试配对也搜不到配对服务，
    因此无法给 NIBI-GO 授权，`android_shell` 的授权后执行未验证。开关 2 未开启与
    Shizuku 未运行的错误路径已在真机验证。ColorOS 的官方解法是临时切英文后在开发者选项
    打开 `Disable system optimization`，这属于用户系统设置，未代为修改。
  - `FLAG_SECURE`：已用自建测试 APK 验证。PHK110 的系统 `takeScreenshot` 对安全窗口
    不返回错误码，而是给一张除状态栏外全黑的图；已在 `PhoneActuator` 里检测近全黑画面
    并返回「安全页面不可截屏…」，不再把黑图交给模型。非安全页面截屏回归正常。
  - 无线调试「已开启」分支：在开发者选项真正开启无线调试并允许「1806」网络后，
    设置页显示「已开启」；验证后已关闭无线调试，恢复原状态。
  - ColorOS 跨应用启动确认框：这是系统 BAL 弹窗，App 无法从代码绕过；设置页已加说明与
    「打开应用信息」入口，用户可在应用权限里开启「后台弹出界面」或选「30天内允许」。
  - **release 构建复验（2026-11-20，Android 15 x86_64 模拟器 + 生产签名密钥）**：
    R8 抓到真缺陷——`libnibi_kernel_jni.so` 用 `GetMethodID` 按名字找
    `Sink.onLine/onError`，R8 改名后内核线程抛 `NoSuchMethodError` 并 SIGABRT
    （debug 完全正常）。修复在**被跟踪**的 `kernel-host/android/consumer-rules.pro`
    （`-keep class expo.modules.nibikernelhost.**`）；`app/android` 是 prebuild 生成目录，
    规则写在那里会在下次 prebuild 丢失。复验通过：无障碍绑定、loopback MCP 9 工具、
    `screen` 21/29 项、非安全页截屏 324x720 JPEG、FLAG_SECURE 探针返回「安全页面不可截屏」、
    `kill -9` 主进程后无障碍重绑并用同一 token/端口 39617 恢复、内核 `nativeStart=true`、
    mock 模型回合调用 `mcp__phone__screen` 且应用内审批卡与悬浮审批卡都能放行并返回结果、
    会话 workspace 仍持久化为 `files/workspaces/<id>`。
    同一签名的 0.1.0 已装到 PHK110（卸载 debug 后全新安装）：通知授权、`:kernel` 进程、
    无障碍「已连接」、loopback 39617 在 `/proc/net/tcp6` 监听；Provider/Key 随卸载清空。
    随后 v0.1.1 已发布并在同一台 PHK110 上覆盖升级（0.1.0→0.1.1）：versionCode 2、
    数据保留、内核/无障碍/39617 正常；真实模型回合待重新配置 Provider 后再验。