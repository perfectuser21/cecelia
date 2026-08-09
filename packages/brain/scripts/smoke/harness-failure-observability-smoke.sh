#!/usr/bin/env bash
# harness-failure-observability-smoke.sh
# 验收：GET /api/brain/harness/failure-stats 计量端点在真环境（含空库）行为正确。
# 决策 e8f6134f 交付物2：harness 失败率计量地基。空库下 failure_rate=0、by_class={}，不 NaN/500。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. days=7 → 200 + schema（failure_rate number / by_class object / 关键字段齐全）
echo "── failure-stats?days=7 ──"
RESP=$(curl -s "$API/harness/failure-stats?days=7")
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/harness/failure-stats?days=7")
[[ "$CODE" == "200" ]] && ok "GET /failure-stats?days=7 → 200" || fail "GET /failure-stats?days=7 → 期望 200，得 $CODE"
echo "$RESP" | jq -e '.failure_rate | type == "number"' >/dev/null 2>&1 \
  && ok "failure_rate 为 number" || fail "failure_rate 非 number（resp=${RESP}）"
echo "$RESP" | jq -e '.by_class | type == "object"' >/dev/null 2>&1 \
  && ok "by_class 为 object" || fail "by_class 非 object"
echo "$RESP" | jq -e 'has("days") and has("window_start") and has("total_terminal") and has("total_failed")' >/dev/null 2>&1 \
  && ok "schema 字段齐全（days/window_start/total_terminal/total_failed）" || fail "schema 缺字段"
# 禁用字段名不得出现
echo "$RESP" | jq -e '(has("rate") or has("count") or has("classes") or has("window")) | not' >/dev/null 2>&1 \
  && ok "无禁用字段名（rate/count/classes/window）" || fail "出现禁用字段名"
# 空库口径：total_terminal=0 时 failure_rate 必为 0（不 NaN/null）
echo "$RESP" | jq -e '(.failure_rate >= 0) and (if .total_terminal == 0 then .failure_rate == 0 else true end)' >/dev/null 2>&1 \
  && ok "空窗口失败率定义良好（total_terminal=0 → failure_rate=0）" || fail "空窗口失败率异常"

# 2. days=0 → 400 + error 字段（非法输入拒绝，不 500/NaN）
echo "── failure-stats?days=0 ──"
ECODE=$(curl -s -o /tmp/fs-smoke-err.json -w "%{http_code}" "$API/harness/failure-stats?days=0")
[[ "$ECODE" == "400" ]] && ok "GET /failure-stats?days=0 → 400" || fail "GET /failure-stats?days=0 → 期望 400，得 $ECODE"
jq -e '.error | type == "string"' /tmp/fs-smoke-err.json >/dev/null 2>&1 \
  && ok "400 body 含 error 字符串" || fail "400 无 error 字段"

echo ""
echo "📊 harness-failure-observability-smoke — 通过: $PASS, 失败: $FAIL"
[ "$FAIL" -eq 0 ]
