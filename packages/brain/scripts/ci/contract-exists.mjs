#!/usr/bin/env node
// contract-exists.mjs
// 校验 harness PR 是否带 contract-draft.md。读 diff 清单 fixture（--fixture <file>）或 stdin。
//
// 规则：
//   - PR 改动了 sprints/（harness PR）但缺 contract-draft.md → 非零退出 + stderr 点名 contract-draft.md
//   - 改动了 sprints/ 且含 contract-draft.md → 退出 0
//   - 未改 sprints/（非 harness PR）/ 空 diff → 退出 0（不误拦）
//   - sprints/archive/ 下的归档老 sprint 不算 harness PR（不强制合同）
//
// diff 清单格式：兼容 `git diff --name-status`（status<TAB>path）与纯路径，每行一个文件。

import { readFileSync } from 'fs';

function parseArgs(argv) {
  const out = { fixture: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') out.fixture = argv[i + 1];
  }
  return out;
}

function extractPaths(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('#'))
    .map((l) => {
      // `git diff --name-status` 行形如 `A\tpath`；纯路径行直接取自身。统一取最后一个空白段。
      const parts = l.split(/\s+/);
      return parts[parts.length - 1];
    });
}

const { fixture } = parseArgs(process.argv.slice(2));
let raw;
try {
  raw = fixture ? readFileSync(fixture, 'utf8') : readFileSync(0, 'utf8');
} catch (e) {
  console.error(`contract-exists: 无法读取 diff 清单: ${fixture || '<stdin>'} (${e.message})`);
  process.exit(2);
}

const files = extractPaths(raw);
const touchesSprints = files.some(
  (f) => /(^|\/)sprints\//.test(f) && !f.includes('sprints/archive/'),
);

if (!touchesSprints) {
  console.log('contract-exists: ✅ 非 harness PR（无 sprints/ 改动），跳过合同存在性校验');
  process.exit(0);
}

const hasContract = files.some((f) => /(^|\/)contract-draft\.md$/.test(f));
if (!hasContract) {
  console.error(
    'contract-exists: ❌ FAIL — 该 PR 改动了 sprints/ 但缺少 contract-draft.md（harness PR 必须带合同）',
  );
  console.error('  缺失文件: contract-draft.md');
  process.exit(1);
}

console.log('contract-exists: ✅ OK — contract-draft.md 存在');
process.exit(0);
