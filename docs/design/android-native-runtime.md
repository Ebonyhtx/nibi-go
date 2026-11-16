# GO Android 原生内核与运行时（fork 方案）

> 状态：**2026-11-15 运营者定案**，实施前设计基线。
> 本文覆盖：内核 fork、Android SH 方言与 hooks、jniLibs 三件套、Node/Python 原生运行时、
> targetSdk 36 的兼容层、声明式 UI 插件、两级手机操控、workspace 边界、安全与能力上限。
>
> 关联：ADR D19（进程内 `libnibi.so`）、D20（`:kernel` 进程）、D22（16 KB 对齐）、
> D23（ABI 与升级）、T9（Android shell）；实现状态见 `docs/plan.md`「C0 进展」。

## 0. 一句话

GO 走**自有内核（fork）+ 自有 Android 原生用户态 + 声明式 UI 插件 + 两级手机操控**：
内核和模型默认被约束在 kernel 工具与 workspace 里；shell/bash/Node/Python 是显式的
能力面，由兼容层把 Android 36 的限制吸收掉，而不是让模型试错。

## 1. 已定决策

1. **内核 fork 到 NIBI-GO 公开仓**，Android 内核由 GO 自包含维护、自改造；
   **上游不再为 GO 发 Android npm 包**，GO 不再为内核改动向上游提单。
2. fork 后做 **Android 原生适配**：新增 Android SH 方言，Bash 工具与 hook 都能用；
   内核系统提示与原生工具知道“我在 Android、workspace 在哪、能用什么”。
3. **bash / busybox / git 三件套进 GO 包体**（jniLibs），保持 SHELL 可见。
4. **Node / Python 进 GO 包体**（Android/bionic 构建），保持 SHELL 可见；
   npm/pip 装到 App 私有目录，由兼容层执行。
5. **UI 插件走声明式 slots**：插件逻辑在子进程，App 只渲染 JSON 视图；
   插件不能注入 RN/JS，不能改 App 外壳。
6. **手机操控两个开关**：
   - 开关 1「手机操控」：无障碍 + 截屏/手势，明确告知会操控手机；
   - 开关 2「高级手机操控」：Shizuku/无线调试（shell uid），明确告知能力上限与风险；
   - App 提供一站式检测/引导/状态/断开降级，但不自带提权。
7. **Workspace 必须先定义**（见 §6）。
8. **targetSdk 36 不变**；不接受为了 exec 回退到 28，也不做 rootfs/PRoot。

非目标：不做 Ubuntu/rootfs/PRoot；不做 `isolatedProcess` 全功能沙箱；不做插件改原生外壳；
不做 root；不假设 Google Play 上架（侧载优先，但保留 36 的现代行为）。

## 2. 内核 fork：边界与责任

### 2.1 仓库与产物

- fork 以 Android 支持为目标放进 GO 公开仓（`kernel/` 或等价目录），上游作为
  **只读上游源**保留合并能力。
- GO 自己构建并发布：
  - `libnibi.so`（jniLibs，C ABI v1，API 24，16 KB 对齐）；
  - 开发/调试用 `nibi-rs`（不进 APK 运行路径，除非后续决定）。
- 构建可复现：固定 Rust 工具链、NDK r27、cargo lock；CI 产出 sha256 + `build.json`
  等价清单；`scripts/android-kernel/` 的校验逻辑改为校验 GO 自建产物。
- 上游同步策略：按安全修复/协议能力合并，不追每个提交；Android 分支允许持续分叉。
  合并冲突由 GO 承担；上游不再背 Android 适配。

### 2.2 Android 原生适配（fork 的收益）

- `ShellDialect::AndroidSh`：`/system/bin/sh`（mksh）是一等 shell；
  发现顺序：jniLibs 的 bash（若有）→ `/system/bin/sh`；
  `SHELL` / `NIBI_SHELL` 由宿主设置。
- **hooks 使用同一套 shell 发现**（不再固定 `/bin/bash`）；git hooks 另见 §4.4。
- 系统提示注入环境事实：Android 版本、workspace、可用 shell、Node/Python、手机模式、
  网络/审批策略；工具描述按环境生成，模型不用猜。
- 原生内核工具（Read/Write/Edit/Grep/Glob/Workspace/Git/Phone…）是默认安全面；
  shell/解释器是显式能力面，受审批与 workspace 策略约束。

### 2.3 与既有 ADR 的关系

- **D19 保留**：仍然是进程内 `libnibi.so`（fork 自建），不 exec 自带二进制。
- **D20 保留**：内核继续跑在 `android:process=":kernel"`，Binder + socketpair。
- **D21 对 Android 失效**：不再消费上游 Android 预发布 npm 包；上游发版只作参考。
- **D22 保留**：所有进 APK 的 native 库/可执行文件 16 KB 对齐。
- **D23 转为 GO 自有**：ABI 版本、升级、回滚由 GO 定义；不再与上游桌面共享升级节奏。
- 许可证：fork 代码与随包二进制（bash/busybox/git/Node/Python）都要带上游 NOTICE/许可；
  公开仓的 README 仍只写产品口径，不暴露上游版本/技术栈（与既有公开仓纪律一致）。

## 3. 运行时布局

```
nativeLibraryDir/arm64/           # 只能扁平 lib*.so；可 exec（Android 36 已验证）
  libbash.so  libbusybox.so  libgit.so
  libnode.so  libpython.so
  libnibi_run.so                  # 兼容执行器（关键）
  libnibi_hook.so                 # git hook dispatcher

filesDir/runtime/bin/             # symlink farm -> nativeLibraryDir/lib*.so（已实测可 exec）
  bash / busybox / git / node / python / python3 / nibi-run
filesDir/runtime/hooks/           # symlink farm -> libnibi_hook.so（core.hooksPath 指这里）
  pre-commit / commit-msg / …
filesDir/
  workspaces/<sessionId>/         # 默认工作区
  packages/npm/                   # npm 包（库）
  packages/pip/                   # pip 包（库）
  plugins/<pluginId>/             # 插件数据/依赖
  cache/                          # 临时文件
```

`$NIBI_BIN` = `filesDir/runtime/bin`。PATH 顺序：`$NIBI_BIN` → `/system/bin`。
Bash 通过 `BASH_ENV` 加载兼容函数；`sh` 通过 `ENV` 加载同一套。
**注意**：jniLibs 里只能有 `lib*.so` 文件名，不能有 `bash`/`node`/`hooks/` 这些名字；
用户可见名字全部由 `$NIBI_BIN`/`runtime/hooks` 的 symlink 提供（真机已验证 symlink 目标可 exec）。

## 4. targetSdk 36 兼容层（把摩擦吸收在工具层）

Android 36 的硬限制：**App 数据目录里的文件不能 `execve`**；`nativeLibraryDir` 可以。
兼容层的目标是：模型照常写桌面命令，工具层负责翻译。

### 4.1 `nibi-run`

jniLibs 里的固定可执行文件，解析并执行：

- **shebang 脚本**：读 shebang，映射到 jniLibs 的 `node`/`python`/`bash`，执行
  `interp script args`；
- **npm 包 bin**：解析 `node_modules/.bin` 的 symlink/JS 入口，按 shebang 跑 `node`；
- **pip console script**：读 shebang，走 `python`/`python -m`；
- **App 数据里的 native ELF**：明确报错：
  “Android 16 不能执行 App 数据里的二进制；请改用 Android 构建版本，或走桌面/远端。”
- Bash 里：`command_not_found_handle() { nibi-run "$@"; }`。

### 4.2 npm / npx / pip 包装

- `npm` → `node <npm-cli.js>`；`npx` → `node <npx-cli.js>`；
- `pip` → `python -m pip`；`python3`/`node` 指向 jniLibs 固定二进制；
- 安装前缀指向 `filesDir/packages`；`nibi-run` 读取 npm `.bin` 与 pip entry_points；
- `npm run` 的脚本 shell 设为 jniLibs 的 bash，并加载 `BASH_ENV`，让脚本里的
  `command_not_found_handle` 生效。

> **Phase 2 更新（2026-11-16）**：npm `.bin` 的**解析**已在 `nibi-run` 实现并真机验证
> （`$NIBI_PACKAGES/npm/node_modules/.bin/<name>`，包括 symlink→JS 的 shebang 映射）；
> 安装后把 `.bin/*` 重写成 `$NIBI_BIN/<name> -> nibi-run` 的安装器步骤随 Phase 3 的 node
> 一起落地。当前 `nibi-run` 已跳过指向自身的 `$NIBI_BIN` shim，避免自递归。

### 4.3 busybox

- `busybox` 本身在 jniLibs（`libbusybox.so`）；常用 applet 由 `BASH_ENV` 定义 shell function
  （`grep() { busybox grep "$@"; }` 等），或统一 `busybox <applet>`。
- 需要独立名字时用 `$NIBI_BIN` 的 symlink → `libbusybox.so`（symlink 目标 exec 已真机验证）；
  不把 applet 复制成 app 数据 ELF。

### 4.4 git hooks

Git 会直接 `execve` hook。做法：

- jniLibs 只放一个 `libnibi_hook.so`（不能放 `pre-commit` 这种文件名，也没有子目录）；
- `filesDir/runtime/hooks/` 放 `pre-commit`、`commit-msg` 等 symlink → `libnibi_hook.so`
  （symlink 目标 exec 已真机验证）；`git` 包装器设置 `core.hooksPath=$NIBI_HOME/runtime/hooks`；
- dispatcher 通过 `argv[0]` 识别 hook 名，再读取仓库 `.git/hooks/<name>`，用 `bash`/`nibi-run` 执行；
- hook 内调用 app 数据 CLI 也走 `nibi-run`。

### 4.5 内核工具层

fork 的优势放进内核，而不是只靠 shell：

- `exec`/`shell` 工具：自动把 app 数据命令交给 `nibi-run`，设置 cwd/PATH/env；
- `package_install` 工具：npm/pip 安装、登记 bin 到 `$NIBI_BIN`；
- `git` 工具：自动设置 hooksPath，归因 hook 输出；
- 错误统一“原因 + 下一步”，例如：
  “这是 App 数据 ELF，Android 16 不能 exec；用 `python -m` 或安装 Android 构建版本。”

### 4.6 模型侧提示

系统提示固定包含一小段：

```
环境：Android，workspace=<path>；shell=bash|sh；node/python 可用；
包 CLIs 用 nibi-run/command_not_found_handle；App 数据 native ELF 不可执行；
手机模式：off|accessibility|shell；网络/审批策略：…
```

工具描述与错误信息承担大部分适配，模型不需要背 Android 规则。

## 5. 能力边界（targetSdk 36）

| 层级 | 例子 | 摩擦 | 处理 |
|---|---|---|---|
| 0 固定工具 | bash/git/busybox/node/python | 无 | jniLibs |
| 1 纯库 | `npm i lodash`、`pip install requests` | 无 | 装到 packages |
| 2 包 CLI | `eslint .`、`black x.py`、`npx` | 低 | `nibi-run`/bash hook |
| 3 脚本 | `./deploy.sh`、`python x.py` | 低 | shebang → 解释器 |
| 4 原生 addon | `better-sqlite3`、`numpy` | 中高 | 仅 Android/bionic 构建；无则不支持 |
| 5 下载的 native ELF | `esbuild`、`playwright` 浏览器 | **不可 exec** | 预置 Android 版到 jniLibs，或桌面/远端 |
| 6 设备编译 | `node-gyp`、`cargo build`、`make` | 高（缺工具链） | 不在手机上做，走桌面 |

**明确不接受的说法**：targetSdk 36 下“装完 npm/pip 的任何 CLI 都能直接跑”不成立；
“下载的 native 二进制能执行”不成立；“手机上能编译 Android App”不成立（没有 SDK/JDK，
也不在计划内）。这些要在产品文案和模型提示里说清。

## 6. Workspace 定义

- 默认根：`filesDir/workspaces/<sessionId>/`；新会话自动创建；可切换/重命名/删除。
- 临时文件：`cacheDir/sessions/<sessionId>/`；不持久。
- 插件数据：`filesDir/plugins/<pluginId>/`；默认只能访问自己的目录。
- 包目录：`filesDir/packages/{npm,pip}`；不写全局 site-packages/node_modules。
- 共享存储：默认**不**直接读写 `/sdcard`；通过 SAF/MediaStore 导入/导出，
  或侧载版由用户显式开启 All files access（targetSdk 36 需特殊授权）。
- 路径策略：内核工具解析 symlink、拒绝 `..`、拒绝 workspace 外写入；
  读取范围默认 workspace + 显式授权目录。
- shell/Node/Python 的 cwd 固定 workspace；`HOME`/`TMPDIR` 指向会话目录；
  provider key 不进子进程 env。
- 配额：workspace 大小上限、命令超时、输出截断、进程树回收。
- 模型提示写明 workspace 路径与可访问范围。

**边界诚实说明**：workspace 是内核工具的策略边界，不是 OS 级沙箱；shell/解释器仍是
app uid，能读 App 可读的其他路径。要硬隔离只能限制 shell/解释器，或走 `isolatedProcess`
+ broker（不在本方案默认路径）。

## 7. 声明式 UI 插件（slots）

插件是运行在 Node/Python 子进程里的逻辑；App 不执行插件代码，只渲染它声明的 JSON。

| 插槽 | 位置 | 每插件上限 | 备注 |
|---|---|---|---|
| 工具卡 | 对话记录 | 每工具一个 | `presentationMeta` + view |
| `composer.actions` | 输入框上方胶囊 | 2 | 文字 ≤10 字 |
| `message.actions` | 助手消息长按菜单 | 2 | 按插件分组 |
| `composer.strip` | 输入框上方状态条 | 1 | 多插件轮流 |
| `panels` | 对话详情/全部功能/聊天页弹层 | 4 | 视图 + 数据 + 动作 |
| `composer.tools` | 加号面板 | 2 | 与附件磁贴同网格 |
| `session.actions` | 右侧栏「信息」操作行 | 2 | 带 sessionId |
| `turn.note` | 回合脚注末尾 | 1 | 只读文字 |
| Web Island | 网页插件的面板 | 按预算 | WebView + 路由守卫 + 降级 |

约束：

- 视图是受限 JSON（组件目录、文字预算、样式上限），不能注入任意 widget；
- 数据推送限频/限大小；动作 3 秒窗口；错误只丢一项，连续违规降级网页版；
- 版本用 `caps`/`minApp`/`adaptView` 兼容；老 App 忽略未知字段；
- 插件可加工具/命令/技能/设置，不能改导航/主题/首页，不能跨插件 UI；
- 插件原生代码只能是预置的 Android/bionic 模块，不能运行时加载任意 native ELF。

**插件上限**：可以做到“功能丰富的助手扩展”（面板、图表、按钮、状态、工具卡、网页视图）；
不能做到“换掉 GO 的外壳”。

### 7.1 实现（Phase 4，2026-11-17）

- **契约**：`packages/plugin-contract`（纯 TS，Node 可测）。清单文件
  `nibi-go.plugin.json`：`schemaVersion:1`、`id/name/version`、`minApp`、`caps`、
  可选 `runtime:{type:"mcp",serverName,entry,alwaysLoad?,timeoutMs?}`、`contributes`。
  当前渲染 `toolCards` / `composer.actions` / `composer.strip` / `composer.tools` /
  `message.actions` / `session.actions` / `panels` / `turn.note` / Web Island。
- **视图 v1**：文字/行/列/卡/徽标/分隔/进度/列表/按钮/间距；数据绑定
  `{ "$": "data.x" }` 与 `{{data.x}}` 插值。预算：工具卡 8KiB/40 节点/6 层、面板
  32KiB/120/8、状态条 2KiB/8/3；超出整条不渲染。`tabs`/`gallery`/未知组件换成 v1
  替身并标记“已降级”，单条过坏只丢该条。
- **效果**：`insert/toast/copy/open/link/command/refresh`，每次 ≤4；`insert` 只改草稿、
  永不自动发送；`link` 只收无凭据 https；`command` 不能叫 permission；3 秒点按窗口由
  App 执行。`copy`/`command` 当前没有原生桥，执行时如实提示暂不支持。
- **工具卡路径（不改内核协议）**：插件 MCP 工具在 `tools/list` 的
  `_meta.ui.resourceUri` 让内核投影出 `display.kind="mcp_tool"`；结果里的
  `structuredContent` 与 `_meta` 分别进 `display.ui.structuredContent` /
  `display.ui.widgetMeta`。App 用 `display.ui.pluginId`（= 服务器名）与 `toolName`
  匹配清单里的 `toolCards`，数据绑定到 `data.tool.structured`。
- **宿主**：内置插件首次启动写到 `filesDir/plugins/<dir>/`；MCP 入口用随包 Node 以
  `node server.mjs` 启动，经 `session/create|resume.mcpServers` 交给内核（内核不持久化
  这份配置，恢复时要再带一次）。MCP 子进程走内核的环境白名单，拿不到 Provider key。
- **样例**：`nibigo.weather`（MCP 工具 + 工具卡）、`nibigo.quick`（输入胶囊/状态条/加号
  工具/消息动作）、`nibigo.usage`（面板/会话动作/回合脚注/Web Island，故意用 v2 `tabs`
  演示降级）。插件中心可启停、看能力/清单问题/降级原因、打开面板与网页面板。
- **Web Island**：清单 `webIslands` 支持 `url`（仅 https、无凭据）或内联 `html`
  （≤16KiB），每插件 ≤2；App 用 WebView 渲染，只放行 `about:blank` 与同源 https 导航，
  8s 未完成或加载失败显示可重试降级页。开发期额外给一个不可达地址用于验证降级。
- **验证边界**：MCP stdio 与内核 CLI `--mcp-config` 端到端通过；Metro Android bundle
  200。真机（PHK110 / Android 16）已验证：插件中心 3 个样例与启停、输入胶囊插入草稿、
  状态条、回合脚注、加号工具面板插入模板、消息长按菜单、会话行「插件动作」、面板绑定/
  v2 `tabs` 降级/刷新、天气 MCP 工具经审批后工具卡渲染（折叠过程行里也保留）、Web Island
  内联渲染与超时降级。x86_64 模拟器跑不了 arm64 内核，不作为验收环境。
- **未做**：动态数据推送（当前槽数据来自宿主/工具结果，没有插件推送通道）、`copy`/
  `command` 的原生桥、插件设置/命令面、插件市场与签名。

## 8. 手机操控

### 8.1 开关 1：手机操控（无障碍）

- 能力：读 UI 树、点按/滑动/输入、全局返回/主页/最近任务、截屏/录屏观察、通知监听；
- 授权：系统无障碍 + MediaProjection/通知权限；App 内明确提示“会操控手机”；
- 上限：能操作任意 App 的 UI；不能装/卸 App、不能改系统设置、不能读别的 App 私有数据。

### 8.2 开关 2：高级手机操控（shell uid）

- 前置：用户安装并启动 Shizuku，或开启无线调试并配对；App 提供检测/分步引导/状态；
- 能力：`pm install/uninstall`、`am force-stop`、`settings put`、`pm grant/revoke`、
  `input`、`screencap`、`uiautomator` 等；
- 边界：仍是 shell uid，不是 root；不能读别的 App 私有数据（debuggable 的 `run-as` 例外）；
  不能绕过 `FLAG_SECURE`；
- 风险提示：开启前列出能力清单与风险，需明确确认；断开/重启自动降级并在 UI 显示
  effective capability；
- targetSdk 36 适配：包可见性用 `<queries>`/`QUERY_ALL_PACKAGES`（侧载）；通知/前台服务
  按现代规则处理。

## 9. 安全模型

1. **OS 层**：App uid + SELinux；无 root；进不了别的 App 私有目录/系统分区。
2. **默认工具面**：内核原生工具 + workspace 策略 + 审批；模型默认被“关在”工具契约里。
3. **显式能力面**：shell/Node/Python/手机高级模式；逐类审批、审计、能力 flags；默认不静默提权。
4. **供应链**：jniLibs/运行时固定版本 + sha256；插件市场签名 + revision；
   npm 默认 `--ignore-scripts`；pip 优先 wheel；依赖只进插件/包目录。
5. **凭据**：provider key 只在内核/Keystore；不进 shell/Node/Python env；网络走内核 egress。
6. **审计**：命令、包安装、网络、文件写入、手机操作都记录；输出截断；进程树回收。
7. **残留风险**：同 uid 下插件/脚本不是硬隔离；恶意代码可读 App 数据。
   要更强隔离只能 `isolatedProcess` + broker 或独立 App/工作资料；本方案默认不承诺硬隔离。

## 10. 实施阶段与验收

### Phase 0：fork 落地

- GO 公开仓接收 Android 内核 fork；固定工具链/NDK；CI 产出 `libnibi.so` + 校验清单；
- 16 KB 对齐、API 24、C ABI v1 断言；`:kernel`/Binder/socketpair 回归；
- 验收：真机启动、会话/流式/审批/改动卡/折叠全部回归。

### Phase 1：Android SH 方言 + hooks

- `ShellDialect::AndroidSh`；bash/jniLibs 优先、`/system/bin/sh` 回退；hooks 同源发现；
- 系统提示注入环境事实；
- 验收：无 bash 时 `echo`/管线/审批/hook 全通；有 bash 时同样通过。

### Phase 2：三件套 + 兼容层

- jniLibs bash/busybox/git；`nibi-run`、npm/npx/pip 包装、git hooks dispatcher、busybox 函数；
- 验收：50 条常用命令矩阵；`npm install` 纯库/CLI、`pip install` 纯库/console script、
  git commit/hook、`./script.sh` 经 nibi-run 全部可跑；App 数据 ELF 报错可操作。

### Phase 3：Node/Python 原生运行时

- 选择 bionic 构建来源（nodejs-mobile / Termux / NDK 自建），pin 版本；
- 验收：node/python 启动、纯 JS/Python 包、至少 3 个原生 addon（有 Android 构建的）通过；
  记录不支持的包类型与错误文案。

### Phase 4：声明式 UI slots

- 先做工具卡 + composer.actions + panels；JSON 视图/数据/动作/错误隔离；
- 验收：3 个示例插件（工具卡、胶囊、面板）在本机与远端主机降级正确；
  老版本字段忽略；Web Island 超时降级。

### Phase 5：手机两开关

- 无障碍模式；高级模式检测/引导/能力 flags/断开降级；
- 验收：两档能力矩阵、风险确认、审计、无 Shizuku 时自动降级。

### Phase 6：workspace/策略/指标

- workspace 根、配额、路径策略、模型环境提示；命令成功率/重试/错误分类指标；
- 验收：workspace 外写入被内核工具拒绝；shell 逃逸风险在文档/提示中明示；
  50 条命令矩阵回归。

## 11. 待验证/开放问题

1. **Node/Python bionic 来源与版本**：nodejs-mobile 是否支持 Node 24；Python 3.12 用
   Termux/Chaquopy/NDK 哪条；16 KB 对齐如何保证。
2. **native addon 加载**：App 数据 `.node`/C 扩展能否 `dlopen`；若不能，是否需要预置到
   jniLibs 或放弃。
3. **nested spawn**：Node `child_process` / Python `subprocess` 调 app 数据 CLI 的
   失败边界；是否需要在 SDK/提示里要求用 `nibi-run`/`process.execPath`/`sys.executable`。
4. **git hooks dispatcher**：`core.hooksPath=filesDir/runtime/hooks`（symlink → `libnibi_hook.so`）
   对 worktree/bare repo 的兼容性；symlink exec 已验证，git 侧待真机。
5. **包管理器**：npm/pip 安装到 App 目录的路径/环境变量/权限；`--ignore-scripts` 与需要构建
   脚本的取舍；**npm `.bin` 存在但 exec 被拒** 的拦截方案（§4.2/§13）。
11. **静态二进制 TLS 对齐**：静态 bash/busybox/git 必须按 bionic 要求构建（§13.3）。
6. **公开仓许可**：fork 代码与运行时二进制的 NOTICE/源码获取方式；公开仓文档口径。
7. **targetSdk 36 的共享存储**：SAF vs All files access 的产品选择；手机操控包可见性。
8. **FGS 6h/24h**：长任务 checkpoint/续跑策略；与 `:kernel` 生命周期。
9. **APK 体积**：三件套 + Node + Python + 内核的预算；是否分 ABI/分 edition。
10. **插件 slots 的协议版本**：与桌面/远端主机的降级边界。

## 12. 能力上限结论

- **Shell/Git**：真 bash + Android sh + hooks + busybox/git，接近桌面。
- **Node/Python**：纯语言包接近桌面；原生 addon 需 Android 构建；安装的 CLI 通过兼容层
  可跑，下载的 native ELF 不可 exec。
- **UI 插件**：原生级扩展面（面板/胶囊/状态/工具卡/网页岛），不能改外壳。
- **手机**：无障碍 UI 自动化 + 可选 shell uid 系统操作；无 root、无别的 App 数据。
- **安全**：内核工具 + workspace + 审批是主边界；shell/解释器是 app uid 的显式逃逸面，
  不承诺硬隔离。

这套方案买到的是：**现代 targetSdk 36 + 自包含 Android 原生用户态 + 内核级工具安全**；
代价是：**App 数据里的 native ELF 不能执行、原生包覆盖有限、fork 维护和公开仓合规**。

## 13. 实施校正（2026-11-15 review，含真机实测）

1. **jniLibs 只能扁平 `lib*.so`**：`bash`/`node`/`python`/`nibi-run` 在 APK 里必须是
   `libbash.so` 等；用户可见名字由 `$NIBI_BIN` 的 symlink 提供。§3 已按此修正。
   `nativeLibraryDir/hooks/` 这种子目录不存在。
2. **symlink exec 已真机验证**：App 私有目录 `bin/node -> nativeLibraryDir/libnibi_probe.so`，
   直接从 App 进程执行、以及走 PATH 执行都成功（`exec-ok-from-nativeLibraryDir`）。
   这是 npm `.bin`、`env node`、git hooks 三条链的共同基础。
3. **静态二进制要过 bionic TLS 对齐**：静态探针被拒（`TLS segment ... alignment is 8, needs 64`），
   动态 PIE 正常。三件套若静态构建，必须按 Android/bionic 目标处理；16 KB 对齐仍按 D22。
4. **npm `.bin` 仍未解**：见 §4.2 的提示；Phase 2 验收前必须先做这个 spike。
5. **`./script.sh` 直接执行**：app 数据脚本文件存在时 shell 会直接 exec（被拒），
   `command_not_found_handle` 不会触发；内核 exec 工具必须改写为 `nibi-run script`，
   交互 shell 里应提示用 `bash script`。
6. **Node/Python 的 dlopen（已真机验证，2026-11-16）**：用 NDK 编的探针（临时
   `libnibi_dlprobe.so`，未入库）在 app 进程 `dlopen` App 数据里的 `libprobe_plugin.so`
   与改名后的 `plugin.node`，两者都返回 `dlopen-ok value=42`。结论：**App 数据不可
   execve，但可以 dlopen**；npm/pip 的 native addon 可以装在 `filesDir/packages`，
   不需要预置 jniLibs。可执行入口仍必须走 jniLibs/nibi-run。
7. **fork 治理**：D24 改变了 D17 的「不 fork/不养 Rust 构建链」；AGENTS、CI、许可证审计
   必须同步（见 §2.3/§11）。fork 基线建议 nibi-client `dev` `1369b043`。

### 13.1 Phase 2 落地校正（2026-11-15，实际构建/真机 run-as）

8. **bionic 缺的 applet/接口是产品边界，不是构建偶然**：busybox 必须关闭
   `sys/kd.h` 相关（loadfont/setfont/conspy）、SysV IPC（ipcrm/ipcs/logread）、utmp/wtmp、
   `getlogin_r`（logname）、`getusershell`（su）、`syncfs`、`adjtimex`、`ether_hostton`、
   `mntent`（mount/swap）、hush（glob/sigisemptyset）、tc（CBQ 头）。清单固化在
   `scripts/android-runtime/build.sh`，改配置要过 `--check` 与 50 命令矩阵。
9. **bash**：bionic 没有 `getgrent`（关闭组名补全）、`mblen` 直到 API 26（用
   `nibi_mblen` 包装 `mbrtowc`），bundled termcap 的 `tparam.c` 缺 `<unistd.h>`。
   readline/ncurses 静态链接进 bash，最终只依赖 libc/libdl。
10. **git**：bionic 没有 `pthread_setcancelstate`（`NO_PTHREADS=1`）；
    `sync_file_range`/`getrandom` 在 API 24 不可用（make 变量覆盖 + `CSPRNG_METHOD=arc4random`）；
    `NO_OPENSSL=1` 让 git 自身不链 libcrypto，TLS 只由 `git-remote-http`（静态 curl+OpenSSL）承担。
11. **busybox 的 `make install` 必须带同一套 `CC/AR/...`**：否则 install 目标会隐式重建
    `busybox`，用 host gcc 产出 x86-64，并静默替换掉 Android 产物。校验器的 ELF 身份检查
    抓到了这一点；所有 `make` 入口现在共用同一个函数。
12. **三件套统一动态 PIE**：静态探针的 `PT_TLS align=8` 再次复现（bionic 要求 64），
    不再评估静态；全部加 `-Wl,-z,max-page-size=16384`，`--check` 断言 LOAD 对齐与
    `PT_INTERP=/system/bin/linker64`。API 24 符号面用 NDK 的 24 版 stub 逐符号比对，
    OpenSSL 的 `getentropy`/`memfd_create` 是弱符号（旧系统解析为 0）。
13. **legacy packaging 是必需的**：`expo.useLegacyPackaging=true` → APK
    `extractNativeLibs="true"`，libs 才会解压到 `nativeLibraryDir`；否则 symlink 目标不存在。
    该值由 `app/plugins/withAndroidLegacyPackaging.js` 在 prebuild 时固定。
14. **BusyBox 的 `BB_GLOBAL_CONST` 在 clang 18 下会误编译**：`ptr_to_globals` 的 store
    与 `G` 的读取被重排，`awk` 启动时写 `NULL+4`（真机 tombstone `awk_main+0x40`）。
    构建加 `CONFIG_EXTRA_CFLAGS="-DBB_GLOBAL_CONST="`（上游 `libbb.h` 注释给出的开关）；
    50 命令矩阵里的 `awk` 用例作为回归。同类使用 `ptr_to_globals` 的 applet（ash/vi/diff）
    一并受益。
15. **Android 的 git 身份与 HTTPS 信任根**：
    - bionic 对 app uid 的 `getpwuid()` 可能返回 `pw_gecos`/`pw_name` 为空的结构，git
      `ident_default_name` 会 `strlen(NULL)`。构建加 `NO_GECOS_IN_PWENT=1`，并 patch
      `xgetpwuid_self` 在字段为空时走 fallback；运行时用受管 `GIT_CONFIG_GLOBAL`
      （`runtime/etc/gitconfig`）提供默认身份 `NIBI-GO <nibi-go@localhost>`，并 include
      用户的 `~/.gitconfig`（用户/仓库级可覆盖，hooksPath 仍由受管配置兜底）。
    - OpenSSL 3.5 + curl 的 `--with-ca-path=/system/etc/security/cacerts` 在真机不生效
      （GitHub/GitLab/Gitee 都报 unable to get local issuer）。改为随包
      `assets/cacert.pem`（Mozilla 根，2026-11-05，sha256 固定），运行时设
      `GIT_SSL_CAINFO` / `CURL_CA_BUNDLE` / `SSL_CERT_FILE`；企业 CA 可覆盖这些变量。
    - npm `.bin`：nibi-run 已解析 `$NIBI_PACKAGES/npm/node_modules/.bin/<name>`
      （以及 `pip/bin`），并跳过 `$NIBI_BIN/<name> -> nibi-run` 自身；安装器把 `.bin`
      重写成 nibi-run shim 的步骤随 Phase 3 的 node 一起做。
16. **App 启动路径验收抓到的两件事（2026-11-16）**：
    - `KernelService`（默认 `:kernel` 服务模式）仍留在 Phase 1 的 `prepareShell`，没有调用
      `NibiRuntime`；只有进程内路径接了。真机表现是 `:kernel` 起来了但 `files/runtime` 仍为空。
      修法：service 与 module 共用 `NibiRuntime.install/applyEnvironment`。
    - bash 交叉编译时 `configure` 无法运行 `getcwd` 的探测，`bash_cv_getcwd_malloc` 默认 no，
      于是链接了 **bash 自带的 getcwd 替代实现**（opendir/lstat `..`），在
      `/data/user/0/...` 上 EACCES，表现为每次 Bash 工具都打印
      `shell-init: error retrieving current directory` 且 `pwd` 失败。bionic 的
      `getcwd(NULL,0)` 是支持的，显式 `bash_cv_getcwd_malloc=yes` 后 bash 用 libc getcwd；
      真机 `pwd` 返回 `/data/data/.../files`。
    - 验收证据：App 内 mock 模型 → Bash 工具 → 审批 → 输出
      `SHELL=…/runtime/bin/bash`、`BASH_VERSION=5.2.37(1)-release`，
      并写出 `pwd-proof.txt`（`/data/data/top.nibistudio.nibigo/files`）。
18. **Phase 3 运行时选型改为自建（2026-11-16 运营者决定，不用 Termux 二进制）**：
    - **Python 3.13.18 已完成并真机验证**：CPython 官方 Android 支持；宿主 Python
      out-of-tree → 用 NDK 交叉编译；自建 libffi 3.4.8 / zlib 1.3.1（PIC）与
      OpenSSL 3.5.4；`libpython3.13.so` strip 后 5.2MB，stdlib 裁剪后 29MB
      （zip 11MB）；`ensurepip` 的 pip wheel 预装到 site-packages。真机
      `python 3.13.18 + OpenSSL 3.5.4`、`ssl/zlib/ctypes`、`pip 26.2.2`、
      `pip install requests`、`pyfiglet` console script（经 nibi-run/BASH_ENV）全部通过。
    - **Node 24.22.3 已完成并真机验证（2026-11-16）**：上游 `android-configure`
      官方声明 Android “not supported”，`patch-node.py` 补齐五处：
      1. gyp 只在环境里有 `CC_host`/`CXX_host` 时生成 host 工具集（`CrossCompileRequested`）；
         否则宿主 mksnapshot 拿不到 host 对象。
      2. 宿主 mksnapshot 跑 arm64 模拟器，需要 POSIX trap handler / simulator 三个源文件；
         而 gyp 的 `OS="android"` 让它们被排除。补丁只对 `_toolset=="host"` 打开，
         **target 仍保留 V8 的 Android 禁用以避免 `V8_TRAP_HANDLER_SUPPORTED` 的 `#error`**。
      3. V8 bionic `execinfo`、`push_registers_asm` host stub、cpufeatures 链接。
      4. `common.gypi` 的 Android 链接加 `-Wl,-z,max-page-size=16384`（否则 LOAD 4KB，
         Android 16 的 16KB 页设备装不上）。
      5. gyp 的 `.host.mk` 补丁会在每次重生成时丢失，构建脚本必须“打源补丁 → gyp →
       再打 mk 补丁 → touch out/Makefile”。
      真机：`node v24.22.3 arm64 android`、`npm 11.19.1`、`npm install cowsay`
      （TLS 用随包 CA）、`npm run` 的 `.bin` 改写（`nibi-run` 从
      `node_modules/.bin/.nibi-targets/<name>` 取回真身；直接 `require()` 与
      `#!/usr/bin/env node` 脚本都通过）、N-API addon `require('./hello.node')` = 42。
      `libnode.so` strip 后 91MB。**不采用 Termux 预编译包**（供应链可控性原因）。
    - **Bash 工具的环境投影（2026-11-17）**：内核给用户命令的环境是白名单
      （`kernel/crates/env-local/src/shell/environ.rs`）。Android 运行时的
      `LD_LIBRARY_PATH`、`PYTHONHOME`、`PYTHONUSERBASE`、`NIBI_BIN`、
      `NIBI_RUNTIME_DIR`、`NIBI_NATIVE_LIB_DIR`、`NIBI_PACKAGES`、`NPM_CONFIG_*`、
      `NODE_PATH`、`GIT_CONFIG_GLOBAL`/`GIT_EXEC_PATH`/`GIT_SSL_CAINFO` 等已加入；
      `NIBI_API_KEY`/`NIBI_MODEL_*` 仍不投影。加之前 App 内 Bash 工具跑 `node` 报
      `cannot locate symbol ... basic_ostringstream`、`nibi-run` 找不到 npm；
      加之后一次调用返回 `v24.22.3 / 11.19.1 / Python 3.13.18 / git 2.51.0 / NIBI-GO`。
19. **Provider 设置与 FGS `specialUse`（2026-11-17）**：
    - 内核 app-server 新增 `provider/state|save|remove|setDefault|setKeys`（`ProviderAdmin`
      端口，`Platform` 实现）；设置页复用桌面同一份 `provider_config.json`。
    - **key 不进配置文件**：`expo-secure-store`（Android Keystore）保存；启动时 Host 把它
      放进 `NIBI_PROVIDER_KEYS` env（内核在启动时算默认模型，必须早于 app-server 启动），
      运行期新增/删除再走 `provider/setKeys`（只进内存）。Bash 工具的环境白名单不含它。
    - 自定义模型的 `defaultModelSelection` 没有 `reasoningLevel` 时，目录快照会过滤掉
      默认；`Platform::default_selection` 与 `models::assemble` 都对配置文件里的
      provider/model 做了回落，设置页显示默认也读原始配置。
    - 新会话创建时 App 显式带 `model`（provider/state 的默认），不依赖内核重启；
      真机用本机 mock 走通：设置页保存 → Key 已保存 → 连通性通过 → 新会话发 `hi`
      → mock 回复，顶栏显示 `mock-model`。
    - FGS：`dataSync` 改成 `specialUse`（`on_device_agent_runtime`），API 34+
      `startForeground(..., FOREGROUND_SERVICE_TYPE_SPECIAL_USE)`；真机
      `types=0x40000000`，不触发 6h/24h `onTimeout`。Play 分发需声明用途。
17. **Phase 3 来源 spike（2026-11-16，Termux 预编译）**：
    - `nodejs 26.13.1`（aarch64）：单 PIE 49MB，NEEDED 12 个库（zlib/c-ares/sqlite/
      libffi/openssl3/ICU 79/libc++）；NDK 视角 LOAD 0x4000、`.note.android.ident`
      **API 30**。依赖闭包解压约 95MB（其中 `libicudata` 33MB、OpenSSL 5MB、ICU 其他
      5.3MB）。把库放 `filesDir/node-libs`、`LD_LIBRARY_PATH` 指向它、node 本体放
      jniLibs（`libnode_probe.so` 临时探针）后，真机 **node 26.13.1 / npm 12.2.2 可运行**：
      `npm install lodash`（npmmirror + 随包 CA）与 `nibi-run cowsay`（`.bin` symlink →
      `#!/usr/bin/env node`）都成功。
    - `python 3.14.10`：`bin/python3.14` 是 4.6KB 启动器 + `libpython3.14.so`；Depends
      14 个包（gdbm/openssl/readline/ncurses/sqlite/…），未做真机运行。
    - 接入约束：库若放 app data，**不能全局设 `LD_LIBRARY_PATH`**（会把 `libc++_shared`
      换成 Termux 版本，影响 `:kernel` 的 `libnibi.so`）；需要一个小 launcher
      （jniLibs）只为 node 进程设置 `LD_LIBRARY_PATH` 并 exec node，npm 子进程继承。
      Node 26 的 API 30 意味着 Android 7–10 只能降级；APK 体积/是否随包需要运营者定
      （§11.9 本来就开放）。

## 附录 A：dsh-Go 插件同类映射与可移植性

### A.1 结论

- **dsh-Go 的插件原包不能直接装到 GO**：它们是 DSH/cordis 插件，依赖 `ctx.dshGo`、
  DSH 引擎 API、Flutter 原生插槽和 dsh-Go 的 view schema；GO 的插件宿主、manifest、
  slot 协议都不同。
- **同类插件大部分能做**：把逻辑改写成 GO 的 Node/Python 子进程插件 + 声明式 slots，
  UI 用 JSON 视图/Web Island 重建。
- **少数做不了**：依赖 apt/Ubuntu、依赖下载的 native ELF、依赖 Flutter 原生 UI 或
  DSH 引擎内部 API 的插件。

### A.2 dsh-Go 的插件清单（按形态）

- **市场**：`dsh-media`（生图/生视频）、`modlens`、`modsearch`、`dsh-im`、`dsh-context`。
- **官方示例**：天气（工具卡）、用量（状态条+面板）、快捷（胶囊+消息菜单）、
  朗读（TTS+字幕）、工具箱、文件、相册、样式、工作台。
- **官方组件**：命令、技能、设置表单、dsh-ui 卡（不用写 App 代码就原生显示）。
- **Web 插件**：通过 Web Island/网页版承载的面板、对话视图。

### A.3 同类插件在 GO 下的可行性

| dsh-Go 插件/类别 | GO 同类能做到吗 | 需要的 GO 能力 | 可行性 |
|---|---|---|---|
| 天气（工具卡） | 是 | 网络 egress + 工具卡 view | **高** |
| 用量（状态条+面板） | 是 | 内核 usage 数据 + `composer.strip`/`panels` | **高** |
| 快捷（输入胶囊/消息菜单） | 是 | `composer.actions`/`message.actions` + 效果 | **高** |
| 上下文（context） | 是 | 内核会话/上下文 API + 面板 | **高** |
| 样式（styles） | 是（只限插件自己的视图） | view v2 样式/颜色/字号边界 | **高** |
| 工作台/仪表盘 | 是 | `panels` + 多组件视图 | **高** |
| 文件（files） | 是（workspace/SAF 范围） | 内核文件工具 + 文件面板 | **中高** |
| 相册（album） | 是 | 媒体选择/SAF + 图片视图 | **中** |
| 朗读（readaloud） | 是 | Android TTS 桥 + 字幕/浮动层 slot | **中** |
| 工具箱（toolbox） | 部分 | 纯 JS/Python 工具可以；native 二进制不行 | **中** |
| modsearch（搜索） | 是 | 网络/搜索 API + 工具卡 | **高** |
| modlens（图像理解/搜索） | 是 | 相机/图片桥 + 视觉 API | **中高** |
| dsh-media（生图/生视频） | 是（生成/展示/保存） | 媒体 API + 图片/视频视图 + 保存/分享桥 | **中高** |
| dsh-im（消息集成） | 是 | 第三方 API/凭据 + 通知桥 | **中** |
| Web 插件/网页面板 | 是 | Web Island（WebView + 路由守卫 + 预算） | **中** |
| 依赖 apt/Ubuntu 的插件 | **否** | 无 rootfs/PRoot | **低** |
| 依赖下载 native ELF 的插件 | **否** | targetSdk 36 不能 exec App 数据 ELF | **低** |
| 依赖 Flutter 原生 UI 的插件 | **否（需重写）** | 只能改成 slots/JSON 视图/Web Island | **低** |
| 深度耦合 DSH/cordis 内部 API 的插件 | **低** | 需改写成 GO 插件 SDK | **低** |

### A.4 为什么原包不能直接用

1. **宿主不同**：dsh-Go 插件跑在 DSH 引擎里，用 `ctx.dshGo` 注册 slot、push 数据、
   invoke 动作；GO 的插件跑在 GO 的 Node/Python 子进程里，用 GO 的插件 SDK/内核工具。
2. **UI 协议不同**：dsh-Go 有自己的 `dshGo` manifest、view schema、组件目录、slot 名称；
   GO 要定义自己的 manifest/slot/view schema（可以照着设计，但不是同一个）。
3. **原生桥不同**：dsh-Go 的 Flutter 侧有 native settings、web islands、overlays、
   voice/capabilities；GO 是 RN + WebView，需要自己的桥。
4. **依赖不同**：dsh-Go 插件可能依赖 Ubuntu/PRoot 或 DSH 的 npm 树；
   GO 是 Android 原生运行时。

所以“用”只能是**移植/重写**，不是 `npm install` 原包。

### A.5 GO 要先补哪些能力

1. **插件 manifest + slot 协议**：工具卡、composer actions、message actions、strip、
   panels、composer tools、session actions、turn note、Web Island。
2. **声明式 view schema**：组件目录、文本/颜色/尺寸预算、数据绑定、动作/效果、
   错误隔离、版本兼容（`caps`/`minApp`）。
3. **GO 插件 SDK**：Node/Python 侧的 `ctx.nibiGo` 等价物；注册 slot、push 数据、invoke、
   设置 schema、日志/诊断。
4. **内核数据/工具 API**：会话、usage、context、workspace、文件、手机、TTS、媒体、通知、分享。
5. **原生桥**：媒体选择/保存、TTS、通知、剪贴板、相机、录屏、分享；Web Island 路由守卫。
6. **插件市场/签名**：GO manifest、Ed25519/revision、依赖目录隔离。

### A.6 推荐的落地顺序（用同类插件验证）

1. **天气**：验证工具卡 + 网络 + 错误展示（最简单）。
2. **用量**：验证 `composer.strip` + `panels` + 内核数据推送。
3. **快捷**：验证 `composer.actions`/`message.actions` + 效果/回调。
4. **文件/相册**：验证 workspace/SAF + 媒体桥。
5. **朗读**：验证 TTS 桥 + 字幕/浮动层（如果 GO 要做 overlay slot）。
6. **modsearch/modlens/dsh-media**：验证外部 API、媒体展示/保存/分享。
7. **Web 插件**：验证 Web Island 的守卫、预算、降级。

### A.7 明确不建议/不能做的

- 依赖 apt/Ubuntu/PRoot 的插件（需要 `apt install`、系统库、glibc 预编译二进制）。
- 依赖下载 native ELF 的插件（esbuild、playwright 浏览器、自解压工具）——
  targetSdk 36 不能 exec App 数据 ELF。
- 依赖 Flutter 原生 UI 或 DSH 引擎内部 API 的插件——要改写成 GO slots/SDK。
- 想改 GO 外壳/导航/主题的插件——和 dsh-Go 一样不允许。

一句话：**dsh-Go 的插件生态在 GO 下不是“兼容层”，而是“同类重建”**；纯 UI/数据/网络类
（天气、用量、快捷、context、搜索、媒体）大多能做，文件和媒体类要补原生桥，
shell/native 类受 targetSdk 36 限制，DSH 内部/Flutter UI 类要重写。
