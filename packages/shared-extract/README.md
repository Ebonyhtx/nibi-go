# @nibi-go/shared-extract（P2/P3a：选 B 抽取件）

> 抽取来源：nibi-client dev @ ff1c5f4f 的 `packages/shared`。**抽取纪律见 AGENTS.md 规则 6：标注来源 commit，不改写语义**。

## 为什么选 B（2026-11-08 用户拍板）

workspace 直链（A）会让本仓 install 依赖 `nibi-client 工作区` 平级存在且跟随其活跃演进；抽取件（B）让本仓自足、协议层稳定——上游 schema 变更时按"复核→抽取新版本→跑契约测试→更新来源标注"的节奏手动升级。

## 抽取范围（A1 需要的子集，按需增）

| 文件 | 来源（nibi-client dev @ ff1c5f4f） | 用途 |
|---|---|---|
| `web-remote-relay/contract.ts` | packages/shared/src/web-remote-relay/contract.ts | Relay V2 消息/心跳/错误码 |
| `web-remote-relay/contract.example.ts` | 同目录 | wire 样例 |
| `web-remote-control.ts`（App payload 全表） | packages/shared/src/web-remote-control.ts | 手机端 RPC 面 |
| `fake-relay-v2.ts` | packages/shared/test/fixtures/fake-relay-v2.ts | 契约测试夹具 |
| `zcodeEndpoint.ts` 的 relay 常量 | DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL 等 | 端点配置 |

## 抽取流程（每次升级执行）

1. 对比上游 `packages/shared` 的 diff（自上次来源 commit 起）；
2. 逐文件决定"抽取/跳过"，跳过的变更记入下表"未抽取变更"；
3. 抽取时**文件头加来源注释**：`// 来源: nibi-client@<commit> packages/shared/src/...（未改写语义）`；
4. 跑本包测试（fake-relay 契约用例）——绿了才提交；
5. 更新本 README 的来源 commit。

## 未抽取变更登记

（空——首次抽取待 A1 开工时执行）
