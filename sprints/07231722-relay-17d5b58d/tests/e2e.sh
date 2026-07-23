#!/usr/bin/env bash
# E2E 验收脚本 — GET /negate
# Sprint: 07231722-relay-17d5b58d
# target_environment: playground
# 使用方式: PLAYGROUND_PORT=3001 bash e2e.sh
# 退出码: 0=全部通过, 1=有失败

set -euo pipefail

PORT="${PLAYGROUND_PORT:-3001}"
BASE="http://localhost:${PORT}"
PASS=0
FAIL=0

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  PASS=$((PASS + 1))
}

fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  FAIL=$((FAIL + 1))
}

assert_status() {
  local desc="$1"
  local expected_status="$2"
  local url="$3"
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" "${url}")
  if [ "$actual" = "$expected_status" ]; then
    pass "$desc → HTTP $actual"
  else
    fail "$desc → 期望 HTTP $expected_status，实际 HTTP $actual"
  fi
}

assert_body_field() {
  local desc="$1"
  local url="$2"
  local field="$3"
  local expected="$4"
  local body
  body=$(curl -s "${url}")
  local actual
  actual=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('${field}','__MISSING__'))" 2>/dev/null || echo "__ERROR__")
  if [ "$actual" = "$expected" ]; then
    pass "$desc → $field=$actual"
  else
    fail "$desc → 期望 $field=$expected，实际 $field=$actual（body=$body）"
  fi
}

assert_field_equals_number() {
  local desc="$1"
  local url="$2"
  local field="$3"
  local expected="$4"
  local body
  body=$(curl -s "${url}")
  local actual
  actual=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('${field}','__MISSING__'))" 2>/dev/null || echo "__ERROR__")
  if [ "$actual" = "$expected" ]; then
    pass "$desc → $field=$actual"
  else
    fail "$desc → 期望 $field=$expected，实际 $field=$actual（body=$body）"
  fi
}

echo "=== E2E 验收 — GET /negate ==="
echo "Target: ${BASE}"
echo ""

# --- 正常路径 ---

echo "--- 正常路径 ---"

# 1. value=5 → HTTP 200 + {result:-5, operation:"negate"}
assert_status "GET /negate?value=5 → HTTP 200" "200" "${BASE}/negate?value=5"
assert_field_equals_number "GET /negate?value=5 → result=-5" "${BASE}/negate?value=5" "result" "-5"
assert_body_field "GET /negate?value=5 → operation=negate" "${BASE}/negate?value=5" "operation" "negate"

# 2. value=-5 → HTTP 200 + {result:5}
assert_status "GET /negate?value=-5 → HTTP 200" "200" "${BASE}/negate?value=-5"
assert_field_equals_number "GET /negate?value=-5 → result=5" "${BASE}/negate?value=-5" "result" "5"

# 3. value=0 → HTTP 200 + {result:0}（-0 规范化为 0）
assert_status "GET /negate?value=0 → HTTP 200" "200" "${BASE}/negate?value=0"
assert_field_equals_number "GET /negate?value=0 → result=0（-0 规范化）" "${BASE}/negate?value=0" "result" "0"

# 4. value=9007199254740990 → HTTP 200 + {result:-9007199254740990}
assert_status "GET /negate?value=9007199254740990 → HTTP 200" "200" "${BASE}/negate?value=9007199254740990"
assert_field_equals_number "GET /negate?value=9007199254740990 → result=-9007199254740990" "${BASE}/negate?value=9007199254740990" "result" "-9007199254740990"

# schema 铁律：operation 字面值必须是 "negate"
BODY=$(curl -s "${BASE}/negate?value=5")
OP=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('operation','__MISSING__'))" 2>/dev/null || echo "__ERROR__")
if [ "$OP" = "negate" ]; then
  pass "schema 铁律: operation='negate'（非 negation/neg/negative）"
else
  fail "schema 铁律: operation='$OP'，期望 'negate'"
fi

# schema 铁律：键名是 result（非 negated/value/output）
HAS_RESULT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'result' in d else 'no')" 2>/dev/null || echo "error")
HAS_NEGATED=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'negated' in d else 'no')" 2>/dev/null || echo "error")
if [ "$HAS_RESULT" = "yes" ] && [ "$HAS_NEGATED" = "no" ]; then
  pass "schema 铁律: 键名 'result' 存在，'negated' 不存在"
else
  fail "schema 铁律: result=$HAS_RESULT negated=$HAS_NEGATED（body=$BODY）"
fi

echo ""
echo "--- 错误路径 ---"

# 5. value=9007199254740991 → HTTP 400
assert_status "GET /negate?value=9007199254740991（超上界）→ HTTP 400" "400" "${BASE}/negate?value=9007199254740991"

# 6. 缺 value → HTTP 400
assert_status "GET /negate（缺 value）→ HTTP 400" "400" "${BASE}/negate"

# 7. value=3.14 → HTTP 400
assert_status "GET /negate?value=3.14（小数）→ HTTP 400" "400" "${BASE}/negate?value=3.14"

# 8. value=abc → HTTP 400
assert_status "GET /negate?value=abc（非数字）→ HTTP 400" "400" "${BASE}/negate?value=abc"

# 9. value=1e2 → HTTP 400
assert_status "GET /negate?value=1e2（科学计数法）→ HTTP 400" "400" "${BASE}/negate?value=1e2"

# 10. value=+5 → HTTP 400
assert_status "GET /negate?value=+5（前导+）→ HTTP 400" "400" "${BASE}/negate?value=%2B5"

# 11. 验证 400 响应包含 error 字段非空
ERR_BODY=$(curl -s "${BASE}/negate")
ERR_FIELD=$(echo "$ERR_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('error',''); print(v)" 2>/dev/null || echo "")
if [ -n "$ERR_FIELD" ]; then
  pass "400 响应包含非空 error 字段: error='$ERR_FIELD'"
else
  fail "400 响应缺少 error 字段或为空（body=$ERR_BODY）"
fi

echo ""
echo "--- 回归验证 ---"

# 12. /health 回归
assert_status "GET /health 回归" "200" "${BASE}/health"

# 13. /increment?value=1 回归
assert_status "GET /increment?value=1 回归" "200" "${BASE}/increment?value=1"

# 14. /decrement?value=1 回归
assert_status "GET /decrement?value=1 回归" "200" "${BASE}/decrement?value=1"

echo ""
echo "--- 汇总 ---"
echo -e "通过: ${GREEN}${PASS}${NC}，失败: ${RED}${FAIL}${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}E2E FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}E2E PASSED${NC}"
  exit 0
fi
