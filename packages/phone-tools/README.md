# 模块 B：手机工具面（多平台适配器接口）

> 层级：平台接口层。**接口层不得出现 Android 专属类型**（AGENTS.md 规则 8，D11）。

## 职责

手机工具面的 TS 接口 + 平台适配器注册。**接口是 App 原生能力，与引擎无关**（2026-11-08 修正：GO 形态操控随 A+C，不等模块 B；B 只是 WORK 形态的第二个消费者路由）。

## 接口草案（D13 工具面 13 工具对齐 dsh-Go 工具清单）

```ts
interface PhoneToolsAdapter {
  /** 读当前屏：结构化文本（打码后）+ 可选截图（sensitiveBounds 灰挡） */
  readScreen(opts?: { image?: boolean }): Promise<ScreenDigest>;
  /** 按元素编号点按/长按；坐标点击必须逐次确认（tap_xy） */
  tap(target: ElementRef | { x: number; y: number }, opts?: { long?: boolean }): Promise<ActionResult>;
  /** 输入文本；密码/验证码/支付框默认拒绝（SafetyGate 词表） */
  type(target: ElementRef, text: string, opts?: { submit?: boolean }): Promise<ActionResult>;
  scroll(target: ScrollRef, direction: 'up' | 'down'): Promise<ActionResult>;
  key(name: 'back' | 'home' | 'recents' | 'notifications'): Promise<ActionResult>;
  /** 列表滚动收集（去重 + until 文本 + miss 判定） */
  collect(opts: CollectOptions): Promise<CollectedItems>;
  /** 危险操作确认：15-120s 超时=拒绝；答案绑定任务 owner（迟到的允许不算数） */
  confirm(req: ConfirmRequest): Promise<ConfirmResult>;
}
```

## 安全不变量（照抄 dsh-Go 验证过的设计）

- 词表单一真源：`SensitiveWords` 喂打码与 SafetyGate 两处，"never drift apart"
- 确认卡判定：armed 后 + 非注入窗口 + 无遮挡；事件字段不参与判定
- ProtectedPages 可读不可写（agent 永远不能给自己授权）
- 任何模式下硬拒绝仍然生效（解除限制三开关只影响询问频率）

## 多任务维度（D18，参照 dsh-Go v1.0.14 的 121 phone commits）

所有操作接口带 `taskId` 维度：**每个对话的任务各自批准/暂停/停止**，后台任务上限可配（dsh-Go 默认 1、最多 3）；悬浮条/通知上的停止/暂停/插话只作用于显示时的那个任务。

新增接口（v1.0.14/15 对齐）：

| 接口 | 语义 | 关键约束 |
|---|---|---|
| `observe(taskId)` | 实时后台屏预览 | 只读、≤5fps、画面不存盘、默认关 |
| `tapByScreenshot(taskId, shot, xy)` | 按截图坐标操作（找不到控件时的兜底） | 截图 30 秒有效、窗口切换作废、**同一任务首次操作某应用要许可**，发送/支付/删除仍逐次确认 |
| `learnSkill(taskId, trace)` | 成功轨迹存成技能 | 起草时脱敏（去联系人/号码/消息正文）、预览可改、再装成技能 |
| `ocr()` | 本机文字识别（读屏兜底，Canvas/游戏画面） | 可选能力；用 ML Kit 类 SDK 时**必须披露其统计收集**（dsh-Go 先例：SDK 收集机型/版本/耗时） |

输入回读核对：`type` 后回读，不一致如实报告（不谎报成功）。

## Android 实现

`modules/`（Kotlin）：PhoneA11yService 范式 + Actuator + OverlayBall + PrivilegedDisplayCore（后台通道）。

## 状态

骨架占位。**时机**：GO 形态操控随 A+C（接口先立）；WORK 路由随模块 B。
