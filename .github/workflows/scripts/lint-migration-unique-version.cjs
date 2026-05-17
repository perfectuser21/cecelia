#!/usr/bin/env node
// lint-migration-unique-version.cjs — 拦 migration 同号事故重现
//
// 教训样本（W7.4 / 2026-05）：
//   264_failure_type_dispatch_constraint.sql 与 264_fix_progress_ledger_unique.sql
//   同号 commit 进 main，Brain 启动按字母序只跑了第一个，第二个被静默跳过 →
//   schema drift（progress_ledger 缺 UNIQUE 约束），生产端被坑半天才发现。
//
// 规则：
//   扫 packages/brain/migrations/*.sql，提取首数字前缀（^\d+），按前缀分组；
//   任一前缀对应 ≥ 2 个文件即 exit 1，列出所有冲突文件。
//   无数字前缀的文件（README 等）被忽略。
//
// 用法：
//   node .github/workflows/scripts/lint-migration-unique-version.cjs [DIR]
//   DIR 默认 packages/brain/migrations（相对 cwd）
//
// 退出码：0 = 全部唯一，1 = 发现同号

const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'packages/brain/migrations';

if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`::error::lint-migration-unique-version 目录不存在: ${dir}`);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
const byVersion = new Map();

for (const f of files) {
  const m = f.match(/^(\d+)/);
  if (!m) continue;
  const v = m[1];
  if (!byVersion.has(v)) byVersion.set(v, []);
  byVersion.get(v).push(f);
}

const dups = [...byVersion.entries()]
  .filter(([, group]) => group.length > 1)
  .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

if (dups.length === 0) {
  console.log(
    `✅ lint-migration-unique-version 通过（${files.length} 个 migration，前缀全部唯一）`
  );
  process.exit(0);
}

console.error('::error::lint-migration-unique-version 失败 — 发现 migration 同号');
console.error('');
for (const [v, group] of dups) {
  console.error(`  ❌ 版本 ${v}（${group.length} 个文件冲突）：`);
  for (const f of group.sort()) console.error(`     - ${path.join(dir, f)}`);
}
console.error('');
console.error('  说明：migration 文件首数字前缀必须唯一 — 同号 Brain 启动按字母序只会跑第一个，');
console.error('        第二个被静默跳过 → 生产 schema drift。');
console.error('  修复：把后改的那个 rename 成下一个空号（参考 W7.4 / 2026-05 事故 RCA）。');
process.exit(1);
