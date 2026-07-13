#!/usr/bin/env bash
# Smoke: line-dreaming.js — L1 line 级夜间蒸馏 job 真环境验证
# 验证：文件存在+语法OK、导出符号齐全、scheduler-jobs 已注册且排在 battle-report 前、
#       三个 L3 消费方（diary/arch_review/strategy_session）已接线 line_ledger 数据源
set -euo pipefail

echo "[line-dreaming-smoke] 1. 文件存在 + 语法 OK"
node --check packages/brain/src/line-dreaming.js
node --check packages/brain/src/scheduler-jobs.js
node --check packages/brain/src/diary-scheduler.js
node --check packages/brain/src/daily-review-scheduler.js
node --check packages/brain/src/active-goals-zero-trigger.js
echo "[line-dreaming-smoke] 五文件 node --check 通过 ✓"

echo "[line-dreaming-smoke] 2. line-dreaming.js 导出符号齐全"
node -e "
import('./packages/brain/src/line-dreaming.js').then(m => {
  for (const fn of [
    'isInLineDreamingWindow','alreadyDreamedToday','getActiveJourneys',
    'buildLineDreamData','renderLineLedgerMarkdown',
    'upsertLineLedger','generateLineLedger','maybeRunLineDreaming',
  ]) {
    if (typeof m[fn] !== 'function') { console.error('FAIL: '+fn+' 未导出'); process.exit(1); }
  }
  console.log('line-dreaming.js 导出齐全 ✓');
});
"

echo "[line-dreaming-smoke] 3. 窗口判断：UTC 21:00-21:04 = true，21:05 = false"
node -e "
import('./packages/brain/src/line-dreaming.js').then(m => {
  const inWindow = m.isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 0)));
  const outWindow = m.isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 5)));
  if (inWindow !== true) { console.error('FAIL: UTC 21:00 应为窗口内'); process.exit(1); }
  if (outWindow !== false) { console.error('FAIL: UTC 21:05 应为窗口外'); process.exit(1); }
  console.log('窗口判断正确 ✓');
});
"

echo "[line-dreaming-smoke] 4. scheduler-jobs.js 已注册 line-dreaming，排在 battle-report 之前"
node -e "
import('./packages/brain/src/scheduler-jobs.js').then(m => {
  const dreamIdx = m.JOBS.findIndex(j => j.name === 'line-dreaming');
  const reportIdx = m.JOBS.findIndex(j => j.name === 'battle-report');
  if (dreamIdx < 0) { console.error('FAIL: JOBS 里没有 line-dreaming'); process.exit(1); }
  if (reportIdx < 0) { console.error('FAIL: JOBS 里没有 battle-report'); process.exit(1); }
  if (dreamIdx >= reportIdx) { console.error('FAIL: line-dreaming 未排在 battle-report 之前'); process.exit(1); }
  console.log('scheduler-jobs 注册顺序正确 ✓');
});
"

echo "[line-dreaming-smoke] 5. 三个 L3 消费方已接线 line_ledger 数据源（源码扫描）"
node -e "
const fs = require('fs');

const diary = fs.readFileSync('packages/brain/src/diary-scheduler.js', 'utf8');
if (!diary.includes('fetchLineLedgersSummary')) {
  console.error('FAIL: diary-scheduler 未接线 fetchLineLedgersSummary'); process.exit(1);
}

const archReview = fs.readFileSync('packages/brain/src/daily-review-scheduler.js', 'utf8');
if (!archReview.includes('fetchAllLineLedgersDigest')) {
  console.error('FAIL: daily-review-scheduler(triggerArchReview) 未接线 fetchAllLineLedgersDigest'); process.exit(1);
}

const strategySession = fs.readFileSync('packages/brain/src/active-goals-zero-trigger.js', 'utf8');
if (!strategySession.includes('fetchAllLineLedgersDigest') || !strategySession.includes('line_context')) {
  console.error('FAIL: active-goals-zero-trigger(maybeTriggerStrategySession) 未接线 line_context'); process.exit(1);
}

console.log('三个 L3 消费方已接线 line_ledger ✓');
"

echo "[line-dreaming-smoke] 6. design_docs migration 328 已加 line_ledger 白名单"
node -e "
const fs = require('fs');
const mig = fs.readFileSync('packages/brain/migrations/328_design_docs_line_ledger.sql', 'utf8');
if (!mig.includes(\"'line_ledger'\")) { console.error('FAIL: migration 328 未含 line_ledger'); process.exit(1); }
if (!mig.includes('journey_id')) { console.error('FAIL: migration 328 未加 journey_id 列'); process.exit(1); }
console.log('migration 328 内容符合预期 ✓');
"

echo "[line-dreaming-smoke] 全部检查通过 ✓"
