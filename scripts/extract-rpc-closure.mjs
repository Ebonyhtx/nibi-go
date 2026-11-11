// 一次性抽取脚本：@nibi/rpc Layer 0-3 + @nibi/client acknowledged 协议（精简桥方案 B 的 wire 层）。
// 用法：node scripts/extract-rpc-closure.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("reference/nibi-client/packages");
const out = path.resolve("packages/shared-extract/src");

const rpcFiles = [
  "rpc/src/foundation.ts",
  "rpc/src/buffer.ts",
  "rpc/src/serialization.ts",
  "rpc/src/protocol.ts",
  "rpc/src/channels.shared.ts",
  "rpc/src/channels.ts",
  "rpc/src/channelClient.ts",
  "rpc/src/channelServer.ts",
  "rpc/src/delayedChannel.ts",
];

const acknowledgedRenames = new Map([
  ["webRemoteControlAcknowledgedRelayProtocol", "acknowledged-relay-protocol"],
  ["webRemoteControlAcknowledgedRelayBatchQueue", "acknowledged-relay-batch-queue"],
  ["webRemoteControlAcknowledgedRelayDeadline", "acknowledged-relay-deadline"],
  ["webRemoteControlAcknowledgedRelayProtocolTypes", "acknowledged-relay-protocol-types"],
]);

const acknowledgedFiles = [...acknowledgedRenames.keys()].map(
  (name) => `client/src/${name}.ts`,
);

function header(sourceRel) {
  return `// 来源: nibi-client@ff1c5f4f ${sourceRel}（未改写语义；仅 import 路径按本包布局调整）\n`;
}

function rewriteRelative(src) {
  src = src.replace(/(from\s+["'])(\.[^"']+)\.js(["'])/g, "$1$2$3");
  src = src.replace(/(import\(\s*["'])(\.[^"']+)\.js(["'])/g, "$1$2$3");
  return src;
}

function rewriteAliases(src) {
  // @nibi/rpc → 本地 rpc 桶（src/rpc/index.ts）
  src = src.replace(/(from\s+["'])@nibi\/rpc(["'])/g, '$1../rpc$2');
  // @nibi/shared 的 rpc-transport 符号 → 本地抽取件
  src = src.replace(/(from\s+["'])@nibi\/shared(["'])/g, '$1./rpc-transport$2');
  // acknowledged 四件套互相引用的重命名
  for (const [oldName, newName] of acknowledgedRenames) {
    src = src.replace(new RegExp(`(\\./)${oldName}(["'])`, "g"), `$1${newName}$2`);
  }
  return src;
}

// rpc 层
for (const rel of rpcFiles) {
  const srcPath = path.join(root, rel);
  const outRel = rel.replace(/^rpc\/src\//, "rpc/");
  const dest = path.join(out, outRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = rewriteRelative(fs.readFileSync(srcPath, "utf8"));
  fs.writeFileSync(dest, header(rel) + body);
}

// acknowledged 协议层（重命名去前缀）
for (const rel of acknowledgedFiles) {
  const srcPath = path.join(root, rel);
  const baseName = path.basename(rel, ".ts");
  const newName = acknowledgedRenames.get(baseName);
  const dest = path.join(out, "web-remote-control", `${newName}.ts`);
  const body = rewriteAliases(rewriteRelative(fs.readFileSync(srcPath, "utf8")));
  fs.writeFileSync(dest, header(rel) + body);
}

// rpc 桶文件
const barrelLines = ["// 来源: nibi-client@ff1c5f4f packages/rpc/src/index.ts（子集——Layer 0-3，精简桥方案 B）"];
for (const rel of rpcFiles) {
  const name = path.basename(rel, ".ts");
  barrelLines.push(`export * from "./${name}";`);
}
fs.writeFileSync(path.join(out, "rpc", "index.ts"), barrelLines.join("\n") + "\n");

console.log(
  `已抽取: rpc ${rpcFiles.length} 文件 + acknowledged ${acknowledgedFiles.length} 文件 + rpc 桶`,
);
