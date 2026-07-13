#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── relay-runs-verdicts smoke ──"

# 列表端点含五新字段（任意一条 run 存在时验证）
r=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs") || { fail "GET /relay-runs 不可达"; r="[]"; }
ITEM=$(echo "$r" | jq '.[0]')
if [ "$ITEM" = "null" ]; then
  ok "relay-runs 列表为空，跳过字段验证（无 v2 run）"
else
  for FIELD in evaluate_verdict judge_verdict cost_usd completed_at failure_reason; do
    echo "$ITEM" | jq -e "has(\"$FIELD\")" >/dev/null 2>&1 \
      && ok "列表响应含 $FIELD 字段" \
      || fail "列表响应缺少 $FIELD 字段"
  done
fi

# 详情端点含 cost_usd（取第一条 run 的 initiative_id）
INIT_ID=$(echo "$r" | jq -r '.[0].initiative_id // empty')
if [ -n "$INIT_ID" ]; then
  det=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs/$INIT_ID") || { fail "GET /relay-runs/$INIT_ID 不可达"; det="{}"; }
  echo "$det" | jq -e 'has("cost_usd")' >/dev/null 2>&1 \
    && ok "详情响应含 cost_usd 字段" \
    || fail "详情响应缺少 cost_usd 字段"
else
  ok "无 v2 run，跳过详情字段验证"
fi

# 回归：无效 phase 仍返回 400 + allowed
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/orchestrator/relay-runs?phase=INVALID_XYZ")
[ "$HTTP_STATUS" = "400" ] && ok "?phase=INVALID 仍返回 400（回归）" || fail "?phase=INVALID 返回 $HTTP_STATUS（期望 400）"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
