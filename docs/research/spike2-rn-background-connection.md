# Spike 2 · RN 后台长连接实测（2026-11-11）

> 目的：验证 RN（Expo SDK 58 / Hermes）WebSocket 在 Android 后台/网络切换下的生命周期，为 A4 的 KeepAlive 前台服务与断线恢复策略提供实测依据。
> 方法：临时探针路由（已删除，实验代码不进主干）+ 本机 WS 探针服务（echo + 连接生命周期日志）+ Android 35 模拟器（pixel_7，WHPX 加速）+ Expo Go 58.0.5。应用层心跳 2s。
> 环境限制：模拟器（非真机）、adb reverse 隧道（非公网 relay）、Expo Go 容器。

## 实测结果

### 场景 A：应用切后台（HOME）

| 观测 | 结果 |
|---|---|
| 后台后连接存活 | **约 1 秒内被 abort**（客户端 `CLOSE code=1006 "Software caused connection abort"`，服务端 `closed code=1006`） |
| 心跳 | 后台后立即停止（JS 定时器随应用暂停） |

**结论**：没有前台服务/保活手段时，**Android 上切后台即断连**（本环境近乎即时）。这与"RN 进程后台会被暂停 + 网络资源被回收"的预期一致，也直接印证 A4 必须做 `KeepAlive` 前台服务（dsh-Go 先例同样依赖前台服务保活）。

### 场景 B：回前台恢复

| 观测 | 结果 |
|---|---|
| 回前台后自动重连 | **不会**——路由不重挂、JS 恢复后无重连逻辑（探针本身无重连；但即使有 `setTimeout` 退避，后台期间定时器不执行，只能等回前台才触发） |

**结论**：恢复不能依赖"重连退避定时器自己会到点"。A4 需要：
1. `AppState` 监听（`active` 时立即触发重连/重订阅），而不是等退避；
2. 重连后按 relay 契约重新申请 token（transport 已实现）；
3. 重连后重走 `bootstrap → subscribe`（ChatSession 已实现）。

### 场景 C：网络中断（飞行模式）——测试设计缺陷 + 一个有效发现

| 观测 | 结果 |
|---|---|
| 飞行模式能否切断连接 | **不能作为有效测试**——探针走 adb reverse 隧道（USB 传输），飞行模式不影响它 |
| 恢复网络后 | 连接在两端都显示"仍打开"（服务端无 close、客户端 readyState=OPEN），但心跳不再到达——**典型半开连接**：网络静默失效时两端都不会收到 close 事件 |

**结论**：网络静默失效不会被 socket 层发现，**必须依赖应用层心跳**——GO 侧 transport 已有 5s±1s 心跳 + 15s ACK watchdog（A1-1），正是为此设计；后台时 JS 暂停使 watchdog 失效，因此场景 A 的"后台即断"反而是保护（收到 close 事件，恢复路径明确）。

## A4 设计输入（结论清单）

1. **必须做前台服务**（`KeepAlive`，dsh-Go 先例）：`FOREGROUND_SERVICE` + 常驻通知，否则后台即断。
2. **`AppState` 驱动的即时恢复**：回前台/网络变化（`NetInfo`）→ 立即重连，不等退避定时器。
3. **应用层心跳是半开连接的唯一探针**：transport 现有 5s±1s / 15s ACK 参数保留；后台恢复后应主动发一次 `pair_status_query` 探测而非直接信任旧 socket。
4. **真机验证不可替代**（AGENTS 规则 12）：Doze/厂商电池优化（小米/华为/OPPO 后台限制）在本模拟器上无法复现，A4 真机清单需覆盖：厂商后台白名单、Doze 长时后台（30min+）、弱网切换（WiFi↔4G）。
5. 网络切换测试的正确方法（后续）：指向真实 relay（T3 注册后）或开放防火墙端口用 `10.0.2.2` 直连；不要用 adb reverse 做断网测试。

## 复现方法（供 A4 复验）

1. 本机 WS 探针服务（临时脚本，echo + 日志）；
2. 临时路由：`new WebSocket("ws://127.0.0.1:9310")` + 2s 心跳 + onopen/onclose/onerror 打日志；
3. `adb reverse tcp:9310 tcp:9310` + `expo start` + Expo Go 深链 `exp://10.0.2.2:8081/--/spike2`；
4. `adb shell input keyevent HOME`（后台）→ 观察两端日志；`am start` 回前台。
