#!/usr/bin/env node
// 从市场索引撤回（下架）一个插件，并把记录追加进公开的 yanked.json。
//
// 用法：
//   node scripts/market/yank-plugin.mjs <market-repo> <plugin-id> --reason "..." [--version <v>] [--dry-run] [--key <keyId>]
//
// 做四件事：校验目标 → 从 index.json 移除（revision+1）→ 签名并回读验签 → 追加 yanked.json。
// 包文件保留在仓库里（已安装的副本不会被远程删除；公开记录需要可追溯）。
// 完成后仍需你 commit + push 市场仓；服务器 cron 会自动镜像新索引到 CDN。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { marketIndexSchema } from "../../packages/market-index/src/types.ts";
import { applyYank, checkYankLog, emptyYankLog, parseYankLog } from "../../packages/market-index/src/yank.ts";
import { verifyMarketIndexBytes } from "../../packages/market-index/src/verify.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const VALUE_OPTIONS = new Set(["--reason", "--version", "--key"]);
const positional = [];
const options = new Map();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (VALUE_OPTIONS.has(arg)) {
    options.set(arg, args[index + 1]);
    index += 1;
    continue;
  }
  if (arg.startsWith("--")) continue;
  positional.push(arg);
}
const [repoArg, idArg] = positional;
const dryRun = args.includes("--dry-run");
const option = (name) => options.get(`--${name}`);

const keyId = option("key") ?? "nibi-go-market-2026-11";
const reason = option("reason");

if (!repoArg || !idArg || !reason) {
  console.error(
    '用法：node scripts/market/yank-plugin.mjs <market-repo> <plugin-id> --reason "..." [--version <v>] [--dry-run] [--key <keyId>]',
  );
  process.exit(1);
}

const repo = path.resolve(repoArg);
const indexPath = path.join(repo, "index.json");
const yankPath = path.join(repo, "yanked.json");

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

let indexRaw;
try {
  indexRaw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
} catch (error) {
  fail(`读不到 ${indexPath}：${error.message}`);
}
const indexParsed = marketIndexSchema.safeParse(indexRaw);
if (!indexParsed.success) {
  fail(`index.json 形状不合法：${indexParsed.error.issues[0]?.message ?? "未知"}`);
}

let yankLog = emptyYankLog();
if (fs.existsSync(yankPath)) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(yankPath, "utf8"));
  } catch (error) {
    fail(`yanked.json 不是合法 JSON：${error.message}`);
  }
  const parsed = parseYankLog(raw);
  if (!parsed) fail("yanked.json 形状不合法");
  yankLog = parsed;
}

const applied = applyYank(indexParsed.data, {
  id: idArg,
  ...(option("version") ? { version: option("version") } : {}),
  reason,
});
if (!applied.ok) fail(applied.reason);

const nextLog = { ...yankLog, entries: [...yankLog.entries, applied.record] };
const problems = checkYankLog(nextLog, applied.index);
if (problems.length > 0) fail(`撤回记录不一致：${problems.map((problem) => problem.message).join("；")}`);

console.log(
  `${dryRun ? "[dry-run] " : ""}将撤回 ${applied.record.id}@${applied.record.version}：` +
    `revision ${indexParsed.data.revision} → ${applied.index.revision}`,
);
if (dryRun) process.exit(0);

fs.writeFileSync(indexPath, `${JSON.stringify(applied.index, null, 2)}\n`);
fs.writeFileSync(yankPath, `${JSON.stringify(nextLog, null, 2)}\n`);

const sign = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/market/sign-index.mjs"), indexPath, "--key", keyId],
  { stdio: "inherit" },
);
if (sign.status !== 0) fail("签名失败（索引已更新但未签名，请检查密钥后重跑 sign-index）");

const verified = verifyMarketIndexBytes(
  fs.readFileSync(indexPath),
  fs.readFileSync(`${indexPath}.sig`, "utf8"),
);
if (!verified.ok) fail(`签名自检失败：${verified.error}`);
if (verified.index.revision !== applied.index.revision) fail("签名自检 revision 不一致");
if (verified.index.plugins.some((plugin) => plugin.id === applied.record.id)) {
  fail("签名自检失败：撤回的条目仍在索引里");
}

console.log(`完成：${applied.record.id}@${applied.record.version} 已撤回 → revision ${verified.index.revision}`);
console.log("下一步：git add index.json index.json.sig yanked.json && commit && push；服务器 cron 会自动镜像到 CDN。");
