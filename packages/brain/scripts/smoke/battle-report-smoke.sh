#!/usr/bin/env bash
# Smoke: battle-report — 每日作战日报骨架（relay-baton4 item3）
# 验证：
#   1. src/battle-report.js 导出六函数
#   2. scheduler-jobs.js 已注册 battle-report job
#   3. migrations/316_design_docs_battle_report.sql 白名单含 battle_report
#   4. selfcheck.js EXPECTED_SCHEMA_VERSION >= 316（地板语义：后续 migration 会继续推进）
set -euo pipefail

echo "[battle-report-smoke] 1. battle-report.js 导出六函数"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/battle-report.js', 'utf8');
const fns = [
  'isInBattleReportWindow',
  'alreadyGeneratedToday',
  'buildBattleReportData',
  'renderBattleReportMarkdown',
  'generateBattleReport',
  'maybeGenerateBattleReport',
];
const missing = fns.filter((f) => !new RegExp('export\\\\s+(async\\\\s+)?function\\\\s+' + f + '\\\\b').test(src));
if (missing.length) { missing.forEach((f) => console.error('缺少导出: ' + f)); process.exit(1); }
console.log('battle-report.js 六函数导出齐全 ✓');
"

echo "[battle-report-smoke] 2. scheduler-jobs.js 注册 battle-report"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!/^\s*\{\s*name:\s*'battle-report'/m.test(src)) {
  console.error('FAIL: scheduler-jobs.js 缺少 battle-report job 注册（或被注释）');
  process.exit(1);
}
if (!src.includes('maybeGenerateBattleReport')) {
  console.error('FAIL: scheduler-jobs.js 未接 maybeGenerateBattleReport handler');
  process.exit(1);
}
console.log('scheduler-jobs.js battle-report 注册正确 ✓');
"

echo "[battle-report-smoke] 3. migration 316 白名单含 battle_report"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/migrations/316_design_docs_battle_report.sql', 'utf8');
if (!src.includes(\"'battle_report'\")) {
  console.error('FAIL: migration 316 白名单缺 battle_report');
  process.exit(1);
}
if (!src.includes('design_docs_type_check')) {
  console.error('FAIL: migration 316 未操作 design_docs_type_check 约束');
  process.exit(1);
}
console.log('migration 316 白名单正确 ✓');
"

echo "[battle-report-smoke] 4. selfcheck EXPECTED_SCHEMA_VERSION >= 316"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/selfcheck.js', 'utf8');
const m = src.match(/EXPECTED_SCHEMA_VERSION\s*=\s*'(\d+)'/);
if (!m || parseInt(m[1], 10) < 316) {
  console.error('FAIL: selfcheck.js EXPECTED_SCHEMA_VERSION 低于 316（地板不得回退）');
  process.exit(1);
}
console.log('selfcheck 地板 >= 316 正确 ✓');
"

echo "[battle-report-smoke] ✅ 全部通过"
