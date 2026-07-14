#!/usr/bin/env bash
# kv-route-smoke.sh — Brain KV 路由（/api/brain/kv/:key）真链路守卫
#
# 断言：
#   A GET 不存在的 key → 404
#   B POST 写入 → 200 {ok:true}
#   C GET 存在的 key → 200 含 value 字段
#
# 用法：BRAIN_URL=http://localhost:5221 bash kv-route-smoke.sh

set -uo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"

# skip guard：真 Brain 不在（或只是 stub）→ SKIP 不 FAIL（根池/放行闸惯例）
HEALTH=$(curl -s -m 3 "$BRAIN/api/brain/health" 2>/dev/null) || HEALTH=""
if ! echo "$HEALTH" | grep -q '"status":"healthy"'; then
  echo "[smoke:kv-route] SKIP — $BRAIN 无真实 Brain（health: ${HEALTH:-不可达}）"
  exit 0
fi

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── KV 路由 smoke (${BRAIN}) ──"

TEST_KEY="smoke-kv-$$"
TEST_VAL='{"smoke":true}'

# A: GET 不存在 key → 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "$BRAIN/api/brain/kv/$TEST_KEY") || STATUS="000"
[[ "${STATUS}" == "404" ]] && ok "GET 不存在 key → 404" || fail "GET 不存在 key：期望 404，实际 ${STATUS}"

# B: POST 写入 → 200 ok=true
RESP=$(curl -sf -m 8 -X POST "$BRAIN/api/brain/kv/$TEST_KEY" \
  -H "Content-Type: application/json" \
  -d "$TEST_VAL") || RESP=""
echo "${RESP}" | grep -q '"ok":true' && ok "POST 写入 → ok=true" || fail "POST 写入失败: ${RESP}"

# C: GET 存在的 key → 200 含 value
GRESP=$(curl -sf -m 8 "$BRAIN/api/brain/kv/$TEST_KEY") || GRESP=""
echo "${GRESP}" | grep -q '"value"' && ok "GET 已写入 key → 含 value" || fail "GET 响应无 value: ${GRESP}"

# seven-ring-audit-last 结构合法（可选，不存在不报错）
AUDIT=$(curl -s -m 8 "$BRAIN/api/brain/kv/seven-ring-audit-last") || AUDIT=""
if echo "${AUDIT}" | grep -q '"value"'; then
  echo "${AUDIT}" | grep -q '"rings"' && ok "seven-ring-audit-last 含 rings 字段" || fail "seven-ring-audit-last 结构异常: ${AUDIT}"
else
  ok "seven-ring-audit-last 尚未写入（首次运行正常）"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
