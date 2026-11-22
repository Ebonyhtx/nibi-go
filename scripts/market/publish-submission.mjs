#!/usr/bin/env node
// 把一份已审核的提交合并进市场仓索引并签名（维护者本机使用）。
//
// 用法：
//   node scripts/market/publish-submission.mjs <market-repo> <submission.json> [--dry-run] [--key <keyId>]
//
// 做四件事：校验提交与包 → 合并进 index.json（revision+1）→ 调用 sign-index.mjs 签名 →
// 回读验签自检。索引与签名写好后仍需你 commit + push 市场仓；服务器 cron 会自动镜像到 CDN。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { marketIndexSchema } from "../../packages/market-index/src/types.ts";
import { applySubmission, submissionSchema } from "../../packages/market-index/src/submission.ts";
import { verifyMarketIndexBytes } from "../../packages/market-index/src/verify.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const [repoArg, submissionArg] = positional;
const dryRun = args.includes("--dry-run");
const keyIndex = args.indexOf("--key");
const keyId = keyIndex >= 0 ? args[keyIndex + 1] : "nibi-go-market-2026-11";

if (!repoArg || !submissionArg) {
  console.error(
    "用法：node scripts/market/publish-submission.mjs <market-repo> <submission.json> [--dry-run] [--key <keyId>]",
  );
  process.exit(1);
}

const repo = path.resolve(repoArg);
const indexPath = path.join(repo, "index.json");
const submissionPath = path.resolve(submissionArg);

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

let indexRaw;
let submissionRaw;
try {
  indexRaw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
} catch (error) {
  fail(`读不到 ${indexPath}：${error.message}`);
}
try {
  submissionRaw = JSON.parse(fs.readFileSync(submissionPath, "utf8"));
} catch (error) {
  fail(`读不到 ${submissionPath}：${error.message}`);
}

const indexParsed = marketIndexSchema.safeParse(indexRaw);
if (!indexParsed.success) {
  fail(`index.json 形状不合法：${indexParsed.error.issues[0]?.message ?? "未知"}`);
}
const submissionParsed = submissionSchema.safeParse(submissionRaw);
if (!submissionParsed.success) {
  const issue = submissionParsed.error.issues[0];
  fail(`提交不合法：${issue ? `${issue.path.join("/")}: ${issue.message}` : "未知"}`);
}
const submission = submissionParsed.data;

// 包文件与摘要校验：仓内 zip 按本地文件核对；外部 zip 与标准 npm 由 CI/registry 校验 integrity/sha256。
if ("file" in submission.package) {
  const packagePath = path.join(repo, submission.package.file);
  if (!fs.existsSync(packagePath)) fail(`包不存在：${submission.package.file}`);
  const bytes = fs.readFileSync(packagePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== submission.package.sha256) {
    fail(`包摘要不一致（实际 ${digest}，提交 ${submission.package.sha256}）`);
  }
  if (bytes.length !== submission.package.size) {
    fail(`包大小不一致（实际 ${bytes.length}，提交 ${submission.package.size}）`);
  }
}

const applied = applySubmission(indexParsed.data, submission);
if (!applied.ok) fail(applied.reason);
if (applied.unchanged) {
  console.log(`未变化：${submission.id}@${submission.version} 已在索引里，revision 不变。`);
  process.exit(0);
}

console.log(
  `${dryRun ? "[dry-run] " : ""}将发布 ${submission.id}@${submission.version}：` +
    `revision ${indexParsed.data.revision} → ${applied.index.revision}`,
);
if (dryRun) process.exit(0);

fs.writeFileSync(indexPath, `${JSON.stringify(applied.index, null, 2)}\n`);

const sign = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/market/sign-index.mjs"), indexPath, "--key", keyId],
  { stdio: "inherit" },
);
if (sign.status !== 0) fail("签名失败（索引已更新但未签名，请检查密钥后重跑 sign-index）");

// 回读自检：签名必须能被内置公钥验证，且 revision 与内容一致。
const verified = verifyMarketIndexBytes(
  fs.readFileSync(indexPath),
  fs.readFileSync(`${indexPath}.sig`, "utf8"),
);
if (!verified.ok) fail(`签名自检失败：${verified.error}`);
if (verified.index.revision !== applied.index.revision) fail("签名自检 revision 不一致");

console.log(`完成：${submission.id}@${submission.version} → revision ${verified.index.revision}`);
console.log("下一步：git add index.json index.json.sig packages/ submissions/ && commit && push；服务器 cron 会自动镜像到 CDN。");
