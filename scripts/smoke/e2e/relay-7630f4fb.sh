#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-7630f4fb-0acf-4f7a-ad42-e2dea3485089}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07212136-relay-7630f4fb}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

echo "── Step 1: 复用 claude-headed-dispatch-smoke.sh + allowlist 登记确认 ──"
BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh
grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || { echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 精确登记"; exit 1; }
echo "OK Step 1"

echo "── Step 2: Brain API task payload 校验 + 敏感字段脱敏断言 ──"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID") || { echo "FAIL: Brain task 不可达 task_id=$TASK_ID"; exit 1; }
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null || { echo "FAIL: task id 不匹配"; exit 1; }
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null || { echo "FAIL: payload.mode != headed"; exit 1; }
echo "$RESP" | jq -e '.payload.executor == "claude"' >/dev/null || { echo "FAIL: payload.executor != claude"; exit 1; }
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null || { echo "FAIL: payload.orchestrator != skill-relay"; exit 1; }
echo "$RESP" | jq -e '.payload.journey_id | type == "string" and length > 0' >/dev/null || { echo "FAIL: payload.journey_id 缺失或为空"; exit 1; }
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null || { echo "FAIL: payload 含敏感字段明文"; exit 1; }
echo "OK Step 2"

echo "── Step 3: DB initiative_runs 定点核对 ──"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
[ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }
HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)
[ "$HOST" = "skill-relay-claude-headed" ] || { echo "FAIL: orchestrator_host=$HOST"; exit 1; }
[ "$PHASE" != "failed" ] || { echo "FAIL: phase=failed"; exit 1; }
[ "$PHASE" != "unknown" ] || { echo "FAIL: phase=unknown"; exit 1; }
case "$PHASE" in
  A_planning|planning|gan|generate|evaluate|done) ;;
  *) echo "FAIL: phase 非法枚举 phase=$PHASE"; exit 1 ;;
esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }
echo "OK Step 3"

echo "✅ PASS: headed relay 回归证据全部验证通过 task_id=$TASK_ID"
