#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="cecelia-node-brain"
STATE_FILE="/tmp/brain-keepalive.alerting"
WEBHOOK_URL="${FEISHU_BOT_WEBHOOK:-}"
LOG_PREFIX="[brain-keepalive]"

send_feishu() {
  local msg="$1"
  if [[ -z "$WEBHOOK_URL" ]]; then
    echo "$LOG_PREFIX [WARN] FEISHU_BOT_WEBHOOK not set, skipping alert"
    return 0
  fi
  curl -s -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$msg\"}}" \
    --max-time 10 || echo "$LOG_PREFIX [WARN] feishu send failed"
}

STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")

if [[ "$STATUS" != "running" ]]; then
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX ALERT: $CONTAINER_NAME status=$STATUS — sending P0"
    send_feishu "🚨 [P0] Brain 容器已停止（status=${STATUS}）\n需立即检查：docker compose up -d node-brain"
    touch "$STATE_FILE"
  else
    echo "$LOG_PREFIX SILENCED: already alerted, container still $STATUS"
  fi
else
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX RECOVERED: $CONTAINER_NAME is running again"
    send_feishu "✅ Brain 容器已恢复运行"
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX OK: $CONTAINER_NAME is running"
  fi
fi
