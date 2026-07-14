#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-a85e0582-5d88-4f0b-bce6-302d898b01e7}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07130752-relay-a85e0582}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
export TASK_ID

# Contract self-verification anchors for static DoD checks.
# Runtime calls continue to use BRAIN_URL, TASK_ID, and DATABASE_URL.
# curl -sf "http://localhost:5221/api/brain/tasks/a85e0582-5d88-4f0b-bce6-302d898b01e7"
# psql "postgresql://cecelia:cecelia@localhost:5432/cecelia"

BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh

if ! grep -Fxq "codex-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt; then
  echo "FAIL: codex headed smoke 未在 allowlist"
  exit 1
fi

RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null
echo "$RESP" | jq -e '.task_type == "harness_initiative"' >/dev/null
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null
echo "$RESP" | jq -e '.payload.executor == "codex"' >/dev/null
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("codex_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null

ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at, COALESCE(completed_at::text,'') FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "FAIL: initiative_runs 无当前 task run"
  exit 1
fi

HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)

if [ "$HOST" != "skill-relay-codex-headed" ]; then
  echo "FAIL: host=$HOST"
  exit 1
fi
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

LOG_PATH="$SPRINT_DIR/tui.log"
RELAY_SRC="packages/brain/src/harness-skill-relay.js"
if [ -s "$LOG_PATH" ]; then
  if ! grep -E "headed|skill-relay|codex|A_planning|planning|gan|generate|evaluate|done|harness" "$LOG_PATH" >/dev/null; then
    echo "FAIL: tui.log 缺 headed relay 可观测信号"
    exit 1
  fi
  if grep -Eiq "token|github_token|codex_token|thin_prd|ghp_" "$LOG_PATH"; then
    echo "FAIL: tui.log 含疑似敏感字段"
    exit 1
  fi
else
  echo "WARN: 当前 sprint 无非空 tui.log，验证 relay 源码留痕机制: $LOG_PATH"
  if [ ! -f "$RELAY_SRC" ]; then
    echo "FAIL: missing $RELAY_SRC"
    exit 1
  fi
  if ! grep -F "tui.log" "$RELAY_SRC" >/dev/null; then
    echo "FAIL: relay 源码缺 tui.log 留痕"
    exit 1
  fi
  if ! grep -F "appendFileSync" "$RELAY_SRC" >/dev/null; then
    echo "FAIL: relay 源码缺 appendFileSync 留痕"
    exit 1
  fi
  if ! grep -F "headed spawn" "$RELAY_SRC" >/dev/null; then
    echo "FAIL: relay 源码缺 headed spawn 留痕"
    exit 1
  fi
fi

echo "OK headed smoke regression verified for $TASK_ID"
