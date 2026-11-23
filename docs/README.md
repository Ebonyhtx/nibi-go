# NIBI-GO 公开文档

| 目录/文件 | 内容 |
|---|---|
| [decisions/ADR-INDEX.md](decisions/ADR-INDEX.md) | 架构决策台账（D1–D25 + 决议追加）——**权威索引** |
| [design/](design/) | 设计规格：[Android 原生内核与运行时（fork 方案）](design/android-native-runtime.md)、[UI/UX 2.0 设计说明](design/go-uiux-2.0.html)、[手机操控/双开关](design/phone-control.md)、[插件市场索引与验签](design/market-index.md)、[relay-client 接口草案](design/relay-client-interface-draft.md)、[E2E 信封与握手 v1](design/e2e-envelope-v1.md) |
| [NIBI-GO架构总览.html](NIBI-GO架构总览.html) | 架构可视化历史快照（浏览器打开；现行决策见 ADR-INDEX） |

## 公开仓与私有仓的分工（不要混用）

- **公开仓（本仓）**只放：可构建源码、对贡献者必要的架构决策 `docs/decisions/`、设计规格
  `docs/design/`、贡献/安全/许可文件；以及 `SECURITY.md` 的联系方式。
- **内部工程仓（私有，需授权）**放：开发计划 `plan.md`、票据 `tickets/`、调研底稿
  `research/`、验证/发布检查单 `checklists/`、工作区映射 `workspace-map.md`，以及后续
  内部审计/交接。公开文档不链接私有仓文件路径；需要把内部结论变成公开事实时，先在
  本仓写 ADR 或设计规格，再引用它。
- **发布签名密钥**只在私有密钥保管库的加密备份里；**服务端/部署**只在服务端私有仓。

## 阅读顺序建议

1. 决策台账（为什么这样做）→ 2. 设计规格（协议细节）→ 3. 代码与测试门禁。
