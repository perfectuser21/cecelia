#!/usr/bin/env bash
# gate3-trigger-deploy.sh — 触发一次 Brain HTTP 部署 webhook（Gate3 首次触发与重触发共用）
#
# 用法：DEPLOY_TOKEN=... bash scripts/ci/gate3-trigger-deploy.sh <brain_url>
# stdout：只输出 HTTP 状态码（curl 失败为 000）；响应体打印到 stderr 便于排查。
set -uo pipefail

BRAIN_URL="${1:?用法: gate3-trigger-deploy.sh <brain_url>}"
TARGET_SHA="${2:-${GITHUB_SHA:-}}"
PAYLOAD='{}'
if [[ -n "$TARGET_SHA" ]]; then
  [[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "非法 target_sha" >&2; exit 1; }
  PAYLOAD=$(jq -nc --arg sha "$TARGET_SHA" '{sha:$sha}')
fi
REQUEST_BUDGET="${3:-60}"
[[ "$REQUEST_BUDGET" =~ ^[0-9]+$ ]] && [ "$REQUEST_BUDGET" -gt 0 ] && [ "$REQUEST_BUDGET" -le 60 ] || exit 1
CONNECT_BUDGET=30; [ "$REQUEST_BUDGET" -ge 30 ] || CONNECT_BUDGET="$REQUEST_BUDGET"
RESP_FILE="$(mktemp)"
trap 'rm -f "$RESP_FILE"' EXIT

HTTP_CODE=$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
  -X POST "${BRAIN_URL}/api/brain/deploy" \
  -H "Authorization: Bearer ${DEPLOY_TOKEN:-}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --connect-timeout "$CONNECT_BUDGET" --max-time "$REQUEST_BUDGET" 2>/dev/null) || HTTP_CODE="000"

cat "$RESP_FILE" >&2 2>/dev/null || true
echo "" >&2
echo "$HTTP_CODE"
