#!/usr/bin/env bash
# Smoke: decisions-dedup — 九要素 T8
# 验证：
#   1. decision.js generateDecision 含写入去重（jsonb 语义比较 + 排除已执行记录）
#   2. migration 330 存在且 DELETE 带三重限定条件
#   3. 去重 regression test 在 repo 中永久存在
set -euo pipefail

echo "[decisions-dedup-smoke] 1. decision.js 含写入去重逻辑"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/decision.js', 'utf8');
const checks = [
  ['actions = \$2::jsonb AND context = \$3::jsonb', 'jsonb 语义相等比较'],
  ['executed_at IS NULL', '排除已执行记录（保 tick 重试链）'],
  ['ORDER BY created_at DESC, id DESC', 'tie-break 排序'],
  ['deduped: true', '去重早退返回标记'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: decision.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('decision.js 去重逻辑完整 ✓');
"

echo "[decisions-dedup-smoke] 2. migration 330 存在且带三重限定条件"
node -e "
const fs = require('fs');
const sql = fs.readFileSync('packages/brain/migrations/330_decisions_blank_cleanup.sql', 'utf8');
const checks = [
  [\"(topic IS NULL OR topic = '')\", 'topic 空条件'],
  [\"(decision IS NULL OR decision = '')\", 'decision 空条件'],
  [\"trigger IN ('tick', 'consciousness_loop')\", 'trigger 白名单'],
];
const missing = checks.filter(([p]) => !sql.includes(p));
if (missing.length > 0) {
  console.error('FAIL: migration 330 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('migration 330 三重条件完整 ✓');
"

echo "[decisions-dedup-smoke] 3. regression test 永久存在"
node -e "
const fs = require('fs');
if (!fs.existsSync('packages/brain/src/__tests__/decision-dedup.test.js')) {
  console.error('FAIL: decision-dedup.test.js 不存在（regression test 被删）');
  process.exit(1);
}
console.log('decision-dedup.test.js 存在 ✓');
"

echo "[decisions-dedup-smoke] ✅ 全部通过"
