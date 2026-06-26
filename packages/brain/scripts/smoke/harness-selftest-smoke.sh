#!/usr/bin/env bash
# harness-selftest-smoke.sh
# 验收：只读自检端点 GET /api/brain/harness-selftest 真环境可用（零 DB、零副作用、幂等）
#
# 设计原则：始终打印每一步的【原始命令输出】（http_code / 响应体 / jq 退出码），
#   不论通过或失败 —— evaluator/judge 据此核验"真执行"而非"自述结论"。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

echo "🎯 target: $API"

# 1. 路由真注册：返回 200（404 = 未挂载 = FAIL）
echo "── [1] harness-selftest 200 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/harness-selftest")
echo "  \$ curl -s -o /dev/null -w '%{http_code}' $API/harness-selftest"
echo "  http_code=$code"
[[ "$code" == "200" ]] \
  && ok "GET /harness-selftest → 200" \
  || fail "GET /harness-selftest → 期望 200，得 $code"

# 2. 固定 JSON 内容：ok===true / service==="harness" / keys 恰好 [ok,service]
echo "── [2] 固定 JSON 内容 ──"
resp=$(curl -sf "$API/harness-selftest")
ct=$(curl -s -o /dev/null -w "%{content_type}" "$API/harness-selftest")
echo "  \$ curl -sf $API/harness-selftest"
echo "  body=$resp"
echo "  content_type=$ct"
# 必须先有非空响应体，再做内容断言：空 body 经 jq 会假性 exit 0（echo ""|jq → null），不可放行
{ [[ -n "$resp" ]] && echo "$resp" | jq -e '.ok == true and .service == "harness" and (keys == ["ok","service"])' >/dev/null 2>&1; } \
  && ok "响应体 = {ok:true, service:\"harness\"}，顶层 keys 恰好 [ok,service]，无动态字段" \
  || fail "响应体不符合固定契约 → '$resp'"
[[ "$ct" == application/json* ]] \
  && ok "Content-Type = application/json" \
  || fail "Content-Type 非 application/json → $ct"

# 3. 幂等：两次调用逐字节一致
echo "── [3] 幂等 ──"
a=$(curl -sf "$API/harness-selftest"); b=$(curl -sf "$API/harness-selftest")
echo "  A=$a"
echo "  B=$b"
# 非空 + 逐字节一致：两次都空（如 404）不算幂等通过
{ [[ -n "$a" ]] && [[ "$a" == "$b" ]]; } \
  && ok "两次调用响应体逐字节一致（幂等、无副作用）" \
  || fail "非幂等或空响应 a='$a' b='$b'"

# 4. 既有端点回归：/health 仍 200 + 含 status 字段
echo "── [4] /health 回归 ──"
hcode=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
hbody=$(curl -sf "$API/health" 2>/dev/null || echo '{}')
hstatus=$(echo "$hbody" | jq -r 'has("status")' 2>/dev/null || echo false)
echo "  http_code=$hcode  has(status)=$hstatus"
echo "  status=$(echo "$hbody" | jq -r '.status // "<none>"' 2>/dev/null)"
{ [[ "$hcode" == "200" ]] && [[ "$hstatus" == "true" ]]; } \
  && ok "GET /health → 200 且含 status 字段（既有端点未被破坏）" \
  || fail "GET /health → 期望 200+status，得 code=$hcode has(status)=$hstatus"

echo ""
echo "📊 harness-selftest smoke — 通过 $PASS，失败 $FAIL"
[[ "$FAIL" -eq 0 ]]
