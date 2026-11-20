#!/usr/bin/env node
// 把市场仓的 index.json / .sig / packages 镜像到免费内容 CDN（dl.nibistudio.cn）。
//
// 仓库里不写任何主机/桶/密钥：全部从环境变量读，避免公开仓泄露运维细节。
//
//   NIBI_MARKET_SSH=<ssh-alias>                   # ssh 目标（已配置免密）
//   NIBI_MARKET_REMOTE_DIR=/tmp/nibi-go-market    # 远端临时目录
//   NIBI_MARKET_OSS_PREFIX=oss://<bucket>/nibi-go-market
//   NIBI_MARKET_OSS_CONF=<ossutil-config-path>    # ossutil 配置（服务端 root 可读）
//   NIBI_MARKET_SUDO=1                            # 需要 sudo 读 ossutil 配置时设置
//
// Windows Git Bash 下必须关掉路径改写，否则 /tmp、/srv 会被换成本机 Windows 路径：
//   MSYS2_ENV_CONV_EXCL='*' MSYS2_ARG_CONV_EXCL='*' node scripts/market/mirror-cdn.mjs <market-repo-dir>
//
// 用法：node scripts/market/mirror-cdn.mjs <market-repo-dir>
// 会先做本地校验（签名、schema、包 sha256/size），再逐个文件 ssh cat + ossutil cp。
import { spawnSync } from "node:child_process";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repo = process.argv[2];
if (!repo) {
  console.error("用法：node scripts/market/mirror-cdn.mjs <market-repo-dir>");
  process.exit(1);
}
const dir = path.resolve(repo);
const env = process.env;
const sshTarget = env.NIBI_MARKET_SSH?.trim();
const remoteDir = env.NIBI_MARKET_REMOTE_DIR?.trim();
const ossPrefix = env.NIBI_MARKET_OSS_PREFIX?.trim()?.replace(/\/+$/u, "");
const ossConf = env.NIBI_MARKET_OSS_CONF?.trim();
const useSudo = env.NIBI_MARKET_SUDO === "1";

for (const [name, value] of Object.entries({
  NIBI_MARKET_SSH: sshTarget,
  NIBI_MARKET_REMOTE_DIR: remoteDir,
  NIBI_MARKET_OSS_PREFIX: ossPrefix,
  NIBI_MARKET_OSS_CONF: ossConf,
})) {
  if (!value) {
    console.error(`缺少环境变量 ${name}`);
    process.exit(1);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.input ? ["pipe", "inherit", "inherit"] : options.capture ? "pipe" : "inherit",
    input: options.input,
    encoding: options.input ? undefined : "utf8",
  });
  if (result.error) throw new Error(`${command} 无法执行：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} 退出码 ${result.status}`);
  return options.capture ? `${result.stdout ?? ""}`.trim() : "";
}

// 1) 本地索引与包校验（只读；不依赖私钥）
const indexBytes = fs.readFileSync(path.join(dir, "index.json"));
const signatureHex = fs.readFileSync(path.join(dir, "index.json.sig"), "utf8").trim();
const publicKeyHex = "90c6acbb9a020d1d567807620250a56e5822e70324b894bbc3a03fe3a6a2fd04";
const signature = Buffer.from(signatureHex, "hex");
if (
  signature.length !== 64 ||
  !ed25519.verify(signature, indexBytes, Buffer.from(publicKeyHex, "hex"))
) {
  console.error("index.json 签名校验失败：拒绝镜像");
  process.exit(1);
}
const index = JSON.parse(indexBytes.toString("utf8"));
const files = [
  { local: path.join(dir, "index.json"), remote: "index.json" },
  { local: path.join(dir, "index.json.sig"), remote: "index.json.sig" },
];
for (const plugin of index.plugins ?? []) {
  const url = plugin.package?.url ?? "";
  const marker = "/main/";
  const relative = url.includes(marker) ? url.slice(url.indexOf(marker) + marker.length) : "";
  if (!relative) {
    console.error(`${plugin.id} 的包地址不在市场仓 main 下：${url}`);
    process.exit(1);
  }
  const local = path.join(dir, relative);
  if (!fs.existsSync(local)) {
    console.error(`${plugin.id} 的包文件不存在：${relative}`);
    process.exit(1);
  }
  const digest = createHash("sha256").update(fs.readFileSync(local)).digest("hex");
  if (digest !== plugin.package.sha256) {
    console.error(`${plugin.id} 的包摘要与索引不一致：拒绝镜像`);
    process.exit(1);
  }
  files.push({ local, remote: relative });
}

// 2) 通过 ssh cat 把文件写到远端临时目录
// （Windows 的 scp 会把 `C:/...` 当成 host:path，所以不用 scp）
run("ssh", [sshTarget, `mkdir -p ${remoteDir}/packages`]);
for (const file of files) {
  run("ssh", [sshTarget, `cat > ${remoteDir}/${file.remote}`], { input: fs.readFileSync(file.local) });
}

// 3) ossutil cp 到 CDN 桶
const sudo = useSudo ? "sudo " : "";
for (const file of files) {
  const command =
    `${sudo}ossutil cp -f ${remoteDir}/${file.remote} ${ossPrefix}/${file.remote} --config-file ${ossConf}`;
  run("ssh", [sshTarget, command]);
  console.log(`mirrored ${file.remote}`);
}

console.log(`完成：revision ${index.revision}，${files.length} 个文件 → ${ossPrefix}`);
