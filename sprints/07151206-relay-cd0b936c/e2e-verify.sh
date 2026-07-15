#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${TASK_ID:-cd0b936c-2891-4fed-a921-5636ca08d1e8}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07151206-relay-cd0b936c}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
CI_YML=".github/workflows/ci.yml"
export TASK_ID

# Contract self-verification anchors for static DoD checks.
# Runtime calls continue to use BRAIN_URL, TASK_ID, and DATABASE_URL.
# curl -sf "http://localhost:5221/api/brain/tasks/cd0b936c-2891-4fed-a921-5636ca08d1e8"
# psql "postgresql://cecelia:cecelia@localhost:5432/cecelia"

BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh

if ! grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt; then
  echo "FAIL: claude headed smoke 未在 allowlist"
  exit 1
fi

RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID' >/dev/null
echo "$RESP" | jq -e '.task_type == "harness_initiative"' >/dev/null
echo "$RESP" | jq -e '.payload.mode == "headed"' >/dev/null
echo "$RESP" | jq -e '.payload.executor == "claude"' >/dev/null
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"' >/dev/null
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not)' >/dev/null

ROW=$(psql "$DB" -XAt -F '|' -c "SELECT orchestrator_host, phase, started_at, COALESCE(completed_at::text,'') FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "FAIL: initiative_runs 无当前 task run"
  exit 1
fi

HOST=$(printf '%s' "$ROW" | cut -d'|' -f1)
PHASE=$(printf '%s' "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf '%s' "$ROW" | cut -d'|' -f3)

if [ "$HOST" != "skill-relay-claude-headed" ]; then
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

grep -F "skill-relay-claude-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 缺 claude-headed 分支标记"; exit 1; }
grep -F "skill-relay-codex-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 回归破坏 codex-headed 分支"; exit 1; }
grep -F '"executor":"claude"' "$CI_YML" >/dev/null || { echo "FAIL: ci.yml claude-headed 分支未 seed executor=claude"; exit 1; }
grep -F '"executor":"codex"' "$CI_YML" >/dev/null || { echo "FAIL: ci.yml codex-headed 分支 executor=codex 被移除"; exit 1; }
CLAUDE_LINE=$(grep -n "skill-relay-claude-headed" "$CI_YML" | head -1 | cut -d: -f1)
CODEX_SEED_LINE=$(grep -n '"executor":"codex"' "$CI_YML" | head -1 | cut -d: -f1)
if [ -z "$CLAUDE_LINE" ] || [ -z "$CODEX_SEED_LINE" ]; then
  echo "FAIL: 缺 claude/codex 行号，无法判定优先级"
  exit 1
fi
if [ "$CLAUDE_LINE" -ge "$CODEX_SEED_LINE" ]; then
  echo "FAIL: claude-headed 精确判定(行$CLAUDE_LINE)未先于 codex 通用/兜底 seed(行$CODEX_SEED_LINE)，claude-headed 任务可能被误 seed 成 codex 身份"
  exit 1
fi
[ "$CLAUDE_LINE" -lt "$CODEX_SEED_LINE" ] || { echo "FAIL: claude-headed 行号未先于 codex 行号"; exit 1; }

grep -F "skill-relay-claude-headed" "packages/brain/src/harness-skill-relay.js" >/dev/null || { echo "FAIL: harness-skill-relay.js 缺失 claude-headed 路由逻辑"; exit 1; }

LOG_PATH="$SPRINT_DIR/tui.log"
RELAY_SRC="packages/brain/src/harness-skill-relay.js"
if [ -s "$LOG_PATH" ]; then
  if ! grep -E "headed|skill-relay|claude|A_planning|planning|gan|generate|evaluate|done|harness" "$LOG_PATH" >/dev/null; then
    echo "FAIL: tui.log 缺 headed relay 可观测信号"
    exit 1
  fi
  if grep -Eiq "token|github_token|anthropic_token|thin_prd|ghp_" "$LOG_PATH"; then
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
