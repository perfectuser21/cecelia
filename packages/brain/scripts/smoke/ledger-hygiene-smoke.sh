#!/usr/bin/env bash
# Smoke: ledger-hygiene — 账本保鲜守卫（九要素 T1）
# 验证：
#   1. ledger-hygiene.js 存在且含必要导出 + 5 指标 SQL 关键结构
#   2. scheduler-jobs.js 已注册 ledger-hygiene job
#   3. migration 330 已加 ledger_hygiene 类型
set -euo pipefail

echo "[ledger-hygiene-smoke] 1. ledger-hygiene.js 存在且含必要导出"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/ledger-hygiene.js', 'utf8');
const checks = [
  ['export function isInLedgerHygieneWindow', '窗口 gate 导出'],
  ['export async function computeMetrics', 'computeMetrics 导出'],
  ['export function evaluateRatchet', 'evaluateRatchet 导出'],
  ['export async function maybeRunLedgerHygiene', '主入口导出'],
  ['ledger_hygiene_ratchet', '棘轮状态 working_memory key'],
  ['golden_path gp', 'm1 FR 沉淀率查 golden_path'],
  ['review_after < NOW()', 'm4 知识保质期'],
  [\"category = 'judgment'\", 'm5 判定点活性'],
  ['[ledger-hygiene]', 'issue 标题前缀'],
  ['sendBark', '连续击穿 Bark 升级'],
  [\"'ledger_hygiene'\", 'design_docs 落库类型'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: ledger-hygiene.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('ledger-hygiene.js 结构正确 ✓');
"

echo "[ledger-hygiene-smoke] 2. scheduler-jobs.js 已注册 ledger-hygiene job"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!src.includes(\"name: 'ledger-hygiene'\") || !src.includes('maybeRunLedgerHygiene')) {
  console.error('FAIL: scheduler-jobs.js 未注册 ledger-hygiene');
  process.exit(1);
}
console.log('scheduler-jobs.js 已注册 ledger-hygiene ✓');
"

echo "[ledger-hygiene-smoke] 3. migration 330 已加 ledger_hygiene 类型"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/migrations/330_design_docs_ledger_hygiene.sql', 'utf8');
if (!src.includes(\"'ledger_hygiene'\") || !src.includes('design_docs_type_check')) {
  console.error('FAIL: migration 330 缺 ledger_hygiene CHECK 值');
  process.exit(1);
}
console.log('migration 330 正确 ✓');
"

echo "[ledger-hygiene-smoke] 全部检查通过 ✓"
