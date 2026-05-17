#!/usr/bin/env bash
# Smoke: insight-as-constraint — 把 cortex_insight 转化成 dispatch 阶段的硬规则
# 验证：
#   1. Brain 健康
#   2. migration 263_dispatch_constraint.sql 存在且含 dispatch_constraint 列
#   3. insight-constraints.js 导出 loadActiveConstraints / evaluateConstraints / isValidConstraint
#   4. pre-flight-check.js 已 import insight-constraints（Check 6 集成完成）
#   5. selfcheck.js EXPECTED_SCHEMA_VERSION = '263'
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[insight-constraint-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.status||'unknown')")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
  echo "[insight-constraint-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[insight-constraint-smoke] Brain 健康 ✓"

echo "[insight-constraint-smoke] 2. 验证 migration 263 存在且含 dispatch_constraint 列"
node -e "
const fs = require('fs');
if (!fs.existsSync('packages/brain/migrations/263_dispatch_constraint.sql')) {
  console.error('FAIL: migration 263_dispatch_constraint.sql 不存在'); process.exit(1);
}
const sql = fs.readFileSync('packages/brain/migrations/263_dispatch_constraint.sql', 'utf8');
if (!sql.includes('dispatch_constraint')) {
  console.error('FAIL: migration 缺少 dispatch_constraint 列'); process.exit(1);
}
if (!sql.match(/learnings/i)) {
  console.error('FAIL: migration 未引用 learnings 表'); process.exit(1);
}
console.log('migration 263 含 learnings.dispatch_constraint ✓');
"

echo "[insight-constraint-smoke] 3. 验证 insight-constraints.js 导出三函数"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/insight-constraints.js', 'utf8');
const required = ['loadActiveConstraints', 'evaluateConstraints', 'isValidConstraint'];
const missing = required.filter(fn => !src.match(new RegExp('export[^\\\\n]+' + fn)));
if (missing.length > 0) { console.error('FAIL: insight-constraints.js 缺少 export:', missing.join(', ')); process.exit(1); }
console.log('insight-constraints.js 含所有 export ✓');
"

echo "[insight-constraint-smoke] 4. 验证 pre-flight-check.js 已集成 insight-constraints"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/pre-flight-check.js', 'utf8');
if (!src.includes(\"from './insight-constraints.js'\")) {
  console.error('FAIL: pre-flight-check.js 未 import insight-constraints'); process.exit(1);
}
if (!src.includes('loadActiveConstraints') || !src.includes('evaluateConstraints')) {
  console.error('FAIL: pre-flight-check.js 未调用 loadActiveConstraints/evaluateConstraints'); process.exit(1);
}
console.log('pre-flight-check.js Check 6 已集成 ✓');
"

echo "[insight-constraint-smoke] 5. 验证 selfcheck.js EXPECTED_SCHEMA_VERSION 已升至 263"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/selfcheck.js', 'utf8');
const m = src.match(/EXPECTED_SCHEMA_VERSION\s*=\s*'(\d+)'/);
if (!m) { console.error('FAIL: 未找到 EXPECTED_SCHEMA_VERSION'); process.exit(1); }
if (parseInt(m[1]) < 263) {
  console.error('FAIL: EXPECTED_SCHEMA_VERSION = ' + m[1] + ' 未升至 ≥263'); process.exit(1);
}
console.log('selfcheck EXPECTED_SCHEMA_VERSION = ' + m[1] + ' ✓');
"

echo "[insight-constraint-smoke] 全部检查通过 ✓"
