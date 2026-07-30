#!/usr/bin/env bash
# Smoke: relay-verdict-writeback — PATCH relay-runs 接住 verdict/cost/evaluate_verdict
# 验证（结构断言，repo 根目录执行）：
#   1. route 完成归一并委托 exact-run store；store 含三列 COALESCE 写入
#   2. best-effort 归一化存在（normVerdict + warnings），且归一化块不含 400 拒绝
#      （铁律：非法 verdict/cost 绝不 400，否则打回 phase=done 终态 → watchdog 重点火）
#   3. 回归测试文件在位（永久守卫）
set -euo pipefail

echo "[relay-verdict-writeback-smoke] 1. exact-run PATCH 三列写入结构"
node -e "
const fs = require('fs');
const route = fs.readFileSync('packages/brain/src/routes/initiatives.js', 'utf8');
const store = fs.readFileSync('packages/brain/src/orchestrator/kernel-run-store.js', 'utf8');
const checks = [
  [route, 'patchKernelRunById(requestPool', 'route 委托 exact-run store'],
  [route, 'normVerdict', '归一化辅助存在'],
  [route, 'warnings.push', '非法值 warnings 聚合'],
  [store, 'evaluate_verdict = COALESCE', 'evaluate_verdict COALESCE 写入'],
  [store, 'judge_verdict = COALESCE', 'judge_verdict COALESCE 写入'],
  [store, 'cost_usd = COALESCE', 'cost_usd COALESCE 写入'],
];
const missing = checks.filter(([src,p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: exact-run 回写链缺少:');
  missing.forEach(([, ,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('exact-run 委托 + 三列写入 + 归一化结构 ✓');
"

echo "[relay-verdict-writeback-smoke] 2. 归一化块无 400 拒绝（防 watchdog 重点火铁律）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/initiatives.js', 'utf8');
const start = src.indexOf('function parseVerdictCostFields');
const end = src.indexOf('return { warnings', start);
if (start < 0 || end < 0) { console.error('FAIL: 找不到 parseVerdictCostFields 函数体'); process.exit(1); }
const block = src.slice(start, end);
if (block.includes('status(400)')) {
  console.error('FAIL: 归一化块出现 400 拒绝——违反 BLOCKER-1 铁律（会打回 phase=done 终态写入）');
  process.exit(1);
}
console.log('归一化块无 400 ✓');
"

echo "[relay-verdict-writeback-smoke] 3. 回归测试文件在位"
test -f packages/brain/src/__tests__/relay-runs-verdict-writeback.test.js || { echo "FAIL: 回归测试缺失"; exit 1; }
echo "回归测试在位 ✓"

echo "[relay-verdict-writeback-smoke] PASS"
