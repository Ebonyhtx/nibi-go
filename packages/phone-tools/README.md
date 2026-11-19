# 手机工具面（多平台适配器接口）

> 层级：平台接口层。**接口层不得出现 Android 专属类型**（AGENTS.md 规则 8，D11）。
> 现行实现：2026-11-19 Phase 5 开关 1/2；设计见 `docs/design/phone-control.md`。

## 职责

手机工具面的跨平台状态/开关/MCP 配置接口。真正的读屏、手势与 Shizuku 执行在
`app/modules/nibi-phone`（Android 原生模块）；本包只保留 Node 可测的纯 TS 形状与门禁函数。

## 现行接口

```ts
interface PhoneToolsAdapter {
  status(): PhoneStatus;
  setA11yEnabled(enabled: boolean): PhoneStatus;
  setShellEnabled(enabled: boolean): PhoneStatus;
  openAccessibilitySettings(): void;
  requestShellPermission(): void;
  openShellManager(): void;
  /** 至少一个开关打开且原生服务可用时返回会话级 MCP 配置。 */
  mcpServer(): PhoneMcpServerConfig | null;
}
```

`PhoneStatus` 只有 `available` / `a11y{enabled,connected,canScreenshot}` /
`shell{enabled,installed,running,permission}`；不暴露屏幕内容或 token。

## 工具面（固定 9 个）

模型看到的是 `mcp__phone__<name>`：

`apps`、`open`、`screen`、`tap`、`type`、`scroll`、`key`、`screenshot`、
`android_shell`。

- 目录固定，不随权限变化（保护提示缓存）；能力不足时调用返回可操作错误。
- `screen` 生成 `sN` 与元素编号；`tap`/`type`/`scroll` 只认最近一次快照。
- 内核按当前权限模式逐次审批；本包不参与审批。

## 安全不变量

- 敏感词单一词表（`SensitiveWords`）：读屏打码、字段拒绝、`⚠` 标记同源。
- 密码/验证码/支付字段不可代填；支付/银行/系统页面只读；本应用页面不执行写操作。
- 节点按自己的包名判断，跨窗口节点（状态栏/权限弹窗）不沿用快照包名。
- 身份证/银行卡打码后才离开设备；原生侧不记录屏幕文本或 token。
- `KEY` 是安全页的退出退路；截屏由系统 `FLAG_SECURE` 判定。

## 非目标（本期）

对齐 dsh-Go 的 `collect`/`confirm`/`observe`/`learnSkill`/`ocr`、悬浮条、后台多任务
taskId、视觉坐标 `tap_xy` 与媒体投影录屏。它们不在 Phase 5 的两开关范围内。

## Android 实现

`app/modules/nibi-phone`：`NibiA11yService` + `TreeCapture` + `ScreenFormat` +
`ScreenMask` + `SafetyGate` + `PhoneActuator` + loopback `McpHttpServer` +
`ShizukuShell` + `AppCatalog`。

## 状态

- 代码完成（2026-11-19）：接口、原生模块、设置页与内核会话接线。
- 模拟器（Android 15 x86_64）已验证开关 1、MCP `initialize`/`screen`/`tap` 硬拒绝/
  `screenshot`。
- 待 PHK110 真机：内核经 loopback MCP 的完整回合、真实应用操作、`FLAG_SECURE`、
  Shizuku 授权与 `android_shell`。