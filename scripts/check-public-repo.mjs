#!/usr/bin/env node
/**
 * Public-repository policy check.
 *
 * The public source tree must never contain private infrastructure, operator
 * paths, credentials, or internal-only workflows. This script is intentionally
 * dependency-free so it can run before `pnpm install`.
 *
 * 规则来源：nibi-client 公开仓的 scripts/check-public-repo.mjs（同款门禁，
 * 按本仓实际内容裁剪/增补）。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".sh",
  ".bash",
  ".ps1",
  ".cmd",
  ".bat",
  ".py",
  ".toml",
  ".txt",
  ".css",
  ".html",
  ".kt",
  ".kts",
  ".gradle",
  ".properties",
  ".xml",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".mmd",
  ".plist",
  ".java",
  ".swift",
  ".go",
  ".cs",
]);

const SKIP_FILES = new Set(["scripts/check-public-repo.mjs", "pnpm-lock.yaml"]);

const BINARY_KEY_EXTENSIONS = new Set([".key", ".p12", ".pfx", ".jks", ".keystore"]);

// 明确允许的片段（测试夹具的假凭据 / 项目自有的构建缓存默认目录）。
export const ALLOWED_SNIPPETS = [
  "sk-1234567890abcdefghijklmnopqrstuv",
  "ghp_123456789012345678901234567890",
  "AKIAIOSFODNN7EXAMPLE",
  "FAKE_SECRET",
  "127.0.0.1",
  "0.0.0.0",
  "localhost",
  "10.0.2.2", // Android 模拟器访问宿主的固定地址
  // Android 原生构建的短路径缓存默认目录（app/plugins/withCmakeVersion.js；
  // 可用 NIBIGO_CXX_STAGING 覆盖）。项目命名、非个人路径。
  "C:/nibigo-cxx",
  // 文档中"不要提交这种路径"的示例本身（CONTRIBUTING 规则 3）
  "/Users/<name>/",
  // 上游 kernel 测试夹具里的合成工作区路径（kernel/crates/...，随快照导入；
  // 不是任何人的真实主目录）。
  "/Users/dev",
  "/Users/dev/repo",
  // 同一批上游测试夹具里的合成家目录/工作区（kernel/crates/*_tests.rs）。
  "/Users/x",
  "/home/dev",
  "/home/nibi",
  "/home/u",
  "/Users/me",
  "/c/Users/dev",
  "/c/Users/x",
  "C:\\Users\\dev",
  "C:\\Users\\Dev",
  "c:\\Users\\dev",
  "C:\\Users\\me",
  "C:\\Users\\x",
  "C:\\Users\\system",
  "D:\\work",
  // 上游 kernel 单测夹具里的合成 Anthropic key 与离线测试 JWT（均非真实凭据）。
  "sk-ant-api03-abcdefghijklmnop",
  "sk-ant-test-0123456789abcdefghij",
  "sk-ant-0123456789abcdefghijklmn",
  "eyJpc3MiOiJuaWJpLWxpY2Vuc2UiLCJzdWIiOiJ1c2VyLTEi",
  "eyJpc3MiOiJ6Y29kZSIsInN1YiI6InVzZXItMSIsInVpZCI6InVzZXItMSI",
];

export const RULES = [
  {
    // 公网裸 IPv4 URL 基本是内部主机或部署细节泄露；回环/私网/测试网段除外。
    name: "raw public IPv4 URL",
    re: /https?:\/\/(?!127\.|0\.0\.0\.0|localhost|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|203\.0\.113\.|198\.51\.100\.|192\.0\.2\.)\d{1,3}(?:\.\d{1,3}){3}/i,
  },
  {
    // 本机绝对路径（Windows Users、NIBI 工作区、macOS/Linux 用户主目录）。
    name: "workspace absolute path",
    re: /(?:[A-Za-z]:[\\/]Users[\\/]|[A-Za-z]:[\\/]NIBI|\/Users\/|\/home\/[A-Za-z])/,
  },
  {
    name: "private key material",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: "internal container registry",
    re: /\b[A-Za-z0-9.-]+\.(?:cr\.aliyuncs\.com|tencentcloudcr\.com)\b/,
  },
  {
    name: "GitHub token",
    re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/,
  },
  {
    name: "fine-grained GitHub token",
    re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  },
  {
    name: "openai-style key",
    re: /\bsk-[A-Za-z0-9]{32,}\b/,
  },
  {
    name: "anthropic-style key",
    re: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/,
  },
  {
    name: "AWS access key",
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: "Alibaba Cloud access key",
    re: /\bLTAI[A-Za-z0-9]{16,24}\b/,
  },
  {
    name: "signed JWT token",
    re: /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  },
  {
    name: "release keystore filename",
    re: /\bnibi-go-release\.p12\b/i,
  },
  {
    // 内部基础设施与测试设备标识（对象存储桶、ossutil 配置、生产机 SSH 别名、站点根目录、私有机序列号）。
    // 公开仓只出现占位符（<ssh-alias> / <oss://bucket/prefix>），不写真实值。
    // 规则字面量本身不落盘：用 base64 存词表，避免门禁脚本自己把标识公开。
    name: "internal infra or device identifier",
    re: (() => {
      const terms = [
        ...Buffer.from(
          "bmliaS1kaXN0LWh6Cm5pYmktcGFpZC1oegpuaWJpLWJhY2t1cC1oegpuaWJpLWZlZWRiYWNrLWh6Cm5pYmktbG9ncy1oegpvc3N1dGlsLXB1Ymxpc2gKbmliaS1jbgpuaWJpLWdvLW9wcwpuaWJpLWdvLW1hcmtldC1zeW5jCmtleS1wYXNzcGhyYXNlCi9zcnYvbmliaS1zaXRlCi9vcHQvbmliaS0Ka2V5c3RvcmUvbmliaS1nby1tYXJrZXQ=",
          "base64",
        )
          .toString("utf8")
          .split("\n"),
        Buffer.from("ODA3OWZlNTk=", "base64").toString("utf8"),
      ].filter(Boolean);
      const words = terms.filter((term) => !term.includes("/"));
      const paths = terms
        .filter((term) => term.includes("/"))
        .map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
      return new RegExp(`\\b(?:${words.join("|")})\\b|${paths.join("|")}`);
    })(),
  },
  {
    name: "keystore password assignment",
    re: /(?:storePassword|keyPassword)\s*[:=]\s*["'][^"']{4,}["']/,
  },
];

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function isTextFile(file) {
  if (SKIP_FILES.has(file)) return false;
  if (file.split("/").some((part) => part === "node_modules" || part === "dist" || part === "build")) {
    return false;
  }
  return TEXT_EXTENSIONS.has(extname(file).toLowerCase());
}

function isAllowed(line) {
  return ALLOWED_SNIPPETS.some((snippet) => line.includes(snippet));
}

export { isAllowed };

function scanWorkflowShape(file, lines) {
  const violations = [];
  const isWorkflow = file.startsWith(".github/workflows/") && /\.ya?ml$/.test(file);
  if (!isWorkflow) return violations;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*#/.test(line)) continue;
    const uses = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
    if (uses) {
      const spec = uses[1];
      const isLocal = spec.startsWith("./") || spec.startsWith("docker://");
      const isPinned = /@[0-9a-f]{40}$/.test(spec);
      if (!isLocal && !isPinned) {
        violations.push({
          file,
          line: index + 1,
          rule: "action not pinned to a full commit SHA",
          text: line.trim(),
        });
      }
    }
    if (/\bsecrets\./.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "public workflow references secrets",
        text: line.trim(),
      });
    }
    if (/\bself-hosted\b/.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "public workflow uses a self-hosted runner",
        text: line.trim(),
      });
    }
    if (/\bpull_request_target\b/.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "public workflow uses pull_request_target",
        text: line.trim(),
      });
    }
    if (/\bpermissions\s*:\s*write-all\b/.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "public workflow requests write-all permissions",
        text: line.trim(),
      });
    }
  }
  return violations;
}

function checkRequiredFiles() {
  const required = [
    "LICENSE",
    "LICENSING.md",
    "NOTICE.md",
    "THIRD-PARTY-NOTICES.md",
    "TRADEMARKS.md",
    "README.md",
    "README.en.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "docs/README.md",
  ];
  return required
    .filter((file) => !existsSync(join(ROOT, file)))
    .map((file) => ({
      file,
      line: 0,
      rule: "required public file is missing",
      text: file,
    }));
}

function checkKeyFiles(trackedFiles, violations) {
  for (const file of trackedFiles) {
    const extension = extname(file).toLowerCase();
    let containsPrivateKey = BINARY_KEY_EXTENSIONS.has(extension);
    if (!containsPrivateKey && [".pem", ".crt", ".cer"].includes(extension)) {
      let content;
      try {
        content = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue;
      }
      containsPrivateKey = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/.test(content);
    }
    if (!containsPrivateKey) continue;
    violations.push({
      file,
      line: 0,
      rule: "key material must not be committed",
      text: file,
    });
  }
}

function checkRepoHygiene(trackedFiles, violations) {
  // reference/ 是本地只读参考，不允许进入版本库。
  for (const file of trackedFiles) {
    if (file === "reference" || file.startsWith("reference/")) {
      violations.push({
        file,
        line: 0,
        rule: "local reference checkout must not be tracked",
        text: file,
      });
    }
  }
  // 环境变量文件：只允许 *.example。
  for (const file of trackedFiles) {
    const name = file.split("/").pop() ?? "";
    if (/^\.env($|\.)/.test(name) && !name.endsWith(".example")) {
      violations.push({
        file,
        line: 0,
        rule: "env file must not be committed (use .env.example)",
        text: file,
      });
    }
  }
}

function checkImageMetadata(trackedFiles, violations) {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const MAX_DOC_ASSET_BYTES = 5 * 1024 * 1024;
  for (const file of trackedFiles) {
    const ext = extname(file).toLowerCase();
    if (ext !== ".png" && ext !== ".gif") continue;
    let buf;
    try {
      buf = readFileSync(join(ROOT, file));
    } catch {
      continue;
    }
    if (file.startsWith("docs/assets/") && buf.length > MAX_DOC_ASSET_BYTES) {
      violations.push({
        file,
        line: 0,
        rule: "doc image exceeds 5 MiB limit",
        text: `${buf.length} bytes`,
      });
    }
    if (ext === ".png" && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) {
      let offset = 8;
      while (offset + 12 <= buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
        const dataStart = offset + 8;
        const dataEnd = dataStart + len;
        if (dataEnd + 4 > buf.length) break;
        if (type === "eXIf") {
          violations.push({
            file,
            line: 0,
            rule: "PNG contains EXIF metadata (strip before committing)",
            text: "eXIf chunk",
          });
        } else if (type === "tEXt" || type === "iTXt") {
          const text = buf.subarray(dataStart, dataEnd).toString("utf8").replace(/\0/g, " ");
          if (!isAllowed(text)) {
            for (const rule of RULES) {
              if (rule.re.test(text)) {
                violations.push({
                  file,
                  line: 0,
                  rule: `PNG ${type} metadata matched ${rule.name}`,
                  text: text.trim().slice(0, 160),
                });
                break;
              }
            }
          }
        }
        offset = dataEnd + 4;
      }
    } else if (ext === ".gif") {
      // Scan GIF Comment Extensions (0x21 0xFE <sub-blocks> 0x00)
      for (let i = 0; i + 2 < buf.length; i += 1) {
        if (buf[i] === 0x21 && buf[i + 1] === 0xfe) {
          let p = i + 2;
          const parts = [];
          while (p < buf.length && buf[p] > 0) {
            const subLen = buf[p];
            parts.push(buf.subarray(p + 1, Math.min(buf.length, p + 1 + subLen)));
            p += 1 + subLen;
          }
          const comment = Buffer.concat(parts).toString("utf8");
          if (comment && !isAllowed(comment)) {
            for (const rule of RULES) {
              if (rule.re.test(comment)) {
                violations.push({
                  file,
                  line: 0,
                  rule: `GIF comment metadata matched ${rule.name}`,
                  text: comment.trim().slice(0, 160),
                });
                break;
              }
            }
          }
        }
      }
    }
  }
}

function main() {
  const trackedFiles = listTrackedFiles();
  const files = trackedFiles.filter(isTextFile);
  const violations = [];
  let scanned = 0;

  for (const file of files) {
    let content;
    try {
      content = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isAllowed(line)) continue;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          violations.push({
            file,
            line: index + 1,
            rule: rule.name,
            text: line.trim().slice(0, 200),
          });
          break;
        }
      }
    }
    violations.push(...scanWorkflowShape(file, lines));
  }

  violations.push(...checkRequiredFiles());
  checkKeyFiles(trackedFiles, violations);
  checkRepoHygiene(trackedFiles, violations);
  checkImageMetadata(trackedFiles, violations);

  const unique = [];
  const seen = new Set();
  for (const violation of violations) {
    const key = `${violation.file}:${violation.line}:${violation.rule}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(violation);
    }
  }

  if (unique.length === 0) {
    console.log(`[public-repo] OK: scanned ${scanned} text files, no policy violations.`);
    return;
  }

  console.error(`[public-repo] FAILED: ${unique.length} violation(s) in ${scanned} files.\n`);
  for (const violation of unique.slice(0, 80)) {
    const location = violation.line ? `${violation.file}:${violation.line}` : violation.file;
    console.error(`- ${location} [${violation.rule}]`);
    if (violation.text) console.error(`    ${violation.text}`);
  }
  if (unique.length > 80) {
    console.error(`\n... and ${unique.length - 80} more.`);
  }
  console.error(
    "\nRemove private infrastructure, credentials, internal paths, or unpinned actions before committing.",
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
