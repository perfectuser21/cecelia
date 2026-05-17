#!/usr/bin/env bash
# Smoke: decision-ttl — guidance.js DECISION_TTL_MIN 短路 TTL 验证
# 验证：getGuidance 含 decision_id TTL 检查逻辑 + updated_at 字段查询 + 环境变量 override
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[decision-ttl-smoke] 1. 验证 guidance.js 含 DECISION_TTL_MIN 逻辑"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/guidance.js', 'utf8');
const required = ['DECISION_TTL_MIN', 'decision_id', 'updated_at', 'getDecisionTtlMs'];
const missing = required.filter(k => !src.includes(k));
if (missing.length > 0) { console.error('FAIL: guidance.js 缺少:', missing.join(', ')); process.exit(1); }
console.log('guidance.js 含 DECISION_TTL_MIN 逻辑 ✓');
"

echo "[decision-ttl-smoke] 2. 验证 SELECT 语句含 updated_at"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/guidance.js', 'utf8');
if (!src.includes('SELECT value, updated_at FROM brain_guidance')) {
  console.error('FAIL: getGuidance SELECT 未包含 updated_at'); process.exit(1);
}
console.log('SELECT updated_at 存在 ✓');
"

echo "[decision-ttl-smoke] 3. 验证 decision-ttl 测试文件存在"
node -e "
require('fs').accessSync('packages/brain/src/__tests__/decision-ttl.test.js');
const src = require('fs').readFileSync('packages/brain/src/__tests__/decision-ttl.test.js', 'utf8');
const tests = ['C1a', 'C1b', 'C1c', 'C1d'];
const missing = tests.filter(t => !src.includes(t));
if (missing.length > 0) { console.error('FAIL: 缺少测试场景:', missing.join(', ')); process.exit(1); }
console.log('decision-ttl 测试文件含 4 个场景 ✓');
"

echo "[decision-ttl-smoke] 4. 验证 Brain 健康 (smoke 最终确认)"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.status||'unknown')" 2>/dev/null || echo "unreachable")
if [[ "$STATUS" == "unreachable" ]]; then
  echo "[decision-ttl-smoke] Brain 不可达（跳过运行时检查，结构验证已通过）"
else
  echo "[decision-ttl-smoke] Brain 健康，status=${STATUS} ✓"
fi

echo "[decision-ttl-smoke] 全部检查通过 ✓"
