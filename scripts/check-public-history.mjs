#!/usr/bin/env node
// 公开仓提交历史门禁：只扫「新增提交」里新增的行，防止把基础设施/凭据写进历史。
//
// 用法：
//   node scripts/check-public-history.mjs [<rev-range>]   # 默认 HEAD~1..HEAD
//   node scripts/check-public-history.mjs --all           # 全历史审计（手工/定时）
//
// 与 check-public-repo.mjs 共用规则；当前树的门禁仍由那个脚本负责。
// 为什么不默认全历史：公开仓历史里可能有旧的、已从当前树清理的记录；全量扫描用于
// 手工审计与决定是否重写历史，不应在每次 push 时阻塞。
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { isAllowed, RULES } from "./check-public-repo.mjs";

const args = process.argv.slice(2);
const all = args.includes("--all");
const range = all ? "--all" : (args.find((arg) => !arg.startsWith("--")) ?? "HEAD~1..HEAD");

let log;
try {
  log = execFileSync(
    "git",
    ["log", `--format=@@@%H %s`, "-p", "--unified=0", ...(all ? ["--all"] : [range])],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 },
  );
} catch (error) {
  if (range === "HEAD~1..HEAD") {
    console.log("[public-history] 没有可扫描的提交（HEAD~1 不存在）。");
    process.exit(0);
  }
  console.error(`[public-history] git log 失败：${error.message}`);
  process.exit(1);
}

const violations = [];
let commit = "";
let file = "";
let lineNumber = 0;
for (const raw of log.split("\n")) {
  if (raw.startsWith("@@@")) {
    commit = raw.slice(3);
    file = "";
    lineNumber = 0;
    continue;
  }
  if (raw.startsWith("+++ b/")) {
    file = raw.slice(6);
    continue;
  }
  if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
  lineNumber += 1;
  const text = raw.slice(1);
  if (isAllowed(text)) continue;
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      violations.push({
        commit,
        file: file || "(commit message/diff header)",
        rule: rule.name,
        text: text.trim().slice(0, 200),
      });
      break;
    }
  }
}

if (violations.length === 0) {
  console.log(`[public-history] OK: ${all ? "all history" : range}`);
  process.exit(0);
}

console.error(`[public-history] FAILED: ${violations.length} violation(s) in ${all ? "all history" : range}.\n`);
for (const violation of violations.slice(0, 80)) {
  console.error(`- ${violation.commit} ${violation.file} [${violation.rule}]`);
  if (violation.text) console.error(`    ${violation.text}`);
}
if (violations.length > 80) console.error(`\n... and ${violations.length - 80} more.`);
console.error("\nRemove private infrastructure, credentials or internal paths from the added lines.");
process.exitCode = 1;
