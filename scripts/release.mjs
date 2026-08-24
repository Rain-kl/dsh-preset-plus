#!/usr/bin/env node
// dsh-preset-plus 的一键发版脚本（照搬 modlens/release.mjs 的守卫顺序，但不 publish）。
//
//   pnpm release 0.1.1       显式版本
//   pnpm release patch       从当前版本 bump
//
// 顺序原则：所有能拒绝发版的事，都在不可逆动作（改版本/提交/打 tag/push）之前完成。
// 本脚本不 publish——push 出 v* tag 会触发 .github/workflows/release.yml，
// 那里是唯一执行 npm publish + 建 GitHub Release 的地方，避免双发竞争。

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf-8', stdio: 'pipe', ...opts }).trim();

function fail(message) {
  console.error(`\nRelease stopped: ${message}\n`);
  process.exit(1);
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const pkgName = pkg.name;

const requested = process.argv[2];
if (!requested) fail('give a version (0.1.1) or a bump (patch, minor, major).');

const next = (() => {
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  if (requested === 'major') return `${major + 1}.0.0`;
  if (requested === 'minor') return `${major}.${minor + 1}.0`;
  if (requested === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (!/^\d+\.\d+\.\d+$/.test(requested)) fail(`"${requested}" is not a version or a bump.`);
  const toParts = (v) => v.split('.').map(Number);
  const [ca, cb, cc] = toParts(pkg.version);
  const [na, nb, nc] = toParts(requested);
  const forward = na > ca || (na === ca && (nb > cb || (nb === cb && nc > cc)));
  if (!forward) fail(`"${requested}" is not higher than the current version ${pkg.version}.`);
  return requested;
})();

// --- 能拒绝发版的事，先全部完成 ---

if (run('git', ['status', '--porcelain'])) fail('the working tree has uncommitted changes. Commit them first.');
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') fail(`on branch ${branch}, not main.`);
if (run('git', ['tag', '--list', `v${next}`])) fail(`tag v${next} already exists.`);

run('git', ['fetch', 'origin', 'main']);
try {
  run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
} catch {
  fail('local main is behind or diverged from origin/main. Pull first.');
}
try {
  if (run('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${next}`])) fail(`tag v${next} already exists on origin.`);
} catch (error) {
  fail(`cannot reach origin to verify tags: ${error.message ?? error}`);
}

// 要求 CHANGELOG 里有对应版本段（release workflow 会提取它作为 notes）。
// 段标题形如 "## 0.1.0 - 初始发行"，用前缀匹配（与 release.yml 的 awk 一致）。
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
const hasSection = changelog.split('\n').some((line) => {
  const t = line.trim();
  return t === `## ${next}` || t.startsWith(`## ${next} `) || t.startsWith(`## [${next}]`);
});
if (!hasSection) fail(`CHANGELOG.md has no "## ${next}" section. Add one before releasing.`);

// --- 全部守卫通过，开始不可逆动作 ---

// bump version
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

run('git', ['add', 'package.json', 'CHANGELOG.md']);
run('git', ['commit', '-m', `release: ${pkgName} v${next}`]);
run('git', ['tag', `v${next}`]);
run('git', ['push', 'origin', 'main', `v${next}`]);

console.log(`\nRelease v${next} tagged and pushed. .github/workflows/release.yml will publish & create the Release.\n`);
