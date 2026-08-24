#!/usr/bin/env node
// dsh-preset-plus 是手写纯 JS，无编译步骤。"build" 因此在发布/安装前校验
// 发布入口确实存在且可解析——防止误发布一个缺文件的包。
// 注意：包内不再放 prepare/postinstall（pnpm 10 默认拦截依赖构建脚本，会破坏
// 一行安装）。本脚本在 CI 里作为显式步骤运行。

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 发布入口：host 端 + client bundle + 核心 + 打包清单
const REQUIRED = [
  'lib/index.js',
  'lib/core.js',
  'client.js',
  'cordis.patch.yml',
  'presets/jailbreak.json',
  'preset/preset.yml',
  'preset/agent.cordis.yml',
];

let failed = false;

for (const rel of REQUIRED) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    console.error(`[assert-build] 缺少文件: ${rel}`);
    failed = true;
  }
}

// host 入口单独做语法解析
for (const rel of ['lib/index.js', 'lib/core.js', 'client.js', 'presets/jailbreak.json']) {
  const abs = join(root, rel);
  try {
    readFileSync(abs, 'utf8'); // 能读即可；完整语法由 `lint` 的 node --check 做
  } catch (e) {
    console.error(`[assert-build] 读不了 ${rel}: ${e.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('[assert-build] 发布校验失败：请补齐缺失的发布入口。');
  process.exit(1);
}

// 用 import() 动态加载 host 核心，确认模块可加载（捕获顶层语法/导入错误）。
try {
  await import(pathToFileURL(join(root, 'lib/core.js')).href);
} catch (e) {
  console.error(`[assert-build] lib/core.js 无法加载: ${e.message}`);
  process.exit(1);
}

console.log('[assert-build] 就绪：发布入口完整，core 可加载。');
