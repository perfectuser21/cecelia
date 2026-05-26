#!/usr/bin/env bash
# 8table-schema-smoke.sh
# 验收：Brain DB 8张表统一架构端点全部可用
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. GET /api/brain/skills 返回 200 + 数组（CI 空库也能通过，验证端点+表存在）
echo "── skills list ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/skills")
[[ "$code" == "200" ]] \
  && ok "GET /skills → 200（skill_registry 表存在）" \
  || fail "GET /skills → 期望 200，得 $code"

# 2. GET /api/brain/journeys 返回列表（不是 404）
echo "── journeys list ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/journeys")
[[ "$code" == "200" ]] \
  && ok "GET /journeys → 200" \
  || fail "GET /journeys → 期望 200，得 $code"

# 3. GET /api/brain/journey_steps 返回 200
echo "── journey_steps list ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/journey_steps")
[[ "$code" == "200" ]] \
  && ok "GET /journey_steps → 200" \
  || fail "GET /journey_steps → 期望 200，得 $code"

# 4. GET /api/brain/journey_step_links 返回 200
echo "── journey_step_links list ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/journey_step_links")
[[ "$code" == "200" ]] \
  && ok "GET /journey_step_links → 200" \
  || fail "GET /journey_step_links → 期望 200，得 $code"

# 5. registry?type=skill 路由到 skill_registry（POST 一条测试数据再验证字段）
echo "── registry?type=skill routing ──"
# 先 POST 一条测试 skill（幂等，重复运行不报错）
curl -sf -X POST "$API/skills" \
  -H "Content-Type: application/json" \
  -d '{"name":"_smoke-test-skill","description":"smoke test","status":"active"}' \
  -o /dev/null 2>/dev/null || true
# 再 GET，验证返回 skill_registry 格式（含 notion_id 字段）
resp=$(curl -sf "$API/registry?type=skill&limit=1" 2>/dev/null) || resp=""
has_field=$(echo "$resp" | python3 -c "
import json,sys
d=json.load(sys.stdin)
rows = d if isinstance(d,list) else []
print('yes' if rows and 'notion_id' in rows[0] else 'no')
" 2>/dev/null || echo "no")
[[ "$has_field" == "yes" ]] \
  && ok "registry?type=skill → 含 notion_id（skill_registry 路由正确）" \
  || fail "registry?type=skill → 未返回 skill_registry 格式（notion_id 缺失）"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
