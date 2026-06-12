#!/usr/bin/env node
/**
 * contract-existence-check.mjs
 *
 * 合同存在性检查：读取 diff fixture 文件（每行一个变更路径），
 * 若有 sprints/ 目录变更但缺少 contract-draft.md，非零退出并指明缺失路径。
 *
 * 用法：
 *   node packages/brain/scripts/ci/contract-existence-check.mjs --diff-fixture <file>
 *
 * 退出码：
 *   0 — 无 sprint 变更，或 sprint 变更包含 contract-draft.md
 *   1 — sprint 目录有变更但缺 contract-draft.md
 */

import { readFileSync } from 'fs';

function parseArgs(argv) {
  let diffFixture = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--diff-fixture' && argv[i + 1]) {
      diffFixture = argv[++i];
    }
  }
  return { diffFixture };
}

const { diffFixture } = parseArgs(process.argv);

if (!diffFixture) {
  console.error('ERROR: --diff-fixture <file> 参数必须提供');
  process.exit(1);
}

let content;
try {
  content = readFileSync(diffFixture, 'utf8');
} catch (err) {
  console.error(`ERROR: 无法读取 diff fixture 文件 ${diffFixture}: ${err.message}`);
  process.exit(1);
}

const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

// 收集所有涉及 sprints/ 的目录（形如 sprints/<sprint-id>/）
const sprintDirs = new Set();
for (const line of lines) {
  const m = line.match(/^(sprints\/[^/]+)\//);
  if (m) {
    sprintDirs.add(m[1]);
  }
}

// 若无 sprint 目录变更，直接通过
if (sprintDirs.size === 0) {
  process.exit(0);
}

// 检查每个 sprint 目录是否有 contract-draft.md
const missing = [];
for (const sprintDir of sprintDirs) {
  const contractPath = `${sprintDir}/contract-draft.md`;
  if (!lines.some(l => l === contractPath || l.startsWith(contractPath))) {
    missing.push(contractPath);
  }
}

if (missing.length > 0) {
  for (const p of missing) {
    console.error(`MISSING contract-draft.md: ${p}`);
  }
  process.exit(1);
}

process.exit(0);
