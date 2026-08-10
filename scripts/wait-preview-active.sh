#!/usr/bin/env bash
set -euo pipefail

: "${BRAIN_URL:?BRAIN_URL is required}"
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"
: "${BRANCH_NAME:?BRANCH_NAME is required}"
: "${EXPECTED_PORT:?EXPECTED_PORT is required}"

CURL_BIN="${CURL_BIN:-curl}"
REQUEST_SCRIPT="${REQUEST_PREVIEW_START_SCRIPT:-scripts/request-preview-start.sh}"
SLEEP_BIN="${SLEEP_BIN:-sleep}"
MAX_WAIT="${PREVIEW_WAIT_MAX_SECONDS:-600}"
INTERVAL="${PREVIEW_WAIT_INTERVAL_SECONDS:-10}"
LAST_UPTIME="${PREVIEW_INITIAL_BRAIN_UPTIME:-}"
MAX_REISSUES="${PREVIEW_RESTART_MAX_REISSUES:-3}"
ELAPSED=0
REISSUES=0

for value in "$MAX_WAIT" "$INTERVAL" "$MAX_REISSUES"; do
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "preview wait settings must be positive integers" >&2
    exit 2
  fi
done

json_field() {
  local field="$1"
  python3 -c "import sys,json; print(json.load(sys.stdin).get('${field}',''))" 2>/dev/null
}

while (( ELAPSED < MAX_WAIT )); do
  STATUS=$("$CURL_BIN" -sS -f --connect-timeout 5 --max-time 10 \
    "${BRAIN_URL}/api/brain/preview/status/${PR_NUMBER}" 2>/dev/null \
    | json_field status || true)
  echo "[${ELAPSED}s] preview status=${STATUS}"
  if [[ "$STATUS" == "active" ]]; then
    exit 0
  fi
  if [[ "$STATUS" == "failed" || "$STATUS" == "inactive" ]]; then
    echo "preview entered terminal status: ${STATUS}" >&2
    exit 1
  fi

  CURRENT_UPTIME=$("$CURL_BIN" -sS -f --connect-timeout 5 --max-time 10 \
    "${BRAIN_URL}/api/brain/health" 2>/dev/null \
    | json_field uptime_seconds || true)

  if [[ "$LAST_UPTIME" =~ ^[0-9]+$ && "$CURRENT_UPTIME" =~ ^[0-9]+$ ]] \
    && (( CURRENT_UPTIME < LAST_UPTIME )); then
    if (( REISSUES >= MAX_REISSUES )); then
      echo "production Brain restarted more than ${MAX_REISSUES} times" >&2
      exit 1
    fi
    echo "production Brain restart detected: uptime ${LAST_UPTIME} -> ${CURRENT_UPTIME}; reissuing preview start"
    RESPONSE=$(bash "$REQUEST_SCRIPT")
    REISSUED_PORT=$(printf '%s' "$RESPONSE" | json_field port || true)
    if [[ "$REISSUED_PORT" != "$EXPECTED_PORT" ]]; then
      echo "preview restart returned unexpected port: ${REISSUED_PORT}" >&2
      exit 1
    fi
    REISSUES=$((REISSUES + 1))
  fi

  if [[ "$CURRENT_UPTIME" =~ ^[0-9]+$ ]]; then
    LAST_UPTIME="$CURRENT_UPTIME"
  fi
  "$SLEEP_BIN" "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "preview did not become active within ${MAX_WAIT}s" >&2
exit 1
