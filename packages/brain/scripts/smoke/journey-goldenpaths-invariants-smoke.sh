#!/usr/bin/env bash
# journey-goldenpaths-invariants-smoke.sh
# 真环境 smoke：验证 A1 P0 两个只读端点全链路（harness 验证模型重构 HANDOFF 第 5 节）。
#   1. GET /journeys/:journey_id/golden-paths — golden_path 旧表已退役（任务 7d312fd8），默认 410
#   2. GET /invariants — 干净的 invariant 读取端点（读 decisions 表，非 decision_log）
# 跑法：BRAIN=http://localhost:5221 DB_URL=postgresql://localhost/cecelia bash $0
set -euo pipefail

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"; then
  exit 0
fi

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

echo "[smoke] 夹具：journey → journey_feature(ability)（端点 2 target 过滤用）"
JOURNEY_ID=$(uuid "INSERT INTO journeys (name) VALUES ('gp-agg-smoke-journey-' || gen_random_uuid()) RETURNING id")
ABILITY_ID=$(uuid "INSERT INTO journey_features (name, journey_id, kind, status) VALUES ('gp-agg-smoke-ability', '$JOURNEY_ID', 'ability', 'done') RETURNING id")
echo "  JOURNEY_ID=$JOURNEY_ID ABILITY_ID=$ABILITY_ID"

echo "[smoke] === 端点 1：GET /journeys/:jid/golden-paths —— golden_path 旧表已退役（任务 7d312fd8），默认 410 ==="
req GET "$BRAIN/api/brain/journeys/$JOURNEY_ID/golden-paths"
[ "$CODE" = "410" ] || { echo "FAIL: 期望 410 got $CODE"; exit 1; }
echo "$BODY" | jq -e '.retired==true and .path_kind=="read" and .legacy_read_env=="GOLDEN_PATH_LEGACY_READ=1"' >/dev/null \
  || { echo "FAIL: 410 体不符"; exit 1; }
echo "  ✓ 410 retired + 放行 env 提示"

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

echo "✅ journey-goldenpaths-invariants-smoke 全链路通过（端点 1 退役 410 + 端点 2 happy-path/边界，每步含响应证据）"
