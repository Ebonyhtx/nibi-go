# NIBI-GO 可行性深度调研报告（基于 nibi-client 全源码）

> 调研对象：Ebonyhtx/nibi-client（1.9 万文件全克隆，commit `29cfbd03`）
> 结论先行：**可行，且比 DSH 路线更干净**。内核 Rust 无 Android 硬阻塞、协议面完整到手机 UI 可以"照单实现"、会话库与桌面互认是 DSH 生态没有的独家优势。风险集中在端到端加密缺位与外部工具环境。

---

## 一、规模与结构总览

| 区域 | 行数 | 说明 |
|---|---|---|
| `packages/**/*.ts` | 1,160,680 | 19 个包（desktop/server/ui/services/shared/rpc/provider…） |
| `apps/**/*.ts` | 701,077 | zcode-cli（Node Agent CLI/TUI/运行时） |
| `kernel/**/*.rs` | 437,450 | Rust 内核（38 个 crate，ZCode-rs 0.1.67 fork，pin + 供应链门禁） |
| `packages/**/*.tsx` | 217,990 | React UI |
| 测试 | 2,504 个 test.ts + 731 个 Rust tests 文件（约 10 万行测试代码） | |
| `docs/**/*.md` | 64,922 | spec 驱动开发（kernel/docs/specs/rust-cli/ 全套） |

**架构分层**（依赖方向自上而下，kernel-api 是纯 trait 层）：

```
桌面 Electron (packages/desktop)          Web 客户端 (packages/web)
      │ stdio 拉起                              │ Relay V2 (手机扫码 PWA)
      ▼                                        ▼
NIBI Host (Node, packages/services) ←── 外部 relay (api.nibistudio.top, 明文透传)
      │ app-server --stdio (protocol-nibi V4)
      ▼
Rust 内核 kernel/ ──┬── TUI ── headless (-p/stream-json)
                    └── executor --stdio --standalone（远端执行器服务端）
```

## 二、内核深挖（NIBI-GO 本机模式的核心资产）

### 2.1 模型/Provider 面：完全自足，零 Node 依赖

- `model` crate 内含 **Anthropic Messages（canonical）+ OpenAI Chat/Responses** 双协议全实现（请求构造/流式解析/重试/计量 55 个源文件），出网 `reqwest + rustls + ring`，无任何 C 网络库。
- 登录：OAuth（browser/`--no-browser`）+ API key stdin 双路；凭据是明文 `credentials.json`（`~/.nibi/v2/`），**无 keyring 依赖**——Android 上用 Keystore 包一层即可。

### 2.2 服务形态：三种入口都是现成的

| 入口 | 形态 | 对 NIBI-GO 的意义 |
|---|---|---|
| `app-server --stdio` | 桌面 Host 拉起的 V4 协议前端（30s 内必须出 `startup/storageState`） | **手机本机模式直接复用**：Android 前台服务拉起内核，stdio 走 V4 |
| `-p` / stream-json | headless 驱动 | 脚本/自动化 |
| `executor --stdio --standalone` | 远端执行器服务端（握手鉴权、目录围栏、`ExecLedger` 操作账本） | **"手机当桌面的执行节点"是原生语义** |

### 2.3 Android 交叉编译：无硬阻塞（逐项核实）

| 组件 | 形态 | 结论 |
|---|---|---|
| ring 0.17 | build.rs 显式含 `"android"` 目标 | ✅ |
| rusqlite | bundled（自带 SQLite C 源码） | ✅ NDK clang 直编 |
| reqwest/rustls/tokio 全家 | 纯 Rust | ✅ |
| vendored rg | ripgrep **源码** vendor（非预编译） | ✅ |
| vendored bfs/ugrep | C/C++ 源码 + cc build.rs（ugrep 的 config 按目标族取，需加 android 族） | ✅ 小改 |
| **git** | **外部命令**（`command("git")`） | ⚠️ 随包带 git 二进制（~8MB）或 libgit2 降级 |
| **shell** | `$SHELL` 探测 zsh/bash | ⚠️ Android 是 mksh/toybox，`describe_shell` 落 `unknown`，Bash 工具要配 busybox |

打包：`libnibi.so` 进 jniLibs——**不需要 dsh-Go 的 targetSdk 28 hack，无 PRoot、无 rootfs、无 ptrace 税**。预计包体增量 30–80MB。

### 2.4 工具与权限（手机安全面直接继承）

- 工具清单：bash/edit/read/write/glob/grep/web_fetch/web_search/web_cache/notebook/read_pdf/worktree/plan_mode/monitor/cron 全家桶 + tool_search + ask_user_question + fill_workflow_hole。
- **7 档权限模式**：Default / AcceptEdits / Plan / BypassPermissions / DontAsk / Auto / **Guarded**（bypass 但危险命令先问一次——手机上默认档位的理想选择）。
- bash 有独立的命令规则引擎（compound/subst/suggest/denied 测试齐全）——比 DSH 的权限预设更细。

### 2.5 扩展体系

- **插件 manifest 四格式兼容**：`.nibi-plugin/` / `.zcode-plugin/` / `.claude-plugin/` / `.codex-plugin/`——插件生态四向兼容是战略级优势。
- hooks：command/http/prompt/agent 四类执行器，事件合并（fold），输出超 10KB 落 ArtifactStore。
- MCP：manager + 连接池 + **UI 实例管理**（`app_instances`，MCP Apps 协议）。
- skills：`PluginSkillRoot` 随插件分发。
- peers：**本机跨会话 UDS 通信**（登记文件 + 收件箱 socket + ack 语义）——Android 上 abstract unix socket 即可用（dsh-Go PhoneBridge 同款做法已被你的内核原生支持）。

### 2.6 会话存储：与桌面互认（独家优势）

`node-store` = rusqlite，**迁移账本 0001–0024 与 Node 侧逐字节比对过**（CHANGELOG-FORK §3.1 有实测：Rust 冷开 Node 现场库通过）。意味着桌面/手机会话同 schema——同步、迁移、"在手机上接着桌面的会话聊"是顺路能力，dsh-Go 为会话操作要打 404 行补丁。

## 三、协议面深挖（手机 UI 照单实现的清单）

### 3.1 V4 方法全表（protocol-nibi，~90 个方法）

| 族 | 方法 | 手机 UI 需要度 |
|---|---|---|
| **session**（17 个） | create/send/subscribe/events/messages/read/list/resume/fork/close/stop/compact/setMode/setModel/setThoughtLevel/goal/usage/subagents/cancelBackgroundTask/debug | ★★★ 核心 |
| **interaction**（4 个） | requestPermission / requestUserInput / browserExecute / browserList | ★★★ 审批卡+提问卡的协议基础 |
| **plugins**（15 个） | list/install/uninstall/update/configure/setEnabled/validate/overview/operationProgress/referenceCatalog… | ★★ 插件管理页 |
| **mcp**（17 个） | list/readResource + **ui\* 14 个**（MCP Apps 交互面板：openInstance/uiCallTool/uiSampling/subscribeResource…） | ★★（手机版可先不接 MCP Apps） |
| **automation**（5 个） | list/create/update/delete/checkTaskBinding | ★★ 定时任务 |
| **workflows**（8 个） | list/get/save/runs/forRun/move/updateMeta/delete | ★ |
| **process**（7 个） | childProcesses/mcpTelemetry/networkCapture/networkRequests/… | ★ 引擎状态页 |
| **startup/provider/usage/...** | storageState/refreshRegistry/testModelConnectivity/stats | ★★ 引导与设置 |

**结论：手机原生 UI 不需要发明任何协议——V4 方法面 + interaction 族（权限/提问）就是完整的客户端契约。** protocol-nibi 的 inbound/subscribe/projection 已处理订阅、增量、TTFT 等机制。

### 3.2 现有手机端（web-remote-control）的真实能力边界

- **形态**：手机浏览器 PWA（`packages/web/src/web-remote-control`，34 个文件）经外部 relay 透传到桌面 main，挂为 `web-remote-replayable` attachment。
- **能做**：扫码配对（QR → V2 契约）、设备列表/管理、任务列表与聊天查看（snapshot/gap 断线恢复）、**sendText 发消息**（带 `inputOrigin:"mobile"` 标记）、标记已读、工作区列表/重连、平台方法（Docker/WSL/SSH 查询、临时附件、MCP 配置读写）。
- **不能做**：工具审批不在手机端（interaction/requestPermission 的消费在桌面 Host）；"手机服务和工具能力受 attachment/capability 约束，不因复用桌面 UI 而自动获得全部桌面能力"（架构文档明文）；终端有专门暴露边界。
- **数据流**：`手机 PWA → relay（明文透传，TLS+JWT only）→ 桌面 main（attachment 调度）→ 共享 Host → 同一 task runtime owner`。

### 3.3 Relay V2 契约（可直接复用的半成品）

`docs/web-remote-control/relay-v2-pairing.md`：JWT + 60s 一次性 token（22 字符 base64url）、`auth_init/pair_status_query/data` 消息族、5s±1s 心跳 + 15s ACK deadline、KICKED/DEVICE_OFFLINE/WRONG_PARAM 错误码、同角色顶替语义、**假 relay 测试夹具**（`packages/shared/test/fixtures/fake-relay-v2.ts`，独立子路径可导入）。手机原生客户端的 transport 可照 `packages/desktop/src/main/web-remote-relay/webRemoteControlTransport.ts`（generation/重连/注册重试全有）实现。

**关键缺口：relay 无端到端加密。** 对比 ds-harness-remote（Noise IK，dsh_remote 包与上游 fixtures 逐字节对齐）是唯一落后项。建议：密钥进二维码（`#k=` fragment 模式，dsh-Go 分享链接已验证），payload 层 XChaCha20-Poly1305，relay 继续透传密文——契约改动小（data.payload 换成密文信封），假 relay 夹具直接可测。

## 四、UI 可复用资产盘点（手机端能省多少）

| 资产 | 位置 | 复用方式 |
|---|---|---|
| V4 会话 UI 全套（聊天/工具行/思考/审批/提问） | `packages/ui`（React） | RN/Expo 直接复用；Flutter 则照交互规格重写 |
| MCP Apps 交互面板 | `packages/ui` + `ext/mcp/app_instances` | 手机二期（Excalidraw 类画布手机屏不友好） |
| share-ui / web-share | 独立包 | 分享落地页直接复用 |
| 假 relay / 协议 fixtures | `packages/shared/test` | **手机端契约测试直接 import** |
| `packages/android`（已清理） | — | 无包袱，按目标架构从零起 |

## 五、可选路线模块（顺序与取舍由项目所有者决定）

> 以下三个模块是调研确认**技术上都可行**的选项；先后顺序、做不做、何时做是项目所有者的决定，本报告只列事实与代价，不预设顺序。

### 模块 A：远控原生客户端（1–2 月，零内核风险）

1. **技术栈**：Flutter（与 dsh-Go 调研沉淀对齐）或 React Native（直接复用 packages/ui 交互规格与 shared 的 TS 契约类型）。RN/Expo 的优势——`shared` 的 zod schema、`fake-relay-v2`、V4 类型全是 TS，省一层翻译。
2. **模块**：Relay V2 terminal 侧 transport（照桌面 device transport 移植）→ 设备列表/扫码配对 → 任务列表（replay/snapshot/gap）→ 聊天（sendText，`inputOrigin:mobile`）→ **审批卡/提问卡（新增 capability：把 interaction/requestPermission 路由到手机，桌面弹窗降级为兜底）**。
3. **安全加固（必做）**：payload 端到端加密（密钥进 QR）。
4. 测试：假 relay + 桌面真机联调；真 relay 需服务端配合（`api.nibistudio.top` 的 ws2 已在生产）。

### 模块 B：手机执行器（候选，规模约 3–4 周）

桌面会话经 Relay V2 把 phone_* 工具（读屏/点按/输入/审批卡）路由到手机执行——用内核原生 exec-server/env-remote 语义。dsh-Go 做不到这一点（它的手机工具只服务本机引擎），是潜在差异化点。安全纵深设计可照搬 dsh-Go 报告（词表单一真源、确认卡不变量、ProtectedPages）。

### 模块 C：本机内核（2–3 月）

1. kernel 交叉编译 `aarch64-linux-android`：新 target crate；ring/rusqlite/vendored 工具链全部源码可编（ugrep 加 android config 族）。
2. 运行形态：前台服务 + `app-server --stdio`；会话库放 app 数据目录（schema 与桌面互认）。
3. 工具环境：busybox（mksh→bash 语义）+ git 二进制随包；`describe_shell`/`os_version` 等环境事实加 android 分支。
4. 若做：**统一 carrier 抽象**（本机 stdio→内核 与远控 Relay V2→桌面 Host 返回同一客户端接口）值得作为架构目标——dsh-Go 最值得抄的决策。
5. 手机操控：经 peers UDS 或 MCP 暴露给内核（安全设计同模块 B）。

**已知代价（供决策参考）**：模块 C 引入持续维护面——上游 re-pin 需重验交叉编译、工具链升级需重编 vendored 工具、内核环境事实变更需重测 android 分支（dsh-Go 的 105 补丁墙是持续性成本的前车之鉴）；模块 A/B 不碰内核，无此负担。价值侧：C 独占"离线/隐私/手机独立算力"场景。两侧权衡由项目所有者判断。

### 与 dsh-Go 的对位总结

| 维度 | dsh-Go | NIBI-GO（规划） |
|---|---|---|
| 本机引擎 | Node + PRoot + 1GB rootfs + ptrace 税 | **原生 Rust 二进制，无容器** |
| 补丁墙 | 105 个补丁 pin 上游字节码 | **无**（kernel 是自家 fork，pin 管理已成体系） |
| 会话跨端 | 靠补丁实现删除 | **schema 天然互认** |
| 远控加密 | Noise IK（上游提供） | ⚠️ 需自建（Relay V2 目前明文） |
| 审批到手机 | 原生审批卡 | Phase 1 需扩 capability（现只能在桌面） |
| 插件生态 | DSH 插件（cordis） | **四格式兼容**（nibi/zcode/claude/codex） |
| 跨机执行 | 无（单 host 概念） | **executor/machines/peers 原生支持** |

## 六、风险清单（按优先级）

1. **E2E 加密缺位**（Phase 1 阻塞项）——relay 明文透传，做产品前必须补。
2. **审批路由未达手机**——interaction/requestPermission 目前消费在桌面；Phase 1 要动 host 侧 attachment capability，这是协议改动不是纯客户端工作。
3. **外部工具环境**（Phase 2）——git/bash 缺失，busybox 方案要实测 toybox 冲突；SELinux 会拒部分 syscall（dsh-Go 经验：`link(2)` 在共享存储被拒）。
4. **V4 协议演进绑定**——手机端实现 V4 后，`protocol-nibi` 的变更（inbound schema 严格校验）需要手机端跟进；建议手机端从 `shared` 的 zod schema 生成类型，别手写。
5. **单人带宽**——nibi-client 本身还在高强度演进（E2E 修复线密集），NIBI-GO 建议严格按 Phase 切，Phase 1 不碰内核。

---
*数据来源：nibi-client 源码（kernel 38 crates + 19 packages 全扫描）；关键证据：`kernel/crates/{model,node-store,protocol-nibi,permission,peers,exec-server}`、`packages/shared/src/zcodeEndpoint.ts:32`（relay 端点）、`packages/services/src/zcode-agent/zcodeAgentService.ts:5698`（replayable 写路径）、`docs/web-remote-control/relay-v2-pairing.md`（Relay 契约全文）。*
