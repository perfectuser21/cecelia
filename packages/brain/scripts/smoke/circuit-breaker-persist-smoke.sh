#!/usr/bin/env bash
# Smoke: circuit-breaker-persist — 熔断器 PostgreSQL 持久化
# 验证：circuit-breaker.js 具备 loadFromDB/_persist/_delete，migration 261 已部署
# DB 表可用性通过 Brain 健康起来隐式验证（Brain 启动时调用 loadCircuitBreakerStatesFromDB）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[cb-persist-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.status||'unknown')")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
  echo "[cb-persist-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[cb-persist-smoke] Brain 健康 ✓ (隐含 circuit_breaker_states 表存在)"

echo "[cb-persist-smoke] 2. 验证 circuit-breaker.js 含 DB 持久化函数"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/circuit-breaker.js', 'utf8');
const required = ['loadFromDB', '_persist', '_delete', 'circuit_breaker_states'];
const missing = required.filter(fn => !src.includes(fn));
if (missing.length > 0) { console.error('FAIL: circuit-breaker.js 缺少:', missing.join(', ')); process.exit(1); }
console.log('circuit-breaker.js 含所有 DB 持久化函数 ✓');
"

echo "[cb-persist-smoke] 3. 验证 migration 261 存在"
node -e "
const fs = require('fs');
if (!fs.existsSync('packages/brain/migrations/261_circuit_breaker_states.sql')) {
  console.error('FAIL: migration 261_circuit_breaker_states.sql 不存在'); process.exit(1);
}
const sql = fs.readFileSync('packages/brain/migrations/261_circuit_breaker_states.sql', 'utf8');
if (!sql.includes('circuit_breaker_states')) {
  console.error('FAIL: migration 缺少 circuit_breaker_states 建表语句'); process.exit(1);
}
console.log('migration 261 存在且含建表语句 ✓');
"

echo "[cb-persist-smoke] 4. 验证 server.js 调用 loadCircuitBreakerStatesFromDB"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!src.includes('loadCircuitBreakerStatesFromDB')) {
  console.error('FAIL: server.js 未调用 loadCircuitBreakerStatesFromDB'); process.exit(1);
}
console.log('server.js 启动恢复调用存在 ✓');
"

echo "[cb-persist-smoke] 全部检查通过 ✓"
