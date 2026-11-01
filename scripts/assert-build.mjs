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

// PresetPlus 的组合现在由 cordis.patch.yml 里的 `@deepseek-ai/dsh-agent-preset`
// 声明行承载（DSH 不再读取 $DSH_HOME/.agent-presets/ 目录）。
// 这里做结构性检查：声明行存在、组合非空、没有引用上游已移除的包。
// 真正的语义校验（每个 name 能否解析、realm 是否合规）需要一份部署，由挂载
// 校验兜底（见 CHANGELOG: workflow-worker-thread 曾导致整个模式挂载失败）。
const RETIRED = [
  // 0.2.1 起由 @deepseek-ai/dsh-workflow-ptc 取代。
  '@deepseek-ai/dsh-workflow-worker-thread',
  // 该子路径已不再导出；`list_agents` 由 tool-subagent-control 本身注册。
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
];

try {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  const problems = [];
  if (!/^\s*- id: preset-preset-plus\s*$/m.test(patch)) {
    problems.push('缺少 `- id: preset-preset-plus` 声明行（PresetPlus 模式不会出现）');
  }
  if (!/^\s*id: preset-plus\s*$/m.test(patch)) {
    problems.push('声明的 `config.id` 不是 preset-plus（与 config.scopedPresets 不匹配）');
  }
  if ((patch.match(/^\s*- id:/gm) || []).length < 2) {
    problems.push('组合里没有任何插件行（以该模式启动的会话不会有工具）');
  }
  // 只看真正的 `name:` 值，注释里提到旧包名不算引用。
  const names = [...patch.matchAll(/^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map((m) => m[1]);
  for (const name of RETIRED) {
    if (names.includes(name)) problems.push(`引用了上游已移除的包: ${name}`);
  }
  if (names.length === 0) problems.push('组合里没有任何 `name:` 行');
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[assert-build] ${problem}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`[assert-build] 读不了 cordis.patch.yml: ${e.message}`);
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
