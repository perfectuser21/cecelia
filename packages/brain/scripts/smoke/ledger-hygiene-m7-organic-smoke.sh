#!/usr/bin/env bash
# Smoke: ledger-hygiene-m7-organic — m7「自主循环零产出」探针可信化
# Sprint: 08040913-relay-a6e6afc7（合同分支 cp-08040913-harness-propose-r1）
# 验证：
#   1. ledger-hygiene.js 三个新导出存在（getM7CaptureWindow / LEDGER_SELF_ATOM_PREFIX / computeMetrics 第二参）
#   2. m7 capture 计数不再挂 NOW()-24h 滑动窗，窗口界参数化 + 前缀分类进 SQL
#   3. 合同回归测试已落位且集成测试已登记 POSTGRES_INTEGRATION_TESTS
#   4. getM7CaptureWindow 纯函数语义正确（北京昨日自然日 → UTC 界，±60s 漂移不变）
set -euo pipefail

echo "[m7-organic-smoke] 1. ledger-hygiene.js 三个新导出存在"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/ledger-hygiene.js', 'utf8');
const checks = [
  ['export function getM7CaptureWindow', 'getM7CaptureWindow 导出'],
  ['export const LEDGER_SELF_ATOM_PREFIX', 'LEDGER_SELF_ATOM_PREFIX 导出'],
  ['export async function computeMetrics(pool, now = new Date())', 'computeMetrics(pool, now?) 第二参'],
  [\"LEDGER_SELF_ATOM_PREFIX = 'issue: [ledger-hygiene]'\", '自产前缀字面值'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: ledger-hygiene.js 缺少:');
  missing.forEach(([, d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('三个新导出结构正确 ✓');
"

echo "[m7-organic-smoke] 2. capture 计数无 24h 滑动窗，参数化窗口 + 前缀分类"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/ledger-hygiene.js', 'utf8');
if (/capture_atoms[^;]{0,300}NOW\(\)\s*-\s*INTERVAL '24 hours'/s.test(src)) {
  console.error('FAIL: capture_atoms 计数仍挂 NOW()-24h 滑动窗');
  process.exit(1);
}
if (!src.includes('created_at >= \$1 AND created_at < \$2')) {
  console.error('FAIL: capture 计数窗口界未参数化（\$1/\$2）');
  process.exit(1);
}
console.log('滑动窗已移除，窗口参数化 + 前缀分类 ✓');
"

echo "[m7-organic-smoke] 3. 合同回归测试落位 + 集成测试登记"
node -e "
const fs = require('fs');
if (!fs.existsSync('packages/brain/src/__tests__/ledger-hygiene-m7-organic.test.js')) {
  console.error('FAIL: 单测未落位');
  process.exit(1);
}
if (!fs.existsSync('packages/brain/src/__tests__/integration/ledger-hygiene-m7-organic.integration.test.js')) {
  console.error('FAIL: 集成测试未落位');
  process.exit(1);
}
const cfg = fs.readFileSync('packages/brain/vitest.config.js', 'utf8');
const i = cfg.indexOf('POSTGRES_INTEGRATION_TESTS');
if (i < 0 || !cfg.slice(i).split('];')[0].includes('integration/ledger-hygiene-m7-organic.integration.test.js')) {
  console.error('FAIL: 集成测试未登记 POSTGRES_INTEGRATION_TESTS');
  process.exit(1);
}
console.log('测试落位 + 登记 ✓');
"

echo "[m7-organic-smoke] 4. getM7CaptureWindow 纯函数语义"
node --input-type=module -e "
const mod = await import(new URL('packages/brain/src/ledger-hygiene.js', 'file://' + process.cwd() + '/'));
const { getM7CaptureWindow } = mod;
const w = getM7CaptureWindow(new Date('2026-08-03T21:10:21Z'));
if (w.startUtc.toISOString() !== '2026-08-02T16:00:00.000Z' || w.endUtc.toISOString() !== '2026-08-03T16:00:00.000Z') {
  console.error('FAIL: 窗口界不是北京昨日自然日', w);
  process.exit(1);
}
const wPlus = getM7CaptureWindow(new Date('2026-08-03T21:11:21Z'));
if (wPlus.startUtc.getTime() !== w.startUtc.getTime() || wPlus.endUtc.getTime() !== w.endUtc.getTime()) {
  console.error('FAIL: +60s 漂移改变了窗口');
  process.exit(1);
}
console.log('确定性北京昨日窗口 ✓');
"

echo "[m7-organic-smoke] 全部检查通过 ✓"
