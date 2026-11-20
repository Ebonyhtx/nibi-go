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
3. **内核 fork**：`kernel/` 是 NIBI-GO 自有的 Android 内核 fork（D24），快照自
   [nibi-client](https://github.com/Ebonyhtx/nibi-client) `dev` `1369b043`
   （Apache License 2.0），后者派生自 ZCode-rs 0.1.67（Apache License 2.0）。
   `kernel/LICENSE` 与 `kernel/vendor/THIRD-PARTY-NOTICES.txt` 随快照保留；
   同步与合并记录见 `kernel/UPSTREAM.md`，NIBI 时期的 fork 台账见
   `kernel/CHANGELOG-FORK.md`。
4. **随包 Android 运行时**：bash/busybox/git/jq/zip 等由 NDK 从固定上游源码构建（版本、URL、
   sha256 见 `scripts/android-runtime/sources.json`）；Node 24 / Python 3.13 语言运行时
   同样自建（`scripts/android-runtimes/sources.json`），不使用 Termux 预编译包。许可与
   GPL 源码获取方式见 `THIRD-PARTY-NOTICES.md`「随包 Android 运行时」与
   「随包语言运行时」。
5. **不在本仓库中的组件**：发布签名材料、发布流水线与运营侧服务均不在公开范围内。

## 第三方组件

依赖清单与许可汇总见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
