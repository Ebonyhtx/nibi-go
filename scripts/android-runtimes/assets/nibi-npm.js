#!/usr/bin/env node
// npm wrapper for Android: run npm-cli, then rewrite node_modules/.bin entries
// to nibi-run shims (app-data scripts cannot be execve'd directly; npm prepends
// .bin to PATH for run-scripts). The original targets are preserved under
// <root>/.nibi-bins/<name> and resolved by nibi-run.
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mode = path.basename(process.argv[1] || "") === "nibi-npx.js" ? "npx" : "npm";
const cli = path.join(__dirname, "bin", mode === "npx" ? "npx-cli.js" : "npm-cli.js");

// Keep the real target next to the shim so nibi-run can find it from argv[0]
// alone (it cannot search the project root, and execve on app-data scripts is
// blocked, so the .bin entry itself must be the native nibi-run binary).
function rewrite(root) {
  const binDir = path.join(root, "node_modules", ".bin");
  if (!fs.existsSync(binDir)) return;
  const store = path.join(binDir, ".nibi-targets");
  fs.mkdirSync(store, { recursive: true });
  let runner = null;
  try {
    runner = fs.realpathSync(path.join(process.env.NIBI_BIN || ".", "nibi-run"));
  } catch {
    // no NIBI_BIN (desktop/dev): nothing to rewrite
  }
  for (const name of fs.readdirSync(binDir)) {
    if (name === ".nibi-targets") continue;
    const entry = path.join(binDir, name);
    let real;
    try {
      real = fs.realpathSync(entry);
    } catch {
      continue;
    }
    // Already rewired by an earlier npm run (e.g. `npm install` with no
    // changes): keep the stored target and do not record nibi-run as one.
    if (real === process.execPath || real === __filename || (runner && real === runner)) {
      continue;
    }
    const saved = path.join(store, name);
    try {
      if (!fs.existsSync(saved)) fs.symlinkSync(real, saved);
    } catch {
      // keep going; the shim is still useful for simple CLIs
    }
    try {
      fs.unlinkSync(entry);
      fs.symlinkSync(path.join(process.env.NIBI_BIN || ".", "nibi-run"), entry);
    } catch {
      // leave the original entry if we cannot replace it
    }
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
