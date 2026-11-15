# Third-Party Notices

NIBI-GO 的运行时与开发依赖以宽松许可（MIT / Apache-2.0 / BSD / ISC）为主。
本文件列出主要直接依赖的许可类型；**完整传递依赖清单以锁文件为准**，
发布前可用 `pnpm licenses list` 生成完整清单并归档。

## 运行时依赖

| 组件 | 许可 | 用途 |
|---|---|---|
| expo | MIT | RN 应用框架与原生模块宿主 |
| react-native / react | MIT | 移动端 UI 运行时 |
| expo-router / expo-camera / expo-web-browser / expo-crypto / expo-secure-store / expo-file-system / expo-notifications / expo-constants / expo-linking | MIT | 路由、扫码、系统浏览器、加密原语、安全存储、文件、通知、配置 |
| react-native-safe-area-context / react-native-screens | MIT | RN 基础 UI |
| zod | MIT | 协议 schema 校验 |
| @noble/ciphers / @noble/curves / @noble/hashes | MIT | E2E 信封与密钥协商（XChaCha20-Poly1305 / X25519 / HKDF） |
| ws（仅测试） | MIT | Node 测试用 WebSocket 实现 |

## 开发依赖

| 组件 | 许可 | 用途 |
|---|---|---|
| typescript | Apache-2.0 | 类型检查 |
| vitest | MIT | 单元测试 |
| husky | MIT | Git hooks |
| @types/* | MIT | 类型定义 |

## 已知依赖告警（接受的风险）

| 包 | 级别 | 路径 | 处置 |
|---|---|---|---|
| glob / minimatch | moderate | `app > expo > @expo/cli`（构建工具链，非运行时） | 上游 Expo CLI 锁 glob ^13，修复版 14.0.2 未跟进；构建期工具、无运行时暴露，接受并跟踪。 |
| zod | 已修复 | `packages/shared-extract`（运行时） | 4.6.5 → **4.6.6**（GHSA 内存耗尽，HIGH）。 |
| tinypool / vitest / @vitest/mocker | 已修复 | devDependencies（测试） | vitest 3.2.7 → **5.1.0**（tinypool 移出依赖树，critical 清零）。 |

## 内核 fork（`kernel/`）

`kernel/` 是 D24 的 Android 内核 fork：快照自 nibi-client `dev` `1369b043`
（Apache License 2.0），再上游为 ZCode-rs 0.1.67（Apache License 2.0）。
`kernel/LICENSE`、`kernel/NOTICE.md` 与 `kernel/vendor/THIRD-PARTY-NOTICES.txt`
随快照保留；完整第三方声明以它们为准。

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| ripgrep（vendored） | 15.2.0 | MIT OR Unlicense | 内嵌的 `rg` 搜索 |
| bfs + oniguruma | 4.1.4 / 6.9.10 | 0BSD / BSD-2-Clause | 内嵌的 `bfs` 查找 |
| ugrep + PCRE2 + brotli | 7.8.4 / 10.46 / 1.2.1 | BSD-3-Clause（PCRE2 exception）/ BSD-3-Clause / MIT | 内嵌的 `ugrep` |
| NDK `libc++_shared.so` | NDK r27 | Apache-2.0 WITH LLVM-exception | Android 内核的 C++ 运行时 |
| org.rustls:rustls-platform-verifier（AAR） | 0.2.0 | MIT OR Apache-2.0 | Android 系统信任库的 JVM 组件（T8 S2） |

Rust 依赖清单以 `kernel/Cargo.lock` 为真源；`kernel/deny.toml` 限定宽松许可白名单，
每次重 pin 后跑 `cargo deny check` / `cargo audit`（记录见 `kernel/CHANGELOG-FORK.md`）。

## 随包 Android 运行时（D25 Phase 2）

`scripts/android-runtime/sources.json` 固定版本、下载 URL 与 sha256；`build.mjs` 校验通过后
才允许构建。`build.sh` 用 NDK r27b 交叉编译为 bionic 动态 PIE（API 24、16 KB LOAD 对齐），
产物落在 `app/modules/kernel-host/android/prebuilt/jniLibs/arm64-v8a/`：

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| GNU bash | 5.2.37 | GPL-3.0-or-later | `$NIBI_BIN/bash`；内核 GitBash 方言与 hooks |
| GNU readline | 8.2.13 | GPL-3.0-or-later | bash 行编辑（静态链接进 bash） |
| ncurses | 6.5 | MIT | readline 的 terminfo 后端（静态链接进 bash） |
| BusyBox | 1.36.1 | GPL-2.0-only | 常用 applet（grep/sed/awk/find/tar 等） |
| git | 2.51.0 | GPL-2.0-only | `libgit.so` + `libgit_remote_http.so` |
| curl | 8.16.0 | curl | git http/https 传输（静态链接进 remote helper） |
| OpenSSL | 3.5.4 | Apache-2.0 | curl 的 TLS 后端（静态链接） |
| zlib | 1.3.1 | Zlib | curl/git 的压缩后端（静态链接） |
| Mozilla CA 证书包（curl 分发） | 2026-11-05 | MPL-2.0 | git https 的信任根（`assets/cacert.pem`，sha256 固定） |

GPL 对应源码：上表各组件的完整源码即对应版本的官方 tarball（URL 与 sha256 见
`scripts/android-runtime/sources.json`），加上本仓公开的
`scripts/android-runtime/patch-sources.py`（最小 bionic 补丁）与 `build.sh`（构建参数）；
任何人可用 `node scripts/android-runtime/build.mjs` 从这些输入重建同一产物。再分发时请保留
本声明与 `NOTICE.md`。BusyBox 未启用的 applet（SysV IPC、utmp、mount/swap/tc 等）是
Android app uid 的产品边界，清单在 `build.sh` 的配置段。

## 抽取件的上游

`packages/shared-extract/` 中的协议契约代码来自 nibi-client（Apache-2.0，
commit `ff1c5f4f`），其自身的第三方组件声明见 nibi-client 仓库的
`THIRD-PARTY-NOTICES.md`。上游沿革（ZCode v3.16.2，Apache-2.0）同样记录在
该仓库的 NOTICE 文件中。
