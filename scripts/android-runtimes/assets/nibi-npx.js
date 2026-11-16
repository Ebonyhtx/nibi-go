#!/usr/bin/env node
// npx wrapper: same .bin rewrite as nibi-npm.js, but runs npx-cli.js.
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const cli = path.join(__dirname, "bin", "npx-cli.js");

function rewrite(root) {
  const binDir = path.join(root, "node_modules", ".bin");
  if (!fs.existsSync(binDir)) return;
  const store = path.join(root, ".nibi-bins");
  fs.mkdirSync(store, { recursive: true });
  for (const name of fs.readdirSync(binDir)) {
    const entry = path.join(binDir, name);
    let real;
    try {
      real = fs.realpathSync(entry);
    } catch {
      continue;
    }
    if (real === process.execPath || real === __filename) continue;
    const saved = path.join(store, name);
    try {
      if (!fs.existsSync(saved)) fs.symlinkSync(real, saved);
    } catch {}
    try {
      fs.unlinkSync(entry);
      fs.symlinkSync(path.join(process.env.NIBI_BIN || ".", "nibi-run"), entry);
    } catch {}
  }
}

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
for (const root of [process.cwd(), process.env.NPM_CONFIG_PREFIX].filter(Boolean)) {
  rewrite(root);
}
process.exit(result.status ?? 1);
