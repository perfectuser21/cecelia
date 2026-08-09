#!/usr/bin/env bash
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-900}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"
CURL_BIN="${CURL_BIN:-curl}"

if [[ -z "$EXPECTED_SHA" ]]; then
  echo "EXPECTED_SHA is required" >&2
  exit 64
fi
if ! [[ "$MAX_WAIT_SECONDS" =~ ^[0-9]+$ && "$POLL_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "MAX_WAIT_SECONDS and POLL_INTERVAL_SECONDS must be non-negative integers" >&2
  exit 64
fi

deadline=$((SECONDS + MAX_WAIT_SECONDS))
while (( SECONDS <= deadline )); do
  health_json=$($CURL_BIN -fsS --connect-timeout 10 --max-time 15 \
    "${BRAIN_URL}/api/brain/health" 2>/dev/null || printf '{}')
  read -r status current_sha < <(printf '%s' "$health_json" | node -e "
    let body = '';
    process.stdin.on('data', chunk => { body += chunk; });
    process.stdin.on('end', () => {
      try {
        const value = JSON.parse(body);
        console.log(String(value.status || 'unknown'), String(value.git_sha || 'missing'));
      } catch {
        console.log('invalid missing');
      }
    });
  ")
  echo "production health=${status} sha=${current_sha} expected=${EXPECTED_SHA}"
  if [[ "$status" == "healthy" && "$current_sha" == "$EXPECTED_SHA" ]]; then
    echo "production SHA ready: ${EXPECTED_SHA}"
    exit 0
  fi
  (( SECONDS >= deadline )) && break
  sleep "$POLL_INTERVAL_SECONDS"
done

echo "production SHA not ready before timeout: expected=${EXPECTED_SHA}" >&2
exit 1
