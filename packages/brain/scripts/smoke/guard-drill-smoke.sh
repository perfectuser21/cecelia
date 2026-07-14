#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── guard-drill smoke ──"

r=$(curl -sf "$BRAIN/api/brain/guard-drill/status") || { fail "GET /status 不可达"; r="{}"; }

echo "$r" | jq -e '.guards | type == "array"' >/dev/null 2>&1 \
  && ok "GET /status 返回 guards 数组" \
  || fail "GET /status 结构异常（缺 guards）"

echo "$r" | jq -e '.stale_threshold_days == 90' >/dev/null 2>&1 \
  && ok "stale_threshold_days = 90" \
  || fail "stale_threshold_days 不是 90"

echo "$r" | jq -e '.guards | length > 0' >/dev/null 2>&1 \
  && ok "guards 列表非空（≥1 守卫已登记）" \
  || fail "guards 列表为空"

echo "$r" | jq -e '.guards[0] | has("stale")' >/dev/null 2>&1 \
  && ok "每个守卫含 stale 字段" \
  || fail "守卫缺 stale 字段"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
