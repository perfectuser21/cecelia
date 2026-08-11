#!/usr/bin/env bash
# Universal Map Projection Engine smoke test (刀4 MJ5)
# 验证 /api/brain/map 核心端点可访问且返回预期结构
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── map-engine smoke ──"

# 1. /health 端点可达
h=$(curl -sf "$BRAIN/api/brain/map/health?scope=cecelia") || { fail "GET /health 不可达"; h="{}"; }
echo "$h" | jq -e '.scope_key == "cecelia"' >/dev/null 2>&1 \
  && ok "GET /health 返回 scope_key=cecelia" \
  || fail "GET /health 结构异常"

# 2. /manifests 列表端点
m=$(curl -sf "$BRAIN/api/brain/map/manifests?scope=cecelia") || { fail "GET /manifests 不可达"; m="[]"; }
echo "$m" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "GET /manifests 返回数组" \
  || fail "GET /manifests 结构异常"

# 3. POST /manifests/validate — 验证 manifest 格式校验端点
payload='{"scope_key":"smoke_test","schema_version":1,"value_streams":[{"key":"vs1","name":"VS1","perceiver":"user","order":1}],"capabilities":[{"key":"C1","name":"Cap1","value_stream_key":"vs1","order":1}],"boundaries":[],"crosscut_pool":[],"shared_prerequisites":{"applicable":false,"items":[],"reason":"smoke"}}'
v=$(curl -sf -X POST "$BRAIN/api/brain/map/manifests/validate" \
  -H "Content-Type: application/json" -d "$payload") || { fail "POST /validate 不可达"; v="{}"; }
echo "$v" | jq -e '.valid == true' >/dev/null 2>&1 \
  && ok "POST /validate 返回 valid=true" \
  || fail "POST /validate 未返回 valid=true"

# 4. GET /unclaimed — 未归属事实端点
u=$(curl -sf "$BRAIN/api/brain/map/unclaimed?scope=cecelia") || { fail "GET /unclaimed 不可达"; u="{}"; }
echo "$u" | jq -e '.scope_key' >/dev/null 2>&1 \
  && ok "GET /unclaimed 返回 scope_key" \
  || fail "GET /unclaimed 结构异常"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
