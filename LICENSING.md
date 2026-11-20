# Licensing

本文件用平实语言说明本仓各部分的许可边界；它不替代许可证正文或第三方声明。

## 第一方代码

NIBI 自有的代码与文档按 [Apache License 2.0](LICENSE) 发布，除非某个文件或目录另有说明。

## 上游来源

NIBI-GO 是独立项目，不是任何上游项目的官方发行版，也不受其背书。

- **shared-extract 抽取件**：`packages/shared-extract/` 抽取自
  [nibi-client](https://github.com/Ebonyhtx/nibi-client)（Apache-2.0）commit `ff1c5f4f`；
  逐文件来源见 `packages/shared-extract/README.md`。
- **Android 内核 fork**：`kernel/` 是 NIBI-GO 自维护的 fork，快照自 nibi-client `dev`
  commit `1369b043`（Apache-2.0），后者派生自 ZCode-rs 0.1.67（Apache-2.0）；
  同步台账见 `kernel/UPSTREAM.md` 与 `kernel/CHANGELOG-FORK.md`。
- **随包 Android 运行时**：bash / busybox / git / jq / zip / ripgrep / curl / OpenSSL /
  zlib 等由 NDK 从固定上游源码构建，版本、URL、sha256 见
  `scripts/android-runtime/sources.json`；各组件许可见
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
- **随包语言运行时**：Node.js 与 Python 由 NDK 从官方源码构建（`scripts/android-runtimes/`），
  许可见 THIRD-PARTY-NOTICES.md；不使用 Termux 预编译包。

上游版权与来源同时记录在 [NOTICE.md](NOTICE.md)。

## 第三方组件

第三方依赖、复制的源码、原生二进制、字体与图标按各自许可发布。汇总清单见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 贡献

提交贡献即表示同意按 Apache License 2.0 授权，具体见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 名称与标识

Apache License 2.0 不授予 NIBI 名称或标识的使用权。见 [TRADEMARKS.md](TRADEMARKS.md)。

## 无担保

软件按“原样”提供，不附带任何明示或默示担保，详见 Apache License 2.0。
