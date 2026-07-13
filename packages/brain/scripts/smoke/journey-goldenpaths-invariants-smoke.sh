#!/usr/bin/env bash
# journey-goldenpaths-invariants-smoke.sh
# 真环境 smoke：验证 A1 P0 两个只读端点全链路（harness 验证模型重构 HANDOFF 第 5 节）。
#   1. GET /journeys/:journey_id/golden-paths — 按 line 聚合已验收 ability 的 golden_path（累积 FR）
#   2. GET /invariants — 干净的 invariant 读取端点（读 decisions 表，非 decision_log）
# 跑法：BRAIN=http://localhost:5221 DB_URL=postgresql://localhost/cecelia bash $0
set -euo pipefail

BRAIN="${BRAIN_URL:-${BRAIN:-http://localhost:5221}}"
DB_URL="${DATABASE_URL:-${DB_URL:-postgresql://localhost/cecelia}}"

uuid() { psql "$DB_URL" -t -c "$1" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

BODY=""; CODE=""
req() {
  local method="$1" url="$2" data="${3:-}"
  local out
  if [ -n "$data" ]; then
    echo "  \$ curl -X $method '$url' -d '$data'"
    out=$(curl -s -w $'\n%{http_code}' -X "$method" "$url" -H 'Content-Type: application/json' -d "$data")
  else
    echo "  \$ curl -X $method '$url'"
    out=$(curl -s -w $'\n%{http_code}' -X "$method" "$url")
  fi
  CODE="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
  echo "  ← HTTP $CODE"
  echo "  ← $BODY"
}

echo "[smoke] BRAIN=$BRAIN  DB_URL=${DB_URL%%\?*}"

echo "[smoke] 夹具：journey → journey_feature(ability) → task(ability_id) → golden_path 两步"
JOURNEY_ID=$(uuid "INSERT INTO journeys (name) VALUES ('gp-agg-smoke-journey-' || gen_random_uuid()) RETURNING id")
ABILITY_ID=$(uuid "INSERT INTO journey_features (name, journey_id, kind, status) VALUES ('gp-agg-smoke-ability', '$JOURNEY_ID', 'ability', 'done') RETURNING id")
TASK_ID=$(uuid "INSERT INTO tasks (title, ability_id) VALUES ('gp-agg-smoke-task-' || gen_random_uuid(), '$ABILITY_ID') RETURNING id")
psql "$DB_URL" -c "INSERT INTO golden_path (owner_task_id, order_no, feature_id, note) VALUES ('$TASK_ID', 1, '$ABILITY_ID', 'smoke step one'), ('$TASK_ID', 2, '$ABILITY_ID', 'smoke step two')" >/dev/null
echo "  JOURNEY_ID=$JOURNEY_ID ABILITY_ID=$ABILITY_ID TASK_ID=$TASK_ID (+2 golden_path 步)"

echo "[smoke] === 端点 1 Step 1: GET /journeys/:jid/golden-paths 聚合形态 ==="
req GET "$BRAIN/api/brain/journeys/$JOURNEY_ID/golden-paths"
[ "$CODE" = "200" ] || { echo "FAIL: 期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e --arg t "$TASK_ID" --arg a "$ABILITY_ID" \
  'type=="array" and length==1 and .[0].owner_task_id==$t and .[0].ability_id==$a and .[0].ability_status=="done" and (.[0].steps|length)==2 and .[0].steps[0].order_no==1 and .[0].steps[1].order_no==2' >/dev/null \
  || { echo "FAIL: 聚合形态不符（应按 owner_task_id 分组、steps 按 order_no 升序）"; exit 1; }
echo "  ✓ 200 + 按 owner_task_id 分组 + ability 元数据 + steps 有序"

echo "[smoke] === 端点 1 Step 2: status 过滤 ==="
req GET "$BRAIN/api/brain/journeys/$JOURNEY_ID/golden-paths?status=done"
[ "$CODE" = "200" ] || { echo "FAIL: status=done 期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e 'length==1' >/dev/null || { echo "FAIL: status=done 应命中 1 组"; exit 1; }
req GET "$BRAIN/api/brain/journeys/$JOURNEY_ID/golden-paths?status=planned"
echo "$BODY" | jq -e 'type=="array" and length==0' >/dev/null || { echo "FAIL: status=planned 应空数组"; exit 1; }
echo "  ✓ status 过滤生效（done 命中 / planned 空）"

echo "[smoke] === 端点 1 边界：非法 status → 400；非法 uuid → 400；空 line → 200+[] ==="
req GET "$BRAIN/api/brain/journeys/$JOURNEY_ID/golden-paths?status=nonsense"
[ "$CODE" = "400" ] || { echo "FAIL: 非法 status 应 400 got $CODE"; exit 1; }
req GET "$BRAIN/api/brain/journeys/not-a-uuid/golden-paths"
[ "$CODE" = "400" ] || { echo "FAIL: 非法 uuid 应 400 got $CODE"; exit 1; }
req GET "$BRAIN/api/brain/journeys/00000000-0000-0000-0000-000000000000/golden-paths"
[ "$CODE" = "200" ] || { echo "FAIL: 空 line 应 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e 'type=="array" and length==0' >/dev/null || { echo "FAIL: 空 line 应空数组"; exit 1; }
echo "  ✓ 400/400/200+[] 三边界全对"

echo "[smoke] === 端点 2 Step 1: POST 一条 area 级 invariant → GET /invariants?level=area 读回 ==="
INV_TOPIC="smoke-invariant-$(date +%s)-$$"
req POST "$BRAIN/api/brain/decisions" "{\"category\":\"invariant\",\"topic\":\"$INV_TOPIC\",\"decision\":\"smoke 铁律\",\"level\":\"area\"}"
[ "$CODE" = "201" ] || { echo "FAIL: POST invariant 期望 201 got $CODE"; exit 1; }
req GET "$BRAIN/api/brain/invariants?level=area"
[ "$CODE" = "200" ] || { echo "FAIL: GET /invariants 期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e --arg t "$INV_TOPIC" 'type=="array" and any(.[]; .topic==$t and .category=="invariant" and .level=="area")' >/dev/null \
  || { echo "FAIL: level=area 读回缺刚写的 invariant"; exit 1; }
echo "  ✓ 201 写入 + 200 按 level=area 读回"

echo "[smoke] === 端点 2 Step 2: target_type/target_id 过滤（journey_feature 级铁律，Line04 形态）==="
req POST "$BRAIN/api/brain/decisions" "{\"category\":\"invariant\",\"topic\":\"$INV_TOPIC-jf\",\"decision\":\"smoke jf 铁律\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"$ABILITY_ID\"}"
[ "$CODE" = "201" ] || { echo "FAIL: POST jf invariant 期望 201 got $CODE"; exit 1; }
req GET "$BRAIN/api/brain/invariants?target_type=journey_feature&target_id=$ABILITY_ID"
[ "$CODE" = "200" ] || { echo "FAIL: target 过滤期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e --arg t "$INV_TOPIC-jf" 'any(.[]; .topic==$t)' >/dev/null || { echo "FAIL: target 过滤读回缺失"; exit 1; }
echo "  ✓ journey_feature 级 invariant 按 target 精确读回"

echo "[smoke] === 端点 2 边界：非法 level → 400 ==="
req GET "$BRAIN/api/brain/invariants?level=galaxy"
[ "$CODE" = "400" ] || { echo "FAIL: 非法 level 应 400 got $CODE"; exit 1; }
echo "  ✓ 400"

echo "✅ journey-goldenpaths-invariants-smoke 全链路通过（2 端点 happy-path + 6 边界，每步含响应证据）"
