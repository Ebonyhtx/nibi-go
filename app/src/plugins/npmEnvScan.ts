// 扫描本地已安装 npm MCP 包自身源码与 README，自动探测需要配置的环境变量。
//
// 仅扫描 `node_modules/<packageName>/` 下的包自身文件（绝不进入嵌套 node_modules），
// 受目录深度、文件数量与单文件字节数上限约束，失败一律安静返回已有显式项。

import { Directory, File } from "expo-file-system";

import type { NpmEnvSpec } from "@nibi-go/market-index";

import { detectNpmEnvSpecs } from "./npmRegistry";

const MAX_SCAN_DEPTH = 3;
const MAX_JS_FILES = 24;
const MAX_JS_BYTES = 512 * 1024;
const MAX_DOC_BYTES = 256 * 1024;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "test",
  "tests",
  "__tests__",
  "coverage",
  "docs",
  "examples",
  "example",
  ".github",
]);

const JS_FILE_RE = /\.(?:m|c)?js$|\.(?:m|c)?ts$/iu;
const IGNORE_JS_RE = /\.d\.ts$|\.(?:test|spec)\.(?:m|c)?[jt]s$/iu;
const README_FILE_RE = /^readme(?:[._-][a-z0-9-]+)?\.md$/iu;
const DOT_ENV_EXAMPLE_RE = /^\.?env\.(?:example|sample|template)$/iu;

function safeReadText(file: File, maxBytes: number): string | null {
  try {
    if (!file.exists) return null;
    if (typeof file.size === "number" && file.size > maxBytes) return null;
    return file.textSync();
  } catch {
    return null;
  }
}

/** 扫描插件目录下指定 npm 包自身代码与说明文档，产出自动探测的 NpmEnvSpec 列表。 */
export function scanNpmPackageEnvSpecs(
  pluginDir: Directory,
  packageName: string,
  options: {
    pluginEntry?: string;
    explicit?: readonly NpmEnvSpec[];
    maxCount?: number;
  } = {},
): NpmEnvSpec[] {
  const pkgParts = packageName
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  if (pkgParts.length === 0) {
    return detectNpmEnvSpecs({ explicit: options.explicit, maxCount: options.maxCount });
  }

  const pkgDir = new Directory(pluginDir, "node_modules", ...pkgParts);
  if (!pkgDir.exists) {
    return detectNpmEnvSpecs({ explicit: options.explicit, maxCount: options.maxCount });
  }

  const jsFiles: string[] = [];
  const envExampleFiles: string[] = [];
  const readmeFiles: string[] = [];
  const visitedUris = new Set<string>();

  // 入口脚本优先级最高：先读入口文件，确保核心 env 变量排在最前。
  if (options.pluginEntry) {
    const entryFile = new File(pluginDir, options.pluginEntry);
    const entryText = safeReadText(entryFile, MAX_JS_BYTES);
    if (entryText !== null) {
      visitedUris.add(entryFile.uri);
      jsFiles.push(entryText);
    }
  }

  const walk = (dir: Directory, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    let items: Array<Directory | File>;
    try {
      items = dir.list();
    } catch {
      return;
    }

    // 根目录先收集 README / .env.example，再按文件名排序遍历，保证结果稳定确定。
    items.sort((a, b) => a.name.localeCompare(b.name));

    for (const item of items) {
      if (item instanceof Directory) {
        if (depth >= MAX_SCAN_DEPTH) continue;
        if (SKIP_DIRS.has(item.name.toLowerCase())) continue;
        walk(item, depth + 1);
        continue;
      }
      if (!(item instanceof File)) continue;
      if (visitedUris.has(item.uri)) continue;

      if (depth === 0 && README_FILE_RE.test(item.name) && readmeFiles.length < 2) {
        const doc = safeReadText(item, MAX_DOC_BYTES);
        if (doc !== null) {
          visitedUris.add(item.uri);
          readmeFiles.push(doc);
        }
        continue;
      }
      if (depth === 0 && DOT_ENV_EXAMPLE_RE.test(item.name) && envExampleFiles.length < 2) {
        const doc = safeReadText(item, MAX_DOC_BYTES);
        if (doc !== null) {
          visitedUris.add(item.uri);
          envExampleFiles.push(doc);
        }
        continue;
      }
      if (
        jsFiles.length < MAX_JS_FILES &&
        JS_FILE_RE.test(item.name) &&
        !IGNORE_JS_RE.test(item.name)
      ) {
        const code = safeReadText(item, MAX_JS_BYTES);
        if (code !== null) {
          visitedUris.add(item.uri);
          jsFiles.push(code);
        }
      }
    }
  };

  walk(pkgDir, 0);

  return detectNpmEnvSpecs({
    jsFiles,
    envExampleFiles,
    readmeFiles,
    explicit: options.explicit,
    maxCount: options.maxCount,
  });
}
