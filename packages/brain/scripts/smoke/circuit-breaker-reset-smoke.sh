#!/usr/bin/env bash
# Smoke: circuit-breaker-reset — W7.2 Bug #D 一键重置 API
# 验证：
#   1. Brain /health 健康（前置）
#   2. circuit-breaker.js 含 resetBreaker async 函数 + INSERT...ON CONFLICT UPDATE 语句
#   3. routes/goals.js 路由 POST /circuit-breaker/:key/reset 已接 resetBreaker
#   4. POST /api/brain/circuit-breaker/cb-smoke-reset/reset → 200 + state.state == 'CLOSED'
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[cb-reset-smoke] 1. Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.status||'unknown')")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
  echo "[cb-reset-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[cb-reset-smoke] Brain 健康 ✓"

echo "[cb-reset-smoke] 2. circuit-breaker.js 含 resetBreaker 与 UPDATE→CLOSED SQL"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/circuit-breaker.js', 'utf8');
const checks = [
  ['async function resetBreaker', 'resetBreaker async 函数定义'],
  [\"state           = 'CLOSED'\", 'UPDATE 显式置 state CLOSED'],
  ['failures        = 0', 'UPDATE 清零 failures'],
  ['ON CONFLICT (key) DO UPDATE', 'UPSERT 语义'],
  ['resetBreaker,', 'export resetBreaker'],
];
const missing = checks.filter(([p,_]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: circuit-breaker.js 缺少:');
  missing.forEach(([_,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('circuit-breaker.js 含 resetBreaker + UPSERT→CLOSED ✓');
"

echo "[cb-reset-smoke] 3. routes/goals.js 路由已接 resetBreaker async"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/goals.js', 'utf8');
const checks = [
  ['resetBreaker as resetCBBreaker', '导入 resetBreaker'],
  ['/circuit-breaker/:key/reset', '路由路径'],
  ['await resetCBBreaker(req.params.key)', 'route handler 调 resetBreaker'],
];
const missing = checks.filter(([p,_]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: routes/goals.js 缺少:');
  missing.forEach(([_,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('routes/goals.js 已接 async resetBreaker ✓');
"

echo "[cb-reset-smoke] 4. 真实调 POST /circuit-breaker/cb-smoke-reset/reset"
KEY="cb-smoke-reset-$(date +%s)"
RES=$(curl -sf -X POST "${BRAIN_URL}/api/brain/circuit-breaker/${KEY}/reset")
SUCCESS=$(echo "$RES" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.success===true)")
STATE=$(echo "$RES" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log((d.state&&d.state.state)||'')")
if [[ "$SUCCESS" != "true" ]]; then
  echo "[cb-reset-smoke] FAIL: API 返回 success != true: $RES"
  exit 1
fi
if [[ "$STATE" != "CLOSED" ]]; then
  echo "[cb-reset-smoke] FAIL: state.state != CLOSED: $RES"
  exit 1
fi
echo "[cb-reset-smoke] POST /reset 返回 success + state=CLOSED ✓"

echo "[cb-reset-smoke] 全部检查通过 ✓"
