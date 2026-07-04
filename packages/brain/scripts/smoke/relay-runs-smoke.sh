#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── relay-runs smoke ──"

# 端点可达，返回 200 + JSON 数组
r=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs") || { fail "GET /api/brain/orchestrator/relay-runs 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "relay-runs GET 返回 JSON 数组" || fail "relay-runs GET 结构异常（非数组）"

# limit 参数生效
r2=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs?limit=1") || { fail "relay-runs ?limit=1 不可达"; r2="[]"; }
COUNT=$(echo "$r2" | jq 'length')
[ "$COUNT" -le 1 ] && ok "relay-runs limit=1 返回条数 ≤ 1（实际=$COUNT）" || fail "relay-runs limit=1 返回了 $COUNT 条"

# 无效 limit 返回 400
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN/api/brain/orchestrator/relay-runs?limit=abc")
[ "$HTTP_STATUS" = "400" ] && ok "relay-runs limit=abc 返回 400" || fail "relay-runs limit=abc 返回 $HTTP_STATUS（期望 400）"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
