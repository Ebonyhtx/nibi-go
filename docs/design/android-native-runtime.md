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
nativeLibraryDir/                 # 可 exec（Android 36 已验证）
  bash / busybox / git
  node / python
  nibi-run                        # 兼容执行器（关键）
  hooks/pre-commit …              # git hook dispatcher（固定可执行）
  npm / npx / pip / python3 …     # 薄包装器

filesDir/
  runtime/bin/                    # 包装器/注册表（不可 exec，由 nibi-run 解析）
  workspaces/<sessionId>/         # 默认工作区
  packages/npm/                   # npm 包（库）
  packages/pip/                   # pip 包（库）
  plugins/<pluginId>/             # 插件数据/依赖
  cache/                          # 临时文件
```

PATH 顺序：`nativeLibraryDir` → `$NIBI_BIN` → `/system/bin`。  
Bash 通过 `BASH_ENV` 加载兼容函数；`sh` 通过 `ENV` 加载同一套。

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

### 4.3 busybox

- 不在 App 数据创建 symlink farm（不可 exec）；
- `busybox` 本身在 jniLibs；常用 applet 由 `BASH_ENV` 定义 shell function
  （`grep() { busybox grep "$@"; }` 等），或统一 `busybox <applet>`。

### 4.4 git hooks

Git 会直接 `execve` hook。做法：

- jniLibs 放一组固定 hook dispatcher（`pre-commit`、`commit-msg` 等）；
- `git` 包装器设置 `core.hooksPath=<nativeLibraryDir>/hooks`（或通过 `GIT_CONFIG_*` env）；
- dispatcher 被 git 正常执行，再读取仓库 `.git/hooks/<name>`，用 `bash`/`nibi-run` 执行；
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
4. **git hooks dispatcher** 对 `core.hooksPath`、worktree、bare repo 的兼容性。
5. **包管理器**：npm/pip 安装到 App 目录的路径/环境变量/权限；`--ignore-scripts` 与
   需要构建脚本的包如何取舍。
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
