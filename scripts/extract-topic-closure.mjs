// 一次性抽取脚本：conversation topic 传输层（transport.ts + wire 四件套）及其干净依赖闭包。
// 排除 legacy 全量桶（nibi-protocol/index.ts，4221 行）：usage-stats.ts 对它的两个 type-only
// import 改指本包局部类型文件 legacy-account-access.ts（编译期擦除，无运行时依赖）。
// 用法：node scripts/extract-topic-closure.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("reference/nibi-client/packages/shared/src");
const out = path.resolve("packages/shared-extract/src");

const seeds = [
  "nibi-protocol-v4/transport.ts",
  "nibi-protocol-v4/wire.ts",
  "nibi-protocol-v4/wire-codec.ts",
  "nibi-protocol-v4/wire-assembler.ts",
  "nibi-protocol-v4/wire-reassembly.ts",
  "nibi-protocol-v4/wire-fault.ts",
];

// 已抽取文件（跳过复制；闭包遍历仍会包含它们以便继续展开其依赖，但依赖已抽过）
const alreadyExtracted = new Set([
  "nibi-protocol-v4/core.ts",
  "nibi-protocol-v4/wire-binary.ts",
  "zcode-media-policy.ts",
]);

// legacy 桶不抽取也不遍历（其内部依赖与 topic 无关）
const excluded = new Set(["nibi-protocol/index.ts"]);

const seen = new Set();
function resolveSpec(from, spec) {
  if (!spec.startsWith(".")) return null;
  let p = path.resolve(path.dirname(from), spec);
  if (p.endsWith(".js")) p = p.slice(0, -3);
  if (fs.existsSync(p + ".ts")) return p + ".ts";
  if (fs.existsSync(path.join(p, "index.ts"))) return path.join(p, "index.ts");
  return null;
}
function resolveAlias(spec) {
  if (!spec.startsWith("#src/")) return null;
  let p = path.resolve(root, spec.slice("#src/".length));
  if (p.endsWith(".js")) p = p.slice(0, -3);
  return fs.existsSync(p + ".ts") ? p + ".ts" : null;
}

function walk(file) {
  if (seen.has(file)) return;
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (excluded.has(rel)) return;
  seen.add(file);
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const dep = resolveSpec(file, m[1]);
    if (dep) walk(dep);
  }
  for (const m of src.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    const dep = resolveSpec(file, m[1]);
    if (dep) walk(dep);
  }
  for (const m of src.matchAll(/from\s+["'](#src\/[^"']+)["']/g)) {
    const dep = resolveAlias(m[1]);
    if (dep) walk(dep);
  }
  for (const m of src.matchAll(/import\(\s*["'](#src\/[^"']+)["']\s*\)/g)) {
    const dep = resolveAlias(m[1]);
    if (dep) walk(dep);
  }
}
seeds.forEach((s) => walk(path.join(root, s)));

function toPosix(p) {
  return p.split(path.sep).join("/");
}

let copied = 0;
for (const file of seen) {
  const rel = toPosix(path.relative(root, file));
  if (alreadyExtracted.has(rel)) continue;
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/(from\s+["'])(\.[^"']+)\.js(["'])/g, "$1$2$3");
  src = src.replace(/(import\(\s*["'])(\.[^"']+)\.js(["'])/g, "$1$2$3");
  // legacy 桶的两个 type-only 符号 → 本包局部类型文件
  src = src.replace(
    /from\s+["']\.\/nibi-protocol\/index["']/g,
    'from "./legacy-account-access"',
  );
  // #src 别名 → 相对路径
  src = src.replace(
    /(from\s+["']|import\(\s*["'])(#src\/[^"']+)\.js(["'])/g,
    (all, pre, spec, post) => {
      const target = resolveAlias(spec);
      if (!target) return all;
      let relative = toPosix(path.relative(path.dirname(file), target)).replace(/\.ts$/, "");
      if (!relative.startsWith(".")) relative = "./" + relative;
      return `${pre}${relative}${post}`;
    },
  );
  const header = `// 来源: nibi-client@ff1c5f4f packages/shared/src/${rel}（未改写语义；仅 import 路径按本包布局调整）\n`;
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, header + src);
  copied += 1;
}
console.log(`已抽取: ${copied} 个文件（闭包共 ${seen.size}）`);
