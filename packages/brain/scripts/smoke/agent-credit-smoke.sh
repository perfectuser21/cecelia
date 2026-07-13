#!/usr/bin/env bash
# agent-credit-smoke.sh
# 验收：Agent 积分扣费/查询 API 端点可用（GET /agent/credit/balance, POST /agent/credit/deduct）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. GET /agent/credit/balance 缺 license_key → 400
echo "── balance: 缺 license_key ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/agent/credit/balance")
[[ "$code" == "400" ]] \
  && ok "GET /agent/credit/balance（无参数）→ 400" \
  || fail "GET /agent/credit/balance（无参数）→ 期望 400，得 $code"

# 2. GET /agent/credit/balance 带不存在的 license_key → 404
echo "── balance: license 不存在 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/agent/credit/balance?license_key=NONEXISTENT-KEY-smoke-test")
[[ "$code" == "404" ]] \
  && ok "GET /agent/credit/balance（不存在的 license）→ 404" \
  || fail "GET /agent/credit/balance（不存在的 license）→ 期望 404，得 $code"

# 3. POST /agent/credit/deduct 缺 license_key → 400
echo "── deduct: 缺 license_key ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/agent/credit/deduct" \
  -H "Content-Type: application/json" -d '{"amount":1}')
[[ "$code" == "400" ]] \
  && ok "POST /agent/credit/deduct（无 license_key）→ 400" \
  || fail "POST /agent/credit/deduct（无 license_key）→ 期望 400，得 $code"

# 4. POST /agent/credit/deduct amount 非法（负数）→ 400
echo "── deduct: amount 非法 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/agent/credit/deduct" \
  -H "Content-Type: application/json" -d '{"license_key":"smoke-test","amount":-1}')
[[ "$code" == "400" ]] \
  && ok "POST /agent/credit/deduct（amount=-1）→ 400" \
  || fail "POST /agent/credit/deduct（amount=-1）→ 期望 400，得 $code"

# 5. POST /agent/credit/deduct license 不存在 → 404
echo "── deduct: license 不存在 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/agent/credit/deduct" \
  -H "Content-Type: application/json" -d '{"license_key":"NONEXISTENT-KEY-smoke-test","amount":1}')
[[ "$code" == "404" ]] \
  && ok "POST /agent/credit/deduct（不存在的 license）→ 404" \
  || fail "POST /agent/credit/deduct（不存在的 license）→ 期望 404，得 $code"

echo ""
echo "── 结果: $PASS 通过, $FAIL 失败 ──"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
