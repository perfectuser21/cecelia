#!/usr/bin/env bash
set -euo pipefail

: "${BRAIN_URL:?BRAIN_URL is required}"
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"
: "${BRANCH_NAME:?BRANCH_NAME is required}"

CURL_BIN="${CURL_BIN:-curl}"
MAX_ATTEMPTS="${PREVIEW_START_MAX_ATTEMPTS:-12}"
RETRY_DELAY_SECONDS="${PREVIEW_START_RETRY_DELAY_SECONDS:-5}"

if [[ ! "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "invalid PREVIEW_START_MAX_ATTEMPTS: ${MAX_ATTEMPTS}" >&2
  exit 2
fi
if [[ ! "$RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "invalid PREVIEW_START_RETRY_DELAY_SECONDS: ${RETRY_DELAY_SECONDS}" >&2
  exit 2
fi

payload="{\"pr_number\":${PR_NUMBER},\"branch_name\":\"${BRANCH_NAME}\"}"

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  if response=$("$CURL_BIN" -sS -f --connect-timeout 15 --max-time 30 \
    -X POST "${BRAIN_URL}/api/brain/preview/start" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEPLOY_TOKEN}" \
    -d "$payload" 2>&1); then
    printf '%s\n' "$response"
    exit 0
  fi

  echo "preview start attempt ${attempt}/${MAX_ATTEMPTS} failed: ${response}" >&2
  if (( attempt < MAX_ATTEMPTS )); then
    sleep "$RETRY_DELAY_SECONDS"
  fi
done

echo "preview start failed after ${MAX_ATTEMPTS} attempts" >&2
exit 1
