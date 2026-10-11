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
BODY_FILE="$(mktemp)"
ERR_FILE="${BODY_FILE}.err"
trap 'rm -f "$BODY_FILE" "$ERR_FILE"' EXIT

# 不用 curl -f：-f 会丢掉响应体，503 的拒绝原因（reason）进不了 CI 日志（2026-10-12 too_many_active 排查）。
# 容量类拒绝（名额满/磁盘不够）短时间重试不会好转，打印原因后以退出码 3 立即退出；
# 连接失败、5xx 及 sample_* 等采样类拒绝仍按 MAX_ATTEMPTS 重试。
CAPACITY_REASONS_RE='^(too_many_active|insufficient_free_space|usage_pct_too_high)$'

for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  : > "$BODY_FILE"
  if http_code=$("$CURL_BIN" -sS --connect-timeout 15 --max-time 30 \
    -o "$BODY_FILE" -w '%{http_code}' \
    -X POST "${BRAIN_URL}/api/brain/preview/start" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEPLOY_TOKEN}" \
    -d "$payload" 2>"$ERR_FILE"); then
    body="$(cat "$BODY_FILE")"
    if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
      printf '%s\n' "$body"
      exit 0
    fi
    reason="$(printf '%s' "$body" | sed -nE 's/.*"reason"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -1)"
    echo "preview start attempt ${attempt}/${MAX_ATTEMPTS} failed: HTTP ${http_code} reason=${reason:-unknown} body=${body}" >&2
    if [[ "$http_code" == "503" && "$reason" =~ $CAPACITY_REASONS_RE ]]; then
      echo "preview start rejected by admission (${reason}); not retrying" >&2
      exit 3
    fi
  else
    echo "preview start attempt ${attempt}/${MAX_ATTEMPTS} failed: $(cat "$ERR_FILE" 2>/dev/null)" >&2
  fi

  if (( attempt < MAX_ATTEMPTS )); then
    sleep "$RETRY_DELAY_SECONDS"
  fi
done

echo "preview start failed after ${MAX_ATTEMPTS} attempts" >&2
exit 1
