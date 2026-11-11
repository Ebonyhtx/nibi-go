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

## 抽取件的上游

`packages/shared-extract/` 中的协议契约代码来自 nibi-client（Apache-2.0，
commit `ff1c5f4f`），其自身的第三方组件声明见 nibi-client 仓库的
`THIRD-PARTY-NOTICES.md`。上游沿革（ZCode v3.16.2，Apache-2.0）同样记录在
该仓库的 NOTICE 文件中。
