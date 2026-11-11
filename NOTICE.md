# NOTICE

NIBI-GO
Copyright 2026 NIBI Studio

本产品包含作为 NIBI client 项目一部分开发的软件。

## 来源声明

1. **shared-extract 抽取件**：`packages/shared-extract/` 中的文件抽取自
   [nibi-client](https://github.com/Ebonyhtx/nibi-client)（Apache License 2.0），
   来源 commit `ff1c5f4f`。每个抽取文件头部保留来源注释；抽取未改写语义
   （仅 import 路径按本包布局调整）。逐文件来源登记见
   `packages/shared-extract/README.md`。
2. **上游沿革**：nibi-client 基于 ZCode v3.16.2（Apache License 2.0）独立演进；
   其上游版权与第三方组件声明见 nibi-client 仓库的 `NOTICE.md` 与
   `THIRD-PARTY-NOTICES.md`。
3. **不在本仓库中的组件**：NIBI 内核（Rust）为独立项目，经 npm 平台包
   （`@nibi-studio/cli-*`）单向消费，不随本仓库分发；发布签名材料、发布流水线
   与运营侧服务均不在公开范围内。

## 第三方组件

依赖清单与许可汇总见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
