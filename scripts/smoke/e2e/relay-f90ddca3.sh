#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-f90ddca3-396d-45b2-ad13-2dfbd9e15080}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07241038-relay-f90ddca3}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

echo "── Step 1: 复用 claude-headed-dispatch-smoke.sh + allowlist 登记确认 ──"
BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || { echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 精确登记"; exit 1; }
echo "OK Step 1"

echo "── Step 2: Brain API task payload 校验 + 敏感字段脱敏断言 ──"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID") || { echo "FAIL: Brain task 不可达或不存在 task_id=$TASK_ID"; exit 1; }
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null || { echo "FAIL: task id 不匹配"; exit 1; }
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null || { echo "FAIL: payload.mode != headed"; exit 1; }
echo "$RESP" | jq -e '.payload.executor == "claude"' >/dev/null || { echo "FAIL: payload.executor != claude"; exit 1; }
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null || { echo "FAIL: payload.orchestrator != skill-relay"; exit 1; }
echo "$RESP" | jq -e '.payload.journey_id | type == "string" and length > 0' >/dev/null || { echo "FAIL: payload.journey_id 缺失或为空"; exit 1; }
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null || { echo "FAIL: payload 含敏感字段明文"; exit 1; }
echo "OK Step 2"

echo "── Step 3: DB initiative_runs 定点核对(EXISTS 语义, 容忍历史 failed 行) ──"
ANYROW=$(psql "$DB" -XAt -c "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' LIMIT 1")
[ -n "$ANYROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
GOODPHASE=$(psql "$DB" -XAt -c "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_host='skill-relay-claude-headed' AND phase IN ('A_planning','planning','gan','generate','evaluate','done') AND phase NOT IN ('failed','unknown') ORDER BY started_at DESC LIMIT 1")
[ -n "$GOODPHASE" ] || { echo "FAIL: initiative_runs 存在记录但无合法 phase 记录(host 精确匹配+phase 合法非 failed/unknown)"; exit 1; }
echo "OK Step 3 (legal phase=$GOODPHASE)"

echo "PASS: headed relay 回归证据全部验证通过 task_id=$TASK_ID"
