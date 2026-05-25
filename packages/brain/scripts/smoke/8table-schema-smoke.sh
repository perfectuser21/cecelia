#!/usr/bin/env bash
# 8table-schema-smoke.sh
# 验收：Brain DB 8张表统一架构端点全部可用
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. GET /api/brain/skills 返回 200 + 至少 50 条（skill_registry 迁移后）
echo "── skills list ──"
resp=$(curl -sf "$API/skills" 2>/dev/null) || resp=""
count=$(echo "$resp" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
[[ "$count" -ge 50 ]] \
  && ok "GET /skills → $count 条" \
  || fail "GET /skills → 期望≥50，得 $count"

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

# 5. GET /api/brain/registry?type=skill 返回来自 skill_registry 的数据
#    skill_registry 行有 notion_id 字段（system_registry 行里没有这个独立字段）
echo "── registry?type=skill routing ──"
resp=$(curl -sf "$API/registry?type=skill&limit=1" 2>/dev/null) || resp=""
# skill_registry 的行有 notion_id key（system_registry 没有）
has_field=$(echo "$resp" | python3 -c "
import json,sys
d=json.load(sys.stdin)
rows = d if isinstance(d,list) else []
print('yes' if rows and 'notion_id' in rows[0] else 'no')
" 2>/dev/null || echo "no")
[[ "$has_field" == "yes" ]] \
  && ok "registry?type=skill → 字段含 notion_id（来自 skill_registry）" \
  || fail "registry?type=skill → 未返回 skill_registry 格式数据"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
