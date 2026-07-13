#!/usr/bin/env bash
# Smoke: warroom-readonly-api — relay-baton4 item1
# 验证：
#   1. routes/handoffs.js 存在且为只读摘要路由（result.handoff 倒序 + artifacts.pr_urls 提取）
#   2. routes/sentinel.js 存在且哨兵键前缀与 scheduler-jobs.js 字面量一致
#   3. src/routes.js 已挂载两个新路由
set -euo pipefail

echo "[warroom-readonly-api-smoke] 1. handoffs.js 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/handoffs.js', 'utf8');
const checks = [
  [\"result ? 'handoff'\", '只取带 handoff 的 tasks'],
  [\"(result->'handoff'->>'created_at') DESC\", '按交接单时间倒序'],
  ['artifacts?.pr_urls', 'pr_urls 从 artifacts 提取'],
  [\"payload->>'journey_id'\", 'journey_id 过滤有 payload 兜底'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('缺少: ' + d)); process.exit(1); }
if (/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i.test(src)) { console.error('FAIL: 出现写语句，违反只读约束'); process.exit(1); }
console.log('handoffs.js 结构正确 ✓');
"

echo "[warroom-readonly-api-smoke] 2. sentinel.js 结构 + 键前缀同步"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/sentinel.js', 'utf8');
const sched = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
const m = src.match(/KEY_PREFIX = '([^']+)'/);
if (!m) { console.error('FAIL: sentinel.js 未定义 KEY_PREFIX'); process.exit(1); }
if (!sched.includes(\"'\" + m[1] + \"'\")) { console.error('FAIL: KEY_PREFIX 与 scheduler-jobs.js 不一致'); process.exit(1); }
const checks = [
  ['scheduler_jobs_expected', '读 expected 键'],
  ['EXTRACT(EPOCH FROM', 'age 由 SQL 计算'],
  ['STALE_SECONDS', '过期阈值常量'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('缺少: ' + d)); process.exit(1); }
if (/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i.test(src)) { console.error('FAIL: 出现写语句，违反只读约束'); process.exit(1); }
console.log('sentinel.js 结构正确 ✓');
"

echo "[warroom-readonly-api-smoke] 3. routes.js 已挂载"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes.js', 'utf8');
const mounts = [
  [/^\s*router\.use\('\/handoffs', handoffsRouter\)/m, \"router.use('/handoffs', handoffsRouter)\"],
  [/^\s*router\.use\('\/sentinel', sentinelRouter\)/m, \"router.use('/sentinel', sentinelRouter)\"],
];
for (const [re, p] of mounts) {
  if (!re.test(src)) { console.error('FAIL: routes.js 缺少挂载（或被注释）: ' + p); process.exit(1); }
}
console.log('routes.js 挂载正确 ✓');
"

echo "[warroom-readonly-api-smoke] ✅ 全部通过"
