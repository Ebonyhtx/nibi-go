// 一次性抽取脚本：把 V4 reducer 闭包从 reference 复制到 shared-extract（带来源头、改写 .js 扩展名、#src 别名转相对路径）。
// 用法：node scripts/extract-v4-closure.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("reference/nibi-client/packages/shared/src");
const out = path.resolve("packages/shared-extract/src");

const seen = new Set();

function resolveRelative(from, spec) {
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

function specsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  return [
    ...[...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/from\s+["'](#src\/[^"']+)["']/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\(\s*["'](#src\/[^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
}

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  for (const spec of specsOf(file)) {
    const dep = spec.startsWith("#src/") ? resolveAlias(spec) : resolveRelative(file, spec);
    if (dep) walk(dep);
  }
}

["apply.ts", "delta.ts", "rows.ts", "snapshot.ts", "toolDisplay.ts"].forEach((f) =>
  walk(path.join(root, "nibi-protocol-v4", f)),
);

const skip = new Set([
  "nibi-protocol-v4/core.ts",
  "nibi-protocol-v4/wire-binary.ts",
  "zcode-media-policy.ts",
]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

let copied = 0;
for (const file of seen) {
  const rel = toPosix(path.relative(root, file));
  if (skip.has(rel)) continue;
  let src = fs.readFileSync(file, "utf8");
  // 相对 import：去掉 .js 扩展名（bundler resolution）
  src = src.replace(/(from\s+["'])(\.[^"']+)\.js(["'])/g, "$1$2$3");
  src = src.replace(/(import\(\s*["'])(\.[^"']+)\.js(["'])/g, "$1$2$3");
  // #src 别名 → 相对路径（本包无别名映射）
  src = src.replace(/(from\s+["']|import\(\s*["'])(#src\/[^"']+)\.js(["'])/g, (all, pre, spec, post) => {
    const target = resolveAlias(spec);
    if (!target) return all;
    let relative = toPosix(path.relative(path.dirname(file), target)).replace(/\.ts$/, "");
    if (!relative.startsWith(".")) relative = "./" + relative;
    return `${pre}${relative}${post}`;
  });
  const header = `// 来源: nibi-client@ff1c5f4f packages/shared/src/${rel}（未改写语义；仅 import 路径按本包布局调整）\n`;
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, header + src);
  copied += 1;
}
console.log(`已抽取: ${copied} 个文件（闭包共 ${seen.size}，跳过已抽取 ${skip.size}）`);
