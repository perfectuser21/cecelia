#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── abilities API smoke ──"
r=$(curl -sf "$BRAIN/api/brain/abilities?limit=5") || { fail "abilities GET 不可达"; r="{}"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "abilities GET 返回数组" || fail "abilities GET 结构异常"

g=$(curl -sf "$BRAIN/api/brain/golden_path?limit=5") || { fail "golden_path GET 不可达"; g="{}"; }
echo "$g" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "golden_path GET 返回数组" || fail "golden_path GET 结构异常"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
