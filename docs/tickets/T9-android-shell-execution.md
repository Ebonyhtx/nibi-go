# 票据 · Android 进程内内核没有可用的 POSIX shell（Bash 工具）

> 状态（2026-11-15）：**发现并真机复现**；GO 侧临时桥已实现并真机验证（见文末），
> 正式方案（上游 sh 方言或随包 bash+busybox）仍未排期。归入 ADR-INDEX 待定项 ④，
> 触发点：C0 收口 / ④ 定案时一起决定。
>
> 提交方：NIBI-GO 仓库。期望载体：nibi-client 仓 `kernel/crates/cli/src/shell.rs`（shell 发现）+
> `kernel/crates/env-local/src/shell.rs`（执行）+ 可能需要新的 `ShellDialect`。

## 现象（2026-11-15 真机实测）

设备：OnePlus PHK110 · arm64-v8a · Android 16 · App `top.nibistudio.nibigo`（debug）。
假模型让内核发起一次 `Bash` 工具调用（`{"command":"echo nibi-mock-tool-ok"}`），工具行直接 `error`，
正文是内核自己的错误：

```
No suitable shell found. NIBI requires a Posix shell environment.
Please ensure you have a valid shell installed and the SHELL environment variable set.
```

同一轮里 `Write` 工具走审批 → 允许 → 成功写入 `/sdcard/Download/nibi-approval-test.txt`
（内容与入参一致），说明**审批链和文件工具都正常，缺的只是 shell**。

## 根因（nibi-client `dev` 代码）

- `kernel/crates/cli/src/shell.rs:45-90`：`find()` 只接受 `bash` / `zsh`（`supported()` 判
  `contains("bash") || contains("zsh")`），候选目录固定 `/bin`、`/usr/bin`、`/usr/local/bin`、
  `/opt/homebrew/bin`；找不到时不回退 `sh`。
- `kernel/crates/env-local/src/shell.rs:52-100`：`ShellConfig.bash: Option<PathBuf>` 为 `None` 时
  Bash 工具直接返回上面那条错误；hook 命令在 Unix 上固定 `/bin/bash`。
- Android 只有 `/system/bin/sh`（mksh），没有 bash/zsh；App 进程的 `PATH` 也不含桌面发行版的
  shell 目录。补 `SHELL=/system/bin/sh` 无效——`supported()` 仍然拒绝。

## 影响

- `Bash` 工具在 Android 上不可用；依赖它的工具/技能（shell 命令、部分 hook、构建类任务）都跑不了。
- `Read` / `Write` / `Edit` 等不经过 shell 的工具正常（Write 已真机验证）。
- 移动端第一阶段可以只交付文件类工具；但「让手机上那个 agent 跑命令」是产品预期能力，不能长期缺。

## 可选方案

| 方案 | 做法 | 代价 / 风险 |
|---|---|---|
| A. 随包带 bash | jniLibs 里放 `libbash.so`（可执行），从 `nativeLibraryDir` 启动 | Android 10+ 对「可执行内容」收紧；Play 动态代码/可执行文件政策风险；体积 +授权（GPL）|
| B. 上游接受 Android `sh` | 新增 `ShellDialect::PosixSh`（mksh），`find()` 回退 `/system/bin/sh` | 最干净；但 bash 专有 prelude/函数与 `set -o pipefail` 等语义要逐条核对；hook 的 `/bin/bash` 要单独定 |
| C. 原生执行后端 | 内核里给 Android 加一个 `Command::new("/system/bin/sh")` 的执行适配层 | 不动 bash 语义、不额外带二进制；仍需上游工作量，且工具描述要说明方言差异 |
| D. 移动端不发 Bash | GO v1 只暴露文件/搜索工具，UI 明说「Bash 在手机上不可用」 | 零内核改动；产品能力缺口明确可见 |

**倾向**：先按 D 保证 v1 不虚假承诺，同时把 B 作为上游首选（能接受 `sh` 的话），C 作备选；
A 只在 ④ 的政策评估允许、且 B/C 都不可行时再考虑。

## 验收（修好后）

用现成的假模型触发器复测：

```bash
# 默认 MOCK_TOOL_NAME=Bash / MOCK_TOOL_INPUT={"command":"echo nibi-mock-tool-ok"}
node scripts/dev/mock-openai.mjs
```

手机输入 `TOOLTEST` → 审批卡 → 允许 → 工具行 `success` 且输出 `nibi-mock-tool-ok`。

## GO 侧临时桥（2026-11-15 已真机验证）

在 App 私有目录建 `bin/bash -> /system/bin/sh`（mksh），并把 `SHELL` / `NIBI_SHELL` / `PATH`
指过去。内核的 `find()` 只看路径里有没有 `bash`/`zsh`，因此接受这个别名；不随包带任何
可执行文件，④ 的边界不破。宿主两处都要建：进程内模块与 `:kernel` Service 的
`prepareEnvironment`（同一 App uid / filesDir）。

真机结果：

```
Bash · success · {"command":"echo nibi-shell-ok | tr a-z A-Z"}
NIBI-SHELL-OK
```

管线与 `/system/bin` 的 toybox 工具都可用，说明路径、cwd、权限链都通。

**局限（这是临时桥，不是正式方案）**：

- 语义是 **mksh**，不是 bash：`[[ ]]`、数组、部分 `bashism`、`set -o pipefail` 之外的
  bash 扩展可能失败；模型看到报错可自行换写法。
- hook 命令在 Unix 上固定 `/bin/bash`，这个桥救不了 hooks。
- 正式方案仍是 B（上游接受 Android `sh` 方言）或 A（随包带静态 bash + busybox + git，
  即架构总览里的「shell 三件套」，需过 ④ 的 Play 政策评估）。

**历史定案回顾**：shell 类工具原本就按「三件套」设计——`docs/research/NIBI-GO深度调研报告.md`
明确写「Android 是 mksh/toybox，Bash 工具要配 busybox」，`docs/NIBI-GO架构总览.html` 写
「静态 bash + busybox + git ~10-12MB」，`docs/plan.md` 的 C0 里程碑也列了「busybox/git 三件套」。
它被放在 C0「未做」里一直没有接线，协议/传输优先推进时没有把 Bash 能力当成 C0 的验收项；
真机第一次 Bash 工具调用才暴露（本票据）。临时桥先补上可用性，正式方案按上面 A/B 走。
