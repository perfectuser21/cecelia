#!/usr/bin/env node
/**
 * changed-test-router.mjs
 *
 * 路由 fs 依赖测试：当 packages/workflows/skills/ 下文件变更时，
 * vitest --changed 无法追踪 readFileSync 读取的文件（不在 import 图里），
 * 本脚本补这个漏——输出额外需执行的测试文件路径清单到 stdout。
 *
 * 用法：
 *   node changed-test-router.mjs --files file1 [file2 ...]
 *
 * 输出：每行一个测试文件路径（相对于仓库根）
 * 缺 --files 参数 → 非零退出（fail-closed）
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 仓库根：packages/brain/scripts/ci/ → 4 层 up
const REPO_ROOT = resolve(__dirname, '../../../..');

// fs 依赖路由表：变更文件 pattern → 额外需运行的测试文件
const ROUTES = [
  {
    // skill 文件变更 → skill 契约测试
    match: (f) => f.startsWith('packages/workflows/skills/'),
    tests: ['packages/brain/src/__tests__/skill-contract.test.js'],
  },
  {
    // contract 门 脚本变更 → contract gate 相关测试
    match: (f) =>
      f.startsWith('packages/brain/scripts/ci/') &&
      f.includes('contract'),
    tests: ['packages/brain/src/__tests__/skill-contract.test.js'],
  },
];

// ── 解析 --files 参数 ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const filesIdx = args.indexOf('--files');

if (filesIdx === -1 || filesIdx === args.length - 1) {
  process.stderr.write(
    'Usage: changed-test-router.mjs --files <file1> [file2 ...]\n' +
      'Error: --files parameter is required (fail-closed)\n',
  );
  process.exit(1);
}

const changedFiles = args.slice(filesIdx + 1);

if (changedFiles.length === 0) {
  process.stderr.write(
    'Error: at least one file must be specified after --files\n',
  );
  process.exit(1);
}

// ── 路由匹配 ───────────────────────────────────────────────────────────────
const outputSet = new Set();

for (const changed of changedFiles) {
  // 归一化：去掉前导 ./
  const normalized = changed.replace(/^\.\//, '');
  for (const route of ROUTES) {
    if (route.match(normalized)) {
      for (const testPath of route.tests) {
        const abs = resolve(REPO_ROOT, testPath);
        if (existsSync(abs)) {
          outputSet.add(testPath);
        }
      }
    }
  }
}

// ── 输出 ───────────────────────────────────────────────────────────────────
for (const p of outputSet) {
  process.stdout.write(p + '\n');
}
