#!/usr/bin/env bash
# blocking-state-ttl-selfheal-smoke.sh
#
# 真环境 smoke：阻断类状态位 TTL 自愈 + 健康检查可见性（PRD 08111700，P0 hotfix）。
# 对真起的 Brain 容器（localhost:5221）+ 真 cecelia_test DB 验证健康检查红线——
# 存在活跃阻断位（tick_draining）时 /api/brain/alertness 必须返回非空 blocking_states 且不报 healthy。
#
# 事故实证：tick_draining 卡 2h20m 期间 /api/brain/alertness 仍报 CALM / healthy，
# 健康检查完全看不见静默停摆。本 smoke 把「有阻断位却报 healthy」钉成失败。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
KEY="tick_draining"
psql_exec() { psql -v ON_ERROR_STOP=1 -qtA -c "$1"; }
cleanup() { psql_exec "DELETE FROM working_memory WHERE key = '${KEY}';" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[smoke] 1) 基线：/api/brain/alertness 必须带 blocking_states 数组 + healthy 字段"
cleanup
BASE=$(curl -sf --max-time 15 "${BRAIN_URL}/api/brain/alertness")
echo "$BASE" | jq -e 'has("blocking_states") and (.blocking_states | type == "array")' >/dev/null \
  || { echo "❌ 响应缺 blocking_states 数组"; echo "$BASE"; exit 1; }
echo "$BASE" | jq -e 'has("healthy") and has("blocked")' >/dev/null \
  || { echo "❌ 响应缺 healthy/blocked 判读字段"; echo "$BASE"; exit 1; }
echo "$BASE" | jq -e '.healthy == true and .blocked == false' >/dev/null \
  || { echo "❌ 无阻断位时应 healthy=true/blocked=false"; echo "$BASE"; exit 1; }

echo "[smoke] 2) 置入活跃阻断位 tick_draining（模拟排空卡住）"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
psql_exec "INSERT INTO working_memory (key, value_json, updated_at)
           VALUES ('${KEY}', '{\"draining\":true,\"drain_started_at\":\"${NOW}\"}'::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW();" >/dev/null

echo "[smoke] 3) 健康检查红线：存在阻断位时不得报 healthy，必须列出 draining + 时长"
BLOCKED=$(curl -sf --max-time 15 "${BRAIN_URL}/api/brain/alertness")
echo "$BLOCKED" | jq -e '.blocking_states | map(.key) | index("tick_draining") != null' >/dev/null \
  || { echo "❌ blocking_states 未包含 tick_draining"; echo "$BLOCKED"; exit 1; }
echo "$BLOCKED" | jq -e '.blocking_states[] | select(.key=="tick_draining") | .duration_ms | type == "number"' >/dev/null \
  || { echo "❌ tick_draining 缺 duration_ms 持续时长"; echo "$BLOCKED"; exit 1; }
echo "$BLOCKED" | jq -e '.blocked == true and .healthy == false' >/dev/null \
  || { echo "❌ 红线违规：有阻断位却报 healthy/未标 blocked"; echo "$BLOCKED"; exit 1; }

echo "[smoke] 4) 清除阻断位后恢复 healthy"
cleanup
RECOVERED=$(curl -sf --max-time 15 "${BRAIN_URL}/api/brain/alertness")
echo "$RECOVERED" | jq -e '.healthy == true and (.blocking_states | map(.key) | index("tick_draining") == null)' >/dev/null \
  || { echo "❌ 清除阻断位后应恢复 healthy"; echo "$RECOVERED"; exit 1; }

echo "✅ blocking-state-ttl-selfheal smoke PASS — 健康检查能看见静默停摆，阻断位可判读"
