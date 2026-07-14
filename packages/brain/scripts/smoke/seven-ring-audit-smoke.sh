#!/usr/bin/env bash
# Smoke: seven-ring-audit 七环对账巡检扩容
# 验证：
#   1. KV 路由文件存在并含 GET/POST /:key 实现
#   2. working_memory 表引用正确（upsert 路径）
#   3. seven-ring-audit.js 含七环函数、棘轮、KV 写入
#   4. 棘轮文件路径在 ratchets/ 下
#   5. TestPyramidPage 含七环对账区块

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== seven-ring-audit smoke ==="

# ── 1. KV 路由文件存在 ──
KV_ROUTE="$ROOT/packages/brain/src/routes/kv.js"
if [[ -f "$KV_ROUTE" ]]; then
  pass "kv.js 路由文件存在"
else
  fail "kv.js 路由文件不存在（$KV_ROUTE）"
fi

# ── 2. KV 路由含 GET + POST /:key ──
node -e "
const fs = require('fs');
const src = fs.readFileSync('$KV_ROUTE', 'utf8');
const checks = [
  ['router.get', 'GET /:key 路由'],
  ['router.post', 'POST /:key 路由'],
  ['working_memory', 'working_memory 表引用'],
  ['ON CONFLICT', 'upsert ON CONFLICT 逻辑'],
  ['value_json', 'value_json 字段'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: kv.js 缺少:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('[OK] kv.js GET/POST 路由结构正确');
" || FAILED=$((FAILED + 1))

# ── 3. seven-ring-audit.js 存在并含七环函数 ──
AUDIT_SCRIPT="$ROOT/packages/brain/scripts/seven-ring-audit.js"
if [[ -f "$AUDIT_SCRIPT" ]]; then
  pass "seven-ring-audit.js 存在"
else
  fail "seven-ring-audit.js 不存在（$AUDIT_SCRIPT）"; FAILED=$((FAILED + 1))
fi

node -e "
const fs = require('fs');
const src = fs.readFileSync('$AUDIT_SCRIPT', 'utf8');
const checks = [
  ['r1_testsRegistered', '环1：测试入册'],
  ['r2_loopRunning',     '环2：定时循环在跑'],
  ['r3_deployFingerprint','环3：部署指纹'],
  ['r4_ledgerCorrect',   '环4：账本写对'],
  ['r5_outputConsumed',  '环5：产出有人消费'],
  ['r6_alertChannelAlive','环6：告警通道活着'],
  ['r7_dashboardFresh',  '环7：面板数据新鲜'],
  ['checkRatchet',       '棘轮检查'],
  ['seven-ring-audit-last','KV 写入 key'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: seven-ring-audit.js 缺少:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('[OK] 七环函数 + 棘轮 + KV 写入结构完整');
" || FAILED=$((FAILED + 1))

# ── 4. 棘轮路径在 quality/ratchets/ 下 ──
RATCHET_PATH="$ROOT/packages/quality/ratchets/seven-ring-hard-faults.json"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$AUDIT_SCRIPT', 'utf8');
if (!src.includes('seven-ring-hard-faults.json')) {
  console.error('FAIL: 棘轮文件路径 seven-ring-hard-faults.json 未找到');
  process.exit(1);
}
console.log('[OK] 棘轮文件路径引用正确');
" || FAILED=$((FAILED + 1))

# ── 5. TestPyramidPage 含七环对账区块 ──
PYRAMID_PAGE="$ROOT/apps/api/features/execution/pages/TestPyramidPage.tsx"
if [[ -f "$PYRAMID_PAGE" ]]; then
  node -e "
const fs = require('fs');
const src = fs.readFileSync('$PYRAMID_PAGE', 'utf8');
const checks = [
  ['seven-ring', '七环对账引用（seven-ring）'],
  ['seven_ring', '七环状态字段（seven_ring）（或用 camelCase）'],
];
const found = checks.some(([p]) => src.includes(p));
if (!found) {
  // 更宽泛搜索
  if (!src.includes('七环') && !src.includes('sevenRing') && !src.includes('SevenRing') && !src.includes('七环对账')) {
    console.error('FAIL: TestPyramidPage.tsx 未含七环对账区块');
    process.exit(1);
  }
}
console.log('[OK] TestPyramidPage 含七环对账区块');
" || FAILED=$((FAILED + 1))
else
  fail "TestPyramidPage.tsx 不存在（$PYRAMID_PAGE）"
fi

# ── 6. routes.js 中注册了 kv 路由 ──
ROUTES_JS="$ROOT/packages/brain/src/routes.js"
if [[ -f "$ROUTES_JS" ]]; then
  node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROUTES_JS', 'utf8');
if (!src.includes('kvRouter') && !src.includes(\"'/kv'\") && !src.includes('\"/kv\"') && !src.includes(\"'/kv \") ) {
  // 宽泛：只要 kv 路由被 use 即可
  if (!src.includes('kv')) {
    console.error('FAIL: routes.js 未注册 KV 路由');
    process.exit(1);
  }
}
// 确认用了 kvRouter
if (!src.includes('kvRouter')) {
  console.error('FAIL: routes.js 未引用 kvRouter');
  process.exit(1);
}
console.log('[OK] routes.js 已注册 KV 路由');
" || FAILED=$((FAILED + 1))
fi

echo ""
echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}SEVEN_RING_AUDIT_SMOKE_OK${NC} — 全绿"
  exit 0
else
  echo -e "${RED}SEVEN_RING_AUDIT_SMOKE_FAIL${NC} — ${FAILED} 项红"
  exit 1
fi
