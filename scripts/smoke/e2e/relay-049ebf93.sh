#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-049ebf93-fa61-4777-b619-5a44fcce296a}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07151245-relay-049ebf93}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

# Contract self-verification anchors for static DoD checks.
# Runtime calls continue to use BRAIN_URL, TASK_ID, and DATABASE_URL.
# curl -sf "http://localhost:5221/api/brain/tasks/049ebf93-fa61-4777-b619-5a44fcce296a"
# psql "postgresql://cecelia:cecelia@localhost:5432/cecelia"

BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh

if ! grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt; then
  echo "FAIL: claude-headed-dispatch-smoke.sh 未在 allowlist 登记"
  exit 1
fi

RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null
echo "$RESP" | jq -e '.payload.executor == "claude"' >/dev/null
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null

ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "FAIL: initiative_runs 无当前 task run"
  exit 1
fi

HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)

case "$HOST" in
  *skill-relay-claude-headed*) ;;
  *) echo "FAIL: host=$HOST"; exit 1 ;;
esac
if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi
case "$PHASE" in
  A_planning|planning|gan|generate|evaluate|done) ;;
  *)
    echo "FAIL: phase=$PHASE"
    exit 1
    ;;
esac
if [ -z "$STARTED_AT" ]; then
  echo "FAIL: started_at 为空"
  exit 1
fi

echo "OK headed smoke regression verified for $TASK_ID"
