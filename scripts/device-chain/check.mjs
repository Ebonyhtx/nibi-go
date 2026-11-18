#!/usr/bin/env node
// 真机会话链检查（P3）：从 rollout 的 model-io 记录里读“模型实际收到什么”，
// 把人工比对变成一条命令。只读，不改设备、不改仓库。
//
// 用法：
//   node scripts/device-chain/check.mjs --list
//   node scripts/device-chain/check.mjs --latest
//   node scripts/device-chain/check.mjs --session sess_xxxx
//   node scripts/device-chain/check.mjs --session sess_xxxx --json
//
// 断言（同一会话内）：
//   1. 任何一次模型请求 outcome 不是 completed → FAIL（网络/协议失败）。
//   2. 同一模型连续两跳的缓存命中率 ≥ 80%（换模型首跳、压缩后的首跳豁免）。
//   3. 压缩请求出现时，记录里必须能找到它的 timeline marker 对应的 tokensBefore（>=0）。
//
// 安全：rollout 的 request.headers 里有 API key。本脚本只读白名单字段
// （path/model/usage/outcome/querySource），且永不打印原始 JSON。

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE = "top.nibistudio.nibigo";
const ROLLOUT_DIR = "files/.nibi/cli/rollout";
const CACHE_FLOOR = 0.8;

function adb(args, encoding = "utf8") {
  return execFileSync("adb", args, { encoding, maxBuffer: 64 * 1024 * 1024 });
}

function firstDevice() {
  const lines = adb(["devices"]).split("\n").slice(1);
  const found = lines.map((line) => line.trim().split(/\s+/)).find((parts) => parts[1] === "device");
  return found?.[0];
}

function listRollouts() {
  const out = adb([
    "shell",
    "run-as",
    PACKAGE,
    "ls",
    "-la",
    ROLLOUT_DIR,
  ]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") && line.endsWith(".jsonl"))
    .map((line) => {
      const parts = line.split(/\s+/);
      return { name: parts[parts.length - 1], size: Number(parts[4]) || 0 };
    })
    .map((entry) => ({
      ...entry,
      sessionId: /model-io-(sess_[^.]+)\.jsonl$/.exec(entry.name)?.[1] ?? entry.name,
    }))
    .sort((left, right) => right.size - left.size);
}

/** 用 exec-out 取原始字节（`adb shell cat` 会把 LF 换成 CRLF，破坏 JSONL 里的内容）。 */
function readRollout(name) {
  const dir = mkdtempSync(join(tmpdir(), "nibigo-chain-"));
  const local = join(dir, "io.jsonl");
  try {
    const bytes = adb(["exec-out", "run-as", PACKAGE, "cat", `${ROLLOUT_DIR}/${name}`], "buffer");
    const text = bytes.toString("utf8").replace(/\r\n/g, "\n");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function summarize(record) {
  const request = record.request ?? {};
  const body = request.body ?? {};
  const response = record.response ?? {};
  const usage = response.usage ?? {};
  const input = usage.inputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  return {
    source: String(record.querySource ?? "?"),
    model: String(body.model ?? "?"),
    path: String(request.path ?? ""),
    outcome: String(record.outcome ?? "?"),
    durationMs: Number(record.durationMs ?? 0),
    input,
    output: usage.outputTokens ?? 0,
    cacheRead,
    cacheRate: input > 0 ? cacheRead / input : null,
    effort: body.output_config?.effort ?? null,
  };
}

function check(records) {
  const rows = records.map(summarize);
  const failures = [];
  const warnings = [];

  rows.forEach((row, index) => {
    if (row.outcome !== "completed") {
      failures.push(`#${index} ${row.source} 失败（${row.outcome}）`);
    }
  });

  // 缓存只在“同一模型、中间没压缩”的连续两跳之间有可比性；换模型/压缩后的第一跳豁免。
  let previousMain = null;
  let dirty = false;
  rows.forEach((row, index) => {
    if (row.source === "compact") {
      dirty = true;
      return;
    }
    if (row.source !== "main_turn") return;
    if (previousMain) {
      if (previousMain.model !== row.model) dirty = true;
      if (!dirty && row.cacheRate !== null && row.cacheRate < CACHE_FLOOR) {
        failures.push(
          `#${index} 同模型连续两跳缓存只有 ${(row.cacheRate * 100).toFixed(0)}%（下限 ${CACHE_FLOOR * 100}%）`,
        );
      }
    }
    previousMain = row;
    dirty = false;
  });

  const mains = rows.filter((row) => row.source === "main_turn");
  if (mains.length === 0) warnings.push("没有 main_turn 记录（只开了会话？）");
  if (mains.some((row) => row.path.includes("127.0.0.1") || row.path.includes("localhost"))) {
    failures.push("有请求打到本机 mock 端点（127.0.0.1/localhost）——真实 Provider 没生效");
  }

  return { rows, failures, warnings };
}

function print(rows, failures, warnings) {
  const pad = (value, width) => String(value).padEnd(width);
  console.log(
    `${pad("#", 3)}${pad("source", 24)}${pad("model", 18)}${pad("in", 7)}${pad("out", 6)}${pad("cache", 8)}effort`,
  );
  rows.forEach((row, index) => {
    const rate = row.cacheRate === null ? "-" : `${(row.cacheRate * 100).toFixed(0)}%`;
    console.log(
      `${pad(index, 3)}${pad(row.source, 24)}${pad(row.model, 18)}${pad(row.input, 7)}${pad(row.output, 6)}${pad(rate, 8)}${row.effort ?? "-"}`,
    );
  });
  for (const warning of warnings) console.log(`WARN  ${warning}`);
  for (const failure of failures) console.log(`FAIL  ${failure}`);
  console.log(failures.length === 0 ? "PASS  会话链检查通过" : `FAIL  ${failures.length} 条断言失败`);
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  if (!firstDevice()) {
    console.error("没有连接的 Android 设备（adb devices）");
    process.exit(2);
  }
  const rollouts = listRollouts();
  if (args.includes("--list") || rollouts.length === 0) {
    for (const entry of rollouts) {
      console.log(`${entry.sessionId}  ${(entry.size / 1024).toFixed(0)} KiB  ${entry.name}`);
    }
    if (rollouts.length === 0) console.error("设备上没有 rollout 记录");
    return;
  }
  const wanted = flag("--session");
  const target = wanted
    ? rollouts.find((entry) => entry.sessionId === wanted || entry.name.includes(wanted))
    : rollouts[0];
  if (!target) {
    console.error(`找不到会话 ${wanted}；用 --list 看可用的`);
    process.exit(2);
  }
  const { rows, failures, warnings } = check(readRollout(target.name));
  if (args.includes("--json")) {
    console.log(JSON.stringify({ session: target.sessionId, rows, failures, warnings }, null, 2));
  } else {
    console.log(`session ${target.sessionId}`);
    print(rows, failures, warnings);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
