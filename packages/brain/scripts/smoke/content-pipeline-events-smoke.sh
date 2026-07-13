#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── content-pipeline events API smoke ──"

# GET /api/brain/pipelines 返回数组
r=$(curl -sf "$BRAIN/api/brain/pipelines?limit=5") || { fail "GET /api/brain/pipelines 不可达"; r="[]"; }
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "GET /api/brain/pipelines 返回数组" || fail "GET /api/brain/pipelines 结构异常"

# GET /api/brain/pipelines?with_last_event=1 返回数组（刀1e 新增参数）
r2=$(curl -sf "$BRAIN/api/brain/pipelines?with_last_event=1&limit=5") || { fail "GET /api/brain/pipelines?with_last_event=1 不可达"; r2="[]"; }
echo "$r2" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "GET /api/brain/pipelines?with_last_event=1 返回数组" || fail "with_last_event=1 结构异常"

# GET /api/brain/pipelines/:id/events 对不存在 id 返回空数组（不报错）
fake_id="00000000-0000-0000-0000-000000000000"
r3=$(curl -sf "$BRAIN/api/brain/pipelines/$fake_id/events") || { fail "GET /api/brain/pipelines/:id/events 不可达"; r3="[]"; }
echo "$r3" | jq -e 'type == "array"' >/dev/null 2>&1 && ok "GET /api/brain/pipelines/:id/events 对不存在 id 返回空数组" || fail "events 端点结构异常"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
