#!/usr/bin/env node
// 架构门禁：层间依赖白名单检查（AGENTS.md 目录契约的机器化）。
// 用法：node scripts/check-boundaries.mjs
// 退出码 0 = 通过；1 = 违规。
// 规则：relay-client / chat-core 是纯 TS 层——禁止 import react-native /
// expo / @nibi-go/app 的任何内容；phone-tools 接口层不得 import Android 类型。

import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 层 -> 禁止出现的 import 前缀/模块名
const FORBIDDEN = {
  'packages/relay-client': ['react-native', 'expo', 'react', '@nibi-go/app'],
  'packages/chat-core': ['react-native', 'expo', 'react', '@nibi-go/app'],
  'packages/phone-tools': ['react-native-native-module', 'com.example', 'android.'],
};

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      yield* walk(full);
    } else if (/\.ts$|\.tsx$/.test(entry.name)) {
      yield full;
    }
  }
}

let violations = 0;
for (const [layer, banned] of Object.entries(FORBIDDEN)) {
  const layerDir = path.join(ROOT, layer);
  if (!fs.existsSync(layerDir)) continue;
  for (const file of walk(layerDir)) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      for (const bad of banned) {
        const re = new RegExp(`(from\\s+['"]|require\\(['"])(${bad})`);
        if (re.test(line)) {
          console.error(`违规: ${path.relative(ROOT, file)}:${i + 1} 引用了 "${bad}"（${layer} 层禁止）`);
          violations++;
        }
      }
    });
  }
}

if (violations > 0) {
  console.error(`\n架构门禁失败：${violations} 处违规。`);
  process.exit(1);
}
console.log('架构门禁通过：层间依赖符合白名单。');
