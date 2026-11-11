# @nibi-go/shared-extract（P2/P3a：选 B 抽取件）

> 来源 commit：**nibi-client dev @ ff1c5f4f**（首次抽取 2026-11-11，A1-1）。
> **抽取纪律见 AGENTS.md 规则 6：标注来源 commit，不改写语义**——唯一允许的机械调整是 import 路径按本包布局，须在文件头注明。

## 为什么选 B（2026-11-08 用户拍板）

workspace 直链（A）会让本仓 install 依赖 `nibi-client 工作区` 平级存在且跟随其活跃演进；抽取件（B）让本仓自足、协议层稳定——上游 schema 变更时按"复核→抽取新版本→跑契约测试→更新来源标注"的节奏手动升级。

## 抽取范围（按需增，✓ = 已抽取）

| 本包文件 | 来源（nibi-client dev @ ff1c5f4f） | 用途 |
|---|---|---|
| ✓ `src/web-remote-relay/contract.ts` | packages/shared/src/web-remote-relay/contract.ts（全文） | Relay V2 wire/HTTP 契约、错误分类 |
| ✓ `src/web-remote-relay/contract.example.ts` | 同目录（import 路径调整） | wire 样例 |
| ✓ `src/web-remote-relay/heartbeat-timing.ts` | packages/shared/src/web-remote-relay/domain/heartbeatTiming.ts（全文） | V2 心跳常量与 jitter（5s±1s / ACK 15s） |
| ✓ `src/web-remote-relay/heartbeat.ts` | packages/shared/src/web-remote-relay/adapters/heartbeat.ts（全文，import 路径调整） | 心跳调度器 |
| ✓ `src/web-remote-relay/retry.ts` | packages/shared/src/web-remote-relay/domain/retry.ts（全文） | 退避策略 + KICKED 60s 窗口 + pair 状态映射 |
| ✓ `src/web-remote-control/qr.ts` | packages/shared/src/web-remote-control.ts 行 114-204（局部，该段自包含） | V2 二维码契约（D7：QR 只承载路由提示） |
| ✓ `src/relay-endpoints.ts` | packages/shared/src/zcodeEndpoint.ts 行 5、32（局部） | DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL + DEFAULT_NIBI_ENDPOINT_ORIGIN |
| ✓ `src/nibi-auth.ts` | packages/shared/src/nibiAuth.ts（全文） | NIBI 账号中心（Zitadel）公开常量（A1-2 增量抽取） |
| ✓ `src/web-remote-control/rpc-transport.ts` | packages/shared/src/web-remote-control-rpc-transport.ts（全文，import 路径调整） | rpc-frame 分片/装配/校验状态机（A2-1 增量抽取） |
| ✓ `src/nibi-protocol-v4/core.ts` | packages/shared/src/nibi-protocol-v4/core.ts（全文，import 路径调整） | V4 限额常量 + delivery profile |
| ✓ `src/nibi-protocol-v4/wire-binary.ts` | packages/shared/src/nibi-protocol-v4/wire-binary.ts（全文） | crc32 / base64 wire 纯函数 |
| ✓ `src/zcode-media-policy.ts` | packages/shared/src/zcode-media-policy.ts（全文） | VIDEO_INPUT_MAX_BYTES（core.ts 的依赖） |
| ✓ `src/nibi-protocol-v4/` 闭包（56 文件） | packages/shared/src/nibi-protocol-v4/{apply,delta,rows,snapshot,toolDisplay}.ts 及其相对依赖闭包 + source-server/contracts（类型级 inline import） | V4 会话行模型 / delta 事件 / 快照 / reducer（A2-2 增量抽取，脚本 scripts/extract-v4-closure.mjs 可重放） |
| ✓ `src/testing/fake-relay-v2.ts` | packages/shared/test/fixtures/fake-relay-v2.ts（全文，import 路径调整） | 契约测试夹具，走 `@nibi-go/shared-extract/testing` 子路径（AGENTS 规则 11） |

依赖：`zod` 精确版本 **4.6.5**（与上游 shared 锁定一致，升级随抽取流程联动）。

## 未抽取变更登记

| 上游内容 | 登记日期 | 处置 |
|---|---|---|
| web-remote-control.ts 其余部分（App payload 全表、RPC transport limits、theme/route helpers） | 2026-11-11 首抽 | 跳过——该文件依赖 telemetry/platform/sessionCreateTelemetry 等内部模块，无法独立抽取；App payload 面在 A2（chat-core）消费时按需抽取 |

## 抽取流程（每次升级执行）

1. 对比上游 `packages/shared` 的 diff（自上次来源 commit 起）；
2. 逐文件决定"抽取/跳过"，跳过的变更记入上表"未抽取变更登记"；
3. 抽取时**文件头加来源注释**：`// 来源: nibi-client@<commit> packages/shared/src/...（未改写语义）`；
4. 跑本包测试（fake-relay 契约用例）——绿了才提交；
5. 更新本 README 的来源 commit。
