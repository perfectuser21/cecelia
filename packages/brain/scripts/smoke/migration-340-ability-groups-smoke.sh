#!/usr/bin/env bash
# migration-340-ability-groups-smoke.sh
# 真库 + 真 API 验证 migration 340（能力轴 L2 子领域）：
#   1. ability_groups 表存在
#   2. golden_paths 有 group_id 列（migration 340 加）
#   3. POST /ability-groups 建组 201
#   4. GET /ability-groups?journey_id= 能查到刚建的组
#   5. 清理（DELETE 建的组）
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── migration-340 ability_groups smoke ──"

# 1. ability_groups 表存在
T=$(psql "$DB_URL" -tAc "SELECT to_regclass('public.ability_groups')" 2>/dev/null || echo "")
[[ "$T" == "ability_groups" ]] && ok "ability_groups 表存在" || fail "ability_groups 表缺失"

# 2. golden_paths.group_id 列存在
C=$(psql "$DB_URL" -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_name='golden_paths' AND column_name='group_id'" \
  2>/dev/null || echo "")
[[ "$C" == "group_id" ]] && ok "golden_paths.group_id 列存在" || fail "golden_paths.group_id 列缺失"

# 3. POST 建组 → 201（取一个真实 journey_id 挂载，取不到则不挂）
JID=$(psql "$DB_URL" -tAc "SELECT id FROM journeys LIMIT 1" 2>/dev/null | tr -d '[:space:]' || echo "")
NAME="__smoke_group_$$_$RANDOM"
if [[ -n "$JID" ]]; then
  BODY=$(printf '{"name":"%s","journey_id":"%s"}' "$NAME" "$JID")
else
  BODY=$(printf '{"name":"%s"}' "$NAME")
fi
RESP=$(curl -s -o /tmp/ag_post_$$.json -w '%{http_code}' -X POST "$BRAIN/api/brain/ability-groups" \
  -H 'Content-Type: application/json' -d "$BODY" || echo "000")
NEW_ID=$(jq -r '.ability_group.id // empty' /tmp/ag_post_$$.json 2>/dev/null || echo "")
[[ "$RESP" == "201" && -n "$NEW_ID" ]] && ok "POST /ability-groups 建组 201" || fail "POST /ability-groups 期望 201，实际 $RESP"

# 4. GET 列表能查到刚建的组
if [[ -n "$JID" ]]; then
  LIST=$(curl -sf "$BRAIN/api/brain/ability-groups?journey_id=$JID" 2>/dev/null || echo '{}')
else
  LIST=$(curl -sf "$BRAIN/api/brain/ability-groups" 2>/dev/null || echo '{}')
fi
echo "$LIST" | jq -e --arg n "$NAME" '.ability_groups[]? | select(.name==$n)' >/dev/null 2>&1 \
  && ok "GET /ability-groups 能查到新建组" || fail "GET /ability-groups 查不到新建组"

# 5. 清理
if [[ -n "$NEW_ID" ]]; then
  curl -s -o /dev/null -X DELETE "$BRAIN/api/brain/ability-groups/$NEW_ID" || true
fi
rm -f /tmp/ag_post_$$.json

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
