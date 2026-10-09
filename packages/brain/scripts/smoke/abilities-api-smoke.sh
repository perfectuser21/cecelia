#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── abilities API smoke ──"
r=$(curl -sf "$BRAIN/api/brain/abilities?limit=5") || { fail "abilities GET 不可达"; r="{}"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "abilities GET 返回数组" || fail "abilities GET 结构异常"

# golden_path 旧表已退役（任务 7d312fd8）：读路由默认 410 + retired 体
gcode=$(curl -s -o /tmp/abilities-smoke-gp.json -w '%{http_code}' "$BRAIN/api/brain/golden_path?limit=5") || gcode=000
[ "$gcode" = "410" ] && jq -e '.retired==true and .path_kind=="read"' /tmp/abilities-smoke-gp.json >/dev/null 2>&1 \
  && ok "golden_path GET 已退役（410 retired）" || fail "golden_path GET 期望 410 retired got $gcode"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
