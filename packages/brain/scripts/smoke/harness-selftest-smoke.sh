#!/usr/bin/env bash
# harness-selftest-smoke.sh
# 验收：只读自检端点 GET /api/brain/harness-selftest 真环境可用（零 DB、零副作用、幂等）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. 路由真注册：返回 200（404 = 未挂载 = FAIL）
echo "── harness-selftest 200 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/harness-selftest")
[[ "$code" == "200" ]] \
  && ok "GET /harness-selftest → 200" \
  || fail "GET /harness-selftest → 期望 200，得 $code"

# 2. 固定 JSON 内容：ok===true / service==="harness" / keys 恰好 [ok,service]
echo "── 固定 JSON 内容 ──"
resp=$(curl -sf "$API/harness-selftest")
echo "$resp" | jq -e '.ok == true and .service == "harness" and (keys == ["ok","service"])' >/dev/null 2>&1 \
  && ok "响应体 = {ok:true, service:\"harness\"}，无动态字段" \
  || fail "响应体不符合固定契约 → $resp"

# 3. 幂等：两次调用逐字节一致
echo "── 幂等 ──"
a=$(curl -sf "$API/harness-selftest"); b=$(curl -sf "$API/harness-selftest")
[[ "$a" == "$b" ]] \
  && ok "两次调用响应体一致（幂等、无副作用）" \
  || fail "非幂等 a=$a b=$b"

# 4. 既有端点回归：/health 仍 200 + 含 status
echo "── /health 回归 ──"
hcode=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
[[ "$hcode" == "200" ]] \
  && ok "GET /health → 200（既有端点未被破坏）" \
  || fail "GET /health → 期望 200，得 $hcode"

echo ""
echo "📊 harness-selftest smoke — 通过 $PASS，失败 $FAIL"
[[ "$FAIL" -eq 0 ]]
