# NIBI-GO 开发计划

> 状态：Phase A 进行中——A0/A1/A2/A3 手机侧全部完成（A0 a97ba6f / A1-1 5707c08 / A1-2 d8a8f02 / A2-1..6 / A3-1 3706aec / A3-2 887478a；78 项测试绿）。A3 剩余为桌面侧配合：**T4**（审批 capability 开闸）+ **T5**（E2E 插桩，规格 docs/design/e2e-envelope-v1.md）；**T3**（OIDC 注册）待 owner。下一步：Spike 2（RN 后台长连接实测）→ A4 发布准备。
> 依据：`docs/decisions/ADR-INDEX.md`（D1–D18）；参考仓 pin（nibi-client dev @ ff1c5f4f / dsh-Go v1.0.15 @ 8f31b2ed）
> 本计划随决策变更更新；阶段边界与信号由你（owner）定，本文只承载已定的结论与执行细节。

---

## 0. 总览

```
Phase A（现在）    NIBI-WORK 远控原生客户端    零内核耦合 · 零主线干扰
   │
   ├─ Spike 1/2（并行，各 ~1 天）：iroh 实测 / RN 后台长连接
   │
Phase B（最后）    WORK 形态手机操控路由        phone-bridge 插件
   │
Phase C（挂起）    本机内核                     两个启动信号见 §3
   （信号触发后先跑 Spike 3，再进入实现）
```

**为什么这样排**：A 与主线 kernel 迭代完全解耦（D17 单向消费 / A 零内核耦合），可立即动工；C 依赖的稳定面（会话库语义 / ext 付费门禁 / android 平台包）还在主线高速对齐期（一晚 31 commits/14.7k 行），过早进入只会追着变化跑；B 依赖 A 的 Relay 通道与 C 的存在理由，排最后。

---

## 1. Phase A：NIBI-WORK 远控原生客户端

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
| 签名三链 + 杀软白名单申诉材料 | 发行纪律（dsh-Go 经验） |
| 真机验证清单执行（AGENTS 规则 12） | 未验证项如实标注 |

### Phase A 退出标准

- 真机（Android 8+）扫码 → 远控桌面全流程可用：聊天/审批/提问/sendText/通知/断线恢复
- E2E 生效路径验证（NIBI-GO↔桌面密文；PWA 行为不变回归）
- 无内核代码、无 GO 形态入口（它们属于后续阶段）

---

## 2. Phase B：WORK 形态手机操控路由（nibi-phone-bridge）

### 里程碑 B0 · 工具面（与 A3 并行可开工——它属于 App 原生能力）

| 任务 | 交付物 |
|---|---|
| phone-tools Android 实现 | PhoneA11yService + Actuator + ScreenFormat/Mask（词表单一真源） |
| 确认卡 | GuardedButton 三拒绝 + armed 窗口 + 任务 owner 绑定 |
| 悬浮条三态 | 胶囊/卡片/小球 + 按住 1 秒停止（HoldToStop） |
| 多任务（D18） | taskId 贯穿 + 后台上限 + observe/截图坐标/learn-skill |

### 里程碑 B1 · 桥与市场

| 任务 | 交付物 |
|---|---|
| 进程内桥（GO 形态用） | PhoneMcpTransport（内核 MCP 直连） |
| nibi-phone-bridge 插件 | WORK 路由：桌面会话 → phone_* 工具 → 手机执行 → 结果回内核 |
| 官方作用域发布 | nibi-go-market 首个官方件 |

---

## 3. Phase C：本机内核（挂起）

### 启动信号（两者同时满足，由你判断）

1. 主线 kernel 的"对齐 NODE"批次收尾（语义稳定，不再一晚万行地改）——今晚 dev 仍在补 memory/cron/commands 对齐
2. `@nibi-studio/cli-android-arm64` 发布（CI matrix + `Platform::published()` 各加一行 entry，工作量极小但需要你决定发）

### Spike 3（信号触发后 ~1 天）

libnibi.so 进程内运行 + jniLibs spawn W^X @ targetSdk 36（Node 方案唯一技术风险）。

### 里程碑 C0–C2（信号后细化）

| 里程碑 | 内容 |
|---|---|
| C0 内核上机 | android target + busybox/git 三件套 + app-server --stdio 拉起 + 会话库 |
| C1 GO 形态 UI | 独立 UI（非 PWA）：会话/聊天/设置接进程内内核 |
| C2 GO 插件生态 | nibi-go-market 仓 + plugin-kit（SDK 四件套）+ Node Plugin Runtime + native-ui v1 + 用户自开发链路 |

---

## 4. 与主线的同步协议（D17 执行细则）

| 事件 | 动作 | 谁负责 |
|---|---|---|
| 桌面发新 npm 平台包 | GO 评估是否升级：看 changelog → android 冒烟 → bump lockfile | 你定升级时机；GO 侧验证可委托 |
| GO 需要内核新能力 | 开 issue 票据（复现/期望/优先级） | 你按主线节奏实现 |
| 紧急且票据来不及 | 第 3 级：GO 仓 git 依赖锁 kernel-go 分支 commit，台账记录 | 你批准分支存在 |
| 主线破坏 android 兼容 | 不会静默发生——android target 进 CI matrix 后每 commit 编译 | 你（一次性决定） |

**同步成本预算**：Phase A 期间 ≈ 0；Phase C 启动后 = 每次内核升级一次 android 冒烟（~半小时）+ 偶发票据评审。

---

## 5. 测试与验证纪律（全程）

- relay-client / chat-core：Node 可测（fake-relay-v2 + golden fixture），每 commit 跑
- 门禁：check-boundaries.mjs 每 commit 跑
- **编译验证（2026-11-11 修正）**：expo-router（SDK 58）懒路由——屏代码不在入口 bundle，验证必须按路由 chunk 请求（`/<appDir>/src/app/<route>.bundle?platform=android`），只验入口 bundle 会漏掉全部屏代码
- 真机验证标注：无障碍、jniLibs spawn、iroh 迁移、PackageInstaller——每提交说明"已验证/未验证"
- golden 对齐：chat-core 的 reducer 输出与桌面 V4 行为逐条对照（dsh-Go 的 parity 测试范式）

---

## 6. 已决事项（2026-11-11 P1–P5 全部拍板，详见 ADR-INDEX 决议追加）

- P1 初始提交 `84a95b5`（身份 Ebonyhtx）✅
- P2/P3a 选 B：shared 走 `packages/shared-extract/` 抽取件，禁直链 ✅
- P3b 会话级 K 先行；P3c JSON 文本帧 ✅
- P4/P5 票据已写好（docs/tickets/T1/T2 + HANDOFF 交接流程），派发时机由你定 ✅
