#!/usr/bin/env bash
# Smoke: capture-triage scope 分诊 — GP loop T5（修订 57d296a1）
# 验证：
#   1. capture-triage.js 含 classifyScope/SCOPES/routeCapability/resolveScope 关键结构
#   2. capability 路写 golden_paths(candidate, capture_triage) 且带幂等锚
#   3. repair 路 [自动派工] 前缀未被改动（晨报 T6 查询口径）
#   4. LLM prompt 已扩展 scope 字段
set -euo pipefail

echo "[capture-triage-scope-smoke] 1. scope 分诊关键结构存在"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/capture-triage.js', 'utf8');
const checks = [
  ['export function classifyScope', 'classifyScope 导出'],
  [\"export const SCOPES = ['repair', 'capability']\", 'SCOPES 导出'],
  ['async function routeCapability', 'routeCapability 函数'],
  ['function resolveScope', 'resolveScope 函数'],
  ['新方向|新能力|新平台', 'capability 关键词正则'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: capture-triage.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('scope 分诊结构正确 ✓');
"

echo "[capture-triage-scope-smoke] 2. capability 路写 golden_paths(candidate) 带幂等锚"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/capture-triage.js', 'utf8');
const checks = [
  ['INSERT INTO golden_paths', 'golden_paths INSERT'],
  [\"'candidate','capture_triage'\", 'candidate + capture_triage 字面量'],
  ['capture-triage atom:', 'status_reason 幂等锚'],
  [\"source = 'capture_triage' AND status_reason LIKE\", '幂等 SELECT 带 source 限定'],
  ['[triage:capability]', 'atom capability 标记'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: capability 路缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('capability 路结构正确 ✓');
"

echo "[capture-triage-scope-smoke] 3. repair 路 [自动派工] 前缀未被改动"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/capture-triage.js', 'utf8');
if (!src.includes('[自动派工]')) {
  console.error('FAIL: [自动派工] title 前缀丢失（晨报 T6 查询口径依赖 title LIKE）');
  process.exit(1);
}
console.log('[自动派工] 前缀保留 ✓');
"

echo "[capture-triage-scope-smoke] 4. LLM prompt 已扩展 scope 字段"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/capture-triage.js', 'utf8');
if (!src.includes('\"scope\":\"repair|capability\"')) {
  console.error('FAIL: TRIAGE_LLM_PROMPT 未含 scope 字段要求');
  process.exit(1);
}
console.log('LLM prompt scope 扩展 ✓');
"

echo "[capture-triage-scope-smoke] ✅ 全部通过"
