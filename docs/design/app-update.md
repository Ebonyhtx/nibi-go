# 应用内更新（APK）链路

> 状态：2026-11-24 定案。客户端 0.1.9 起使用签名清单；旧版本仍可走 GitHub Release 检查。

## 1. 目标

- 国内优先从 `dl.nibistudio.cn`（ESA + 私有 OSS）下载；
- GitHub Release **必须发布**，作为公开记录与全球兜底；
- 清单先验签、APK 再验 SHA-256、安装时由 Android 验签名连续性；
- ECS 只做发布中转，不参与客户端下载；
- 不做自动下载；自动检查可关闭。

## 2. 产物与路径

```
oss://<content-bucket>/nibi-go-app/
  update.json
  update.json.sig
  apk/nibi-go-<versionCode>-<version>.apk
```

公开地址：

```
https://dl.nibistudio.cn/nibi-go-app/update.json
https://dl.nibistudio.cn/nibi-go-app/apk/nibi-go-<versionCode>-<version>.apk
https://github.com/Ebonyhtx/nibi-go/releases/download/v<version>/app-release.apk
```

APK 路径带 versionCode，**永不覆盖**；只更新 `update.json` / `.sig`。

## 3. 清单 update.json

```json
{
  "schemaVersion": 1,
  "kind": "nibi-go-app-update",
  "generatedAt": "2026-11-25T00:00:00.000Z",
  "version": "0.1.9",
  "versionCode": 10,
  "minVersionCode": 9,
  "notes": "本次更新……",
  "apk": {
    "sha256": "<64 hex>",
    "size": 115039038,
    "urls": [
      "https://dl.nibistudio.cn/nibi-go-app/apk/nibi-go-10-0.1.9.apk",
      "https://github.com/Ebonyhtx/nibi-go/releases/download/v0.1.9/app-release.apk"
    ]
  }
}
```

- Ed25519 detached 签名：对 `update.json` 原始字节签名，`.sig` 为 128 位 hex；
- 第一期复用 `nibi-go-market-2026-11` 密钥（0.1.8 内置公钥可验）；0.1.9 起可增加专用更新密钥；
- `versionCode` 必填且必须前进；`minVersionCode` 用于强制升级；
- `urls` 写进签名清单，换 CDN 不需要重发 App；
- 清单上限 64 KiB，只接受 https。

## 4. 客户端检查

`checkForUpdate()` 返回三态：

1. `GET https://dl.nibistudio.cn/nibi-go-app/update.json` + `.sig`（5 秒，带时间戳避免缓存）；
2. 验签 + schema + `versionCode` 比较；
3. dl 失败才回退 `api.github.com/repos/<repo>/releases/latest`（8 秒）；
4. 两者都失败返回 `status: "error"`，设置页显示“检查失败”，不再伪装成“已是最新”。

自动检查：

- 设置页开关「自动检查更新」，默认开；
- 开：启动 5 秒后静默检查一次；回前台且距上次超过 24 小时再查；只显示红点，不自动下载；
- 关：完全不自动发检查请求；手动“检查更新”始终可用。

## 5. 下载

- 按清单 `urls` 顺序尝试：dl → GitHub；
- 原生 `nibi-updater.downloadApk`：
  - 写 `<dest>.part`，支持 Range 断点续传；
  - 连接 15 秒 / 读空闲 30 秒超时；
  - 进度事件节流 250ms；
  - 完成后流式 SHA-256，摘要不符删除 `.part` 并换下一个源；
  - 全部失败保留 `.part` 供下次续传；
- 原生模块缺失时回退 `expo-file-system` 下载（无续传，仅应急）；
- 下载前检查剩余空间；安装成功后删除 APK。

## 6. 安装

- `FileProvider` + `PackageInstaller`，`REQUEST_INSTALL_PACKAGES`；
- 同包名、同签名覆盖安装，数据保留；
- Android 拒绝签名不连续或 versionCode 降级的包。

## 7. 信任链

```
update.json 的 Ed25519 签名
  → 清单里的 APK SHA-256
    → Android 的 APK 签名连续性
```

任何一道失败都拒绝更新；清单无签名/摘要缺失一律 fail-closed。

## 8. 发布流程

`scripts/release.mjs`：

1. 版本号与 versionCode 同时前进；
2. 门禁/测试/typecheck；
3. release 构建 + keystore 验签 + 本地 SHA-256；
4. **GitHub Release 必须创建**，上传 `app-release.apk`，核对 asset digest；
5. 如配置了 CDN 环境变量：
   - 本机 → 中转机临时目录（`scp`）→ `ossutil cp` 到 OSS；
   - OSS 内部回读校验 SHA-256；
   - 生成并签名 `update.json`；
   - 先传 `.sig`、再传 `update.json`；
   - 从公开 URL 拉回清单验签并核对版本；
6. 未配置 CDN 时打印警告，只发布 GitHub；客户端自动回退 GitHub 检查。
7. 如果 GitHub 已发布但 CDN 上传失败，修复环境后运行
   `node scripts/release.mjs <version> --cdn-only` 补发 APK + 签名清单，不重新构建。

CDN 发布环境变量（不写进仓库）：

```
NIBI_RELEASE_CDN_SSH          # 已配置免密的中转机
NIBI_RELEASE_CDN_REMOTE_DIR   # 中转机临时目录，默认 /tmp/nibi-go-release
NIBI_RELEASE_CDN_OSS_PREFIX   # oss://<bucket>/nibi-go-app
NIBI_RELEASE_CDN_OSS_CONF     # 中转机上的 ossutil 配置
NIBI_RELEASE_CDN_SUDO         # 需要 sudo 读配置时设为 1
NIBI_RELEASE_CDN_BASE         # 默认 https://dl.nibistudio.cn
NIBI_RELEASE_CDN_PREFIX       # 默认 nibi-go-app
NIBI_RELEASE_MANIFEST_KEY     # 默认 nibi-go-market-2026-11
NIBI_RELEASE_MIN_VERSION_CODE # 可选，强制升级下限
```

## 9. 缓存

| 路径 | Cache-Control |
|---|---|
| `nibi-go-app/apk/*` | `public, max-age=31536000, immutable` |
| `nibi-go-app/update.json` / `.sig` | `no-cache, max-age=0, must-revalidate` |

只 purge 清单，不 purge APK；APK 边缘缓存命中后不再回源 OSS。

## 10. 失败与回滚

| 失败 | 行为 |
|---|---|
| dl 清单不可达/验签失败 | 回退 GitHub API |
| dl APK 失败 | 换 GitHub 源 |
| 下载中断 | Range 续传 |
| 摘要不符 | 删除坏包，换源 |
| 安装被拒 | 显示系统原因，保留 APK 重试 |
| 发错版本 | 发更高 versionCode 修复；`minVersionCode` 强制升级 |
| GitHub 已发布但 CDN 失败 | 不回滚 app.json；补跑 CDN 上传 |
| 清单缓存旧 | 客户端带时间戳请求 + ESA 清单 no-cache |

## 11. 不做的事

- 不做 APK 二进制差分（签名会失效）；
- 不做 ABI 拆分（当前仅 arm64-v8a）；
- 不默认自动下载；
- 不在 GitHub 存 OSS 长期凭据或使用 OIDC；
- 不把插件市场搬进这套 CDN 链路（市场仍走 GitHub + jsDelivr/Fastly）。
