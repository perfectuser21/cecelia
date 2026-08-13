#!/usr/bin/env bash
# journey_id 写入入口冒烟：POST /tasks 顶层 journey_id 合并 + POST /issues journey_id 持久化
# 覆盖：task-tasks.js / journeys.js POST /issues / warroom.js 全景图 issues 查询
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
BASE_SHA="$(git rev-parse HEAD)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── journey_id entry points smoke ──"

# 自建 throwaway journey，不依赖 seed 数据，CI 空库也能跑
JID=$(curl -sf -X POST "$BRAIN/api/brain/journeys" -H 'Content-Type: application/json' \
  -d '{"name":"[smoke] journey-id-entry journey","journey_type":"autonomous","status":"active"}' \
  | jq -r '.id // empty')
[ -n "$JID" ] && ok "throwaway journey=$JID" || { fail "创建 journey 失败"; echo "PASS:$PASS FAIL:$FAIL"; exit 1; }

# POST /tasks 顶层 journey_id 应自动合并进 payload.journey_id
TASK_RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" -H 'Content-Type: application/json' \
  -d "{\"title\":\"[smoke] journey-id task\",\"task_type\":\"dev\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\",\"journey_id\":\"$JID\"}")
echo "$TASK_RESP" | jq -e --arg jid "$JID" '.payload.journey_id == $jid' >/dev/null 2>&1 \
  && ok "POST /tasks 顶层 journey_id 合并进 payload" || fail "task payload.journey_id 未写入"

# POST /issues 应持久化 journey_id 到真实列
ISSUE_RESP=$(curl -sf -X POST "$BRAIN/api/brain/issues" -H 'Content-Type: application/json' \
  -d "{\"title\":\"[smoke] journey-id issue\",\"priority\":\"P2\",\"journey_id\":\"$JID\"}")
ISSUE_ID=$(echo "$ISSUE_RESP" | jq -r '.id // empty')
echo "$ISSUE_RESP" | jq -e --arg jid "$JID" '.journey_id == $jid' >/dev/null 2>&1 \
  && ok "POST /issues journey_id 持久化" || fail "issue journey_id 未写入"

# warroom 全景图应能通过真实列查到刚建的 open issue
CMD_RESP=$(curl -sf "$BRAIN/api/brain/warroom/line/$JID/command")
echo "$CMD_RESP" | jq -e --arg iid "$ISSUE_ID" '.connections.open_issues | any(.id == $iid)' >/dev/null 2>&1 \
  && ok "warroom 全景图查到该 issue（真实列，非 payload）" || fail "warroom open_issues 未关联到该 issue"

echo ""
echo "PASS:$PASS FAIL:$FAIL"
[ "$FAIL" -eq 0 ]
