#!/usr/bin/env bash
# Smoke: 九要素 T4 — 回执 collector
# 验证（纯读源码，CI 兼容不连库）：
#   1. receipt-collector.js 四导出 + 超时核销 SQL + 防环（不 import notifier/alerting）
#   2. 三入口接线：notifier / feishu-alert / ops.js deploy 都出现回执调用
#   3. scheduler-jobs 注册 receipt-collector job
#   4. battle-report 含未确认动作段
set -euo pipefail

echo "[t4-receipt-collector-smoke] 1. receipt-collector.js 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/receipt-collector.js', 'utf8');
const checks = [
  ['export async function recordActionReceipt', 'record 导出'],
  ['export async function resolveActionReceipt', 'resolve 导出'],
  ['export async function runReceiptCollector', 'tick 导出'],
  ['export async function getUnconfirmedReceipts', '未确认查询导出'],
  [\"SET receipt_status = 'timeout'\", '超时核销 SQL'],
  ['make_interval(mins =>', '超时阈值参数化'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { console.error('FAIL:'); missing.forEach(([,d]) => console.error('  - ' + d)); process.exit(1); }
if (/from '\.\/notifier\.js'|from '\.\/alerting\.js'/.test(src)) {
  console.error('FAIL: receipt-collector 不得 import notifier/alerting（防循环）'); process.exit(1);
}
console.log('receipt-collector.js 结构正确 ✓');
"

echo "[t4-receipt-collector-smoke] 2. 三入口接线"
node -e "
const fs = require('fs');
const entries = [
  ['packages/brain/src/notifier.js', ['recordActionReceipt', 'resolveActionReceipt']],
  ['packages/brain/src/feishu-alert.js', ['recordActionReceipt', 'skill_eval_webhook']],
  ['packages/brain/src/routes/ops.js', ['recordActionReceipt', \"target: 'production'\", \"target: 'staging'\"]],
];
for (const [file, needles] of entries) {
  const src = fs.readFileSync(file, 'utf8');
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length) { console.error('FAIL: ' + file + ' 缺少: ' + missing.join(', ')); process.exit(1); }
}
console.log('三入口接线正确 ✓');
"

echo "[t4-receipt-collector-smoke] 3. scheduler-jobs 注册"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!src.includes(\"name: 'receipt-collector'\") || !src.includes('runReceiptCollector')) {
  console.error('FAIL: scheduler-jobs 未注册 receipt-collector'); process.exit(1);
}
console.log('scheduler-jobs 注册正确 ✓');
"

echo "[t4-receipt-collector-smoke] 4. battle-report 未确认动作段"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/battle-report.js', 'utf8');
if (!src.includes('未确认动作（24h）') || !src.includes('getUnconfirmedReceipts')) {
  console.error('FAIL: battle-report 缺未确认动作段'); process.exit(1);
}
console.log('battle-report 未确认动作段正确 ✓');
"

echo "[t4-receipt-collector-smoke] ALL PASS ✓"
