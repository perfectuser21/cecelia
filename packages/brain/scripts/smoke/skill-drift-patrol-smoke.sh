#!/usr/bin/env bash
# smoke: skill-drift-patrol patrol-history 端点健康检查
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── skill-drift-patrol smoke ──"
r=$(curl -sf "$BRAIN/api/brain/harness/skill-drift/patrol-history") || {
  echo "  ❌ patrol-history GET 不可达"
  echo "PASS: 0  FAIL: 1"
  exit 1
}

echo "$r" | jq -e '.alerts | type == "array"' >/dev/null 2>&1 \
  && ok "alerts 字段为数组" || fail "alerts 字段非数组"
echo "$r" | jq -e 'keys == ["alerts"]' >/dev/null 2>&1 \
  && ok "顶层 keys 严格为 [\"alerts\"]" || fail "顶层 keys 不符"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/skill-drift/patrol-history")
[[ "$code" != "200" ]] && ok "POST patrol-history 非 200（方法语义）" || fail "POST 返回了 200"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
