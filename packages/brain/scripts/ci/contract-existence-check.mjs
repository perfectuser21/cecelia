#!/usr/bin/env node
/**
 * contract-existence-check.mjs
 *
 * 合同存在性 gate：检查包含 sprints/<dir>/ 变更的 PR 是否带有 contract-draft.md。
 * 防止合同未随 PR 进 main，导致 report 归档缺源。
 *
 * 用法：
 *   node contract-existence-check.mjs --root <repo_root> --files <file1> [file2 ...]
 *
 * 选项：
 *   --root   仓库根目录（默认：从脚本位置向上推算）
 *   --files  变更文件列表（相对于 root 的路径）
 *
 * 退出码：
 *   0 — 所有含 sprints/<dir>/ 变更的目录都存在 contract-draft.md
 *   1 — 至少一个 sprint 目录缺 contract-draft.md
 */

import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 默认仓库根：packages/brain/scripts/ci/ → 4 层 up
const DEFAULT_REPO_ROOT = resolve(__dirname, '../../../..');

// ── 解析参数 ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

let repoRoot = DEFAULT_REPO_ROOT;
let changedFiles = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1]) {
    repoRoot = args[++i];
  } else if (args[i] === '--files') {
    changedFiles = args.slice(i + 1);
    break;
  }
}

if (changedFiles.length === 0) {
  process.stderr.write(
    'Usage: contract-existence-check.mjs [--root <dir>] --files <file1> [file2 ...]\n' +
      'Error: --files parameter is required\n',
  );
  process.exit(1);
}

// ── 提取涉及的 sprint 目录 ─────────────────────────────────────────────────
// 匹配 sprints/<dir>/ 或 sprints/<dir>（后面有更多路径部分）
const SPRINT_RE = /^sprints\/([^/]+)\//;

const sprintDirs = new Set();
for (const f of changedFiles) {
  const normalized = f.replace(/^\.\//, '');
  const m = normalized.match(SPRINT_RE);
  if (m) {
    sprintDirs.add(m[1]);
  }
}

if (sprintDirs.size === 0) {
  // 没有 sprint 目录变更 → 通过（不是 sprint PR）
  process.exit(0);
}

// ── 检查每个 sprint 目录的 contract-draft.md ──────────────────────────────
let hasFailure = false;

for (const dir of sprintDirs) {
  const contractPath = join(repoRoot, 'sprints', dir, 'contract-draft.md');
  if (!existsSync(contractPath)) {
    process.stderr.write(
      `FAIL: sprints/${dir}/ 缺少 contract-draft.md（合同存在性 gate）\n` +
        `  期望路径: ${contractPath}\n` +
        `  请将 contract-draft.md 随同 PR 一起提交，否则 report 归档无源。\n`,
    );
    hasFailure = true;
  }
}

if (hasFailure) {
  process.exit(1);
}

process.stdout.write('OK: 所有 sprint 目录均含 contract-draft.md\n');
process.exit(0);
