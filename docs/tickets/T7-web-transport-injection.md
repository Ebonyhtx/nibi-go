# 票据 · web 远程控制 transport 注入口（WORK 原生隧道承载）

> 提交方：NIBI-GO 仓库。D2/D4/D9 修订（2026-11-13）后的上游前置；**不催主线排期**——何时做由你定。
> 期望载体：nibi-client 仓 `packages/web/src/main.tsx`（编排层）+ `packages/web/src/web-remote-control/`。

## 需求（消费诉求口径）

D2/D4 修订后，NIBI-GO 的 WORK 形态 = WebView 承载同源 web UI，但**连接所有权在原生**
（D9 案 A：原生 RelayTransport 持有 relay 连接与 E2E 信封，App 的后台通知/前台服务保活依赖它）。
需要 web 远程控制编排层允许外部宿主注入一个**已实现的 transport**（替代 web 自建 relay 连接），
WebView 里的 UI 只消费状态与帧流；不注入时一切照旧。

## 现状证据（2026-11-13 逐条核实）

- `packages/web/src/main.tsx:30-34`：编排层从 `@nibi/client` 取 `connectViaProtocol` /
  `connectViaWebSocket` / `createAcknowledgedWebRemoteControlRelayProtocol` 自建连接。
- `packages/web/src/web-remote-control/contracts/transport.ts`：transport 对外行为面契约清晰——
  状态枚举（idle / connecting / authenticating / waiting / paired / reconnecting / suspended /
  kicked / error）+ `onPayload` / `onStateChange` / `onFailure` / `onDiagnostic` / `reloadPage`
  等回调；`WebRemoteControlTerminalTransportOptions` 连 `WebSocketCtor` 都已是注入参数（先例）。
- `packages/web/src/main.tsx:458` `createWebPlatform({ externalWebRemoteControlProxy })`：
  宿主注入的平台服务接缝已存在，transport 注入是同一范式。
- `packages/web/src/web-remote-control/contract.test.ts`：transport 契约有测试兜底。

## 具体改动（参考落点，上游可改造）

1. 编排层（main.tsx 构造 transport 的位置）接受可选的 transport 工厂/实例参数：宿主提供的实现
   满足 web transport 的对外行为面（状态迁移、帧回调、发送、生命周期）；**不提供时行为逐字不变**。
   落点按符号定位（`connectViaProtocol` / `connectViaWebSocket` / `createWebPlatform`），
   **不要按行号改**——`main.tsx` 正在被日常改动（最近一次 `1ac2598f` 去 zcode 前缀），
   本票的行号只是 2026-11-13 的快照。
2. 注入实现的语义由宿主负责：连接生命周期、心跳、replay、E2E（NIBI-GO 用其 RelayTransport +
   keyneg 握手）；web 侧只消费回调并走原发送通道。
3. 状态枚举映射：宿主原生状态（如 `waiting_terminal`）→ web 枚举（`waiting` / `reconnecting` /
   `suspended`）的对齐口径随实现定，GO 侧照做。
4. admission/auth：注入路径下 relay token 由宿主经桥提供（对应 options 的 `getToken`），web 的
   relay 侧连接逻辑跳过；设备列表等 HTTP 面是否同走宿主桥，随实现定。

## 边界承诺（对主线的承诺）

- **默认路径逐字不变**：不传注入时 PWA 构建行为与当前完全一致（自建连接、明文），
  `contract.test.ts` 与现有 web 测试全绿；
- 浏览器 PWA 永远不传注入（D9 口径不变）；桌面零改动；服务端零改动；
- 纯增量：只加注入参数与相关测试，不改现有 transport 实现内部。

## 验收

- `contract.test.ts` 与现有 web 测试全绿；
- 无注入的 PWA 构建与上一版行为一致（冒烟：登录 → 选择电脑 → 连接 → 会话）；
- 注入路径有单测（假 transport 工厂 → UI 正常消费状态与帧）；
- NIBI-GO WebView 承载的真机验证在 GO 仓完成（上游不承担）。

## 背景

- D2/D4 修订（2026-11-13）：WORK = WebView 承载同源 web UI（`@nibi/ui` Root +
  `packages/web/src/web-remote-control`），原生不自绘远控屏；
- D9 案 A（2026-11-13 运营者拍板）：连接所有权在原生（E2E 密文 + 后台通知/保活成立），WebView
  UI 经 bridge 收发帧流；浏览器 PWA 维持明文。
