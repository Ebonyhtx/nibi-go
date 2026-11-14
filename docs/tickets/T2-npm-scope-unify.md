# 票据 · npm scope 统一：`@nibi/cli-*` → `@nibi-studio/cli-*`

> 状态（2026-11-14）：**已落地**（npm scope 已统一为 `@nibi-studio/cli-<platform>`）。本文件保留为票据历史记录。
>
> 提交方：NIBI-GO。小改动，建议尽早（GO 侧引用写法以 registry 实发为准，仓内 scope 漂移越久，下游踩坑越广）。

## 现状（不一致点）

| 位置 | 写法 |
|---|---|
| npmjs 实发（2026-11-07，GitHub OIDC） | **`@nibi-studio/cli-linux-x64-gnu` / `cli-linux-arm64-gnu` / `cli-darwin-arm64` @ 4.0.1** |
| 仓内 `scripts/rust-cli/npm/package.mjs:72` | `@nibi/cli-${platform.id}` |
| 仓内内核 `machines/executor_dist` 拉取逻辑 | `@nibi/cli-<Platform::package_id()>` |
| 仓内 workflow 注释 | `@nibi/cli-<platform>` |

## 需求

统一为 **`@nibi-studio/cli-<platform>`**（npm 侧事实状态在先，已发的三个 4.0.1 包不改名不重发）：

1. `package.mjs` 的 name 模板；
2. 内核 `machines/executor_dist` 的注册表引用与 `Platform::package_id()` 拼包逻辑；
3. workflow 注释与文档（`docs/planning/step9b-brand-inventory` 等处的 scope 记载按现状校正）。

## 边界

- 纯改名，零行为变化；`dist.integrity` 校验逻辑不动；
- `@nibi` scope 若留作他用途（如未来 `@nibi/shared` npm 化），不受影响——本票只处理内核二进制包的 scope。

## 背景

- 发现途径：NIBI-GO 引用内核时对 registry 实查（4.0.1 是 `@nibi-studio/cli-*`）与仓内代码（`@nibi/cli-*`）对不上。
- 推测原因：开发迭代快，scope 决策晚于打包脚本成型，漏改。本票同时建议把"npm scope 名"登记进某个品牌 inventory 文档（step9b 已有品牌清单的话加一行），防再漂移。
