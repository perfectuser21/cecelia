#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="cecelia-node-brain"
STATE_FILE="/tmp/brain-keepalive.alerting"
WEBHOOK_URL="${FEISHU_BOT_WEBHOOK:-}"
LOG_PREFIX="[brain-keepalive]"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

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
    echo "$LOG_PREFIX Brain not running (status=$STATUS), attempting restart..."
    if ! docker info >/dev/null 2>&1; then
      echo "$LOG_PREFIX WARN: docker daemon unavailable, cannot restart"
      send_feishu "🚨 [P0] Brain 容器已停止且 Docker daemon 不可用，需人工介入"
      touch "$STATE_FILE"
      exit 0
    fi
    docker compose -f "$COMPOSE_FILE" up -d node-brain 2>&1 || true
    sleep 15
    NEW_STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")
    if [[ "$NEW_STATUS" == "running" ]]; then
      echo "$LOG_PREFIX AUTO-RESTARTED: $CONTAINER_NAME is now running"
      send_feishu "✅ Brain 容器已自动重启恢复"
    else
      echo "$LOG_PREFIX ALERT: restart failed, $CONTAINER_NAME still $NEW_STATUS — sending P0"
      send_feishu "🚨 [P0] Brain 容器已停止且自动重启失败（status=${NEW_STATUS}）\n请手动检查：docker compose -f $COMPOSE_FILE up -d node-brain"
      touch "$STATE_FILE"
    fi
  else
    echo "$LOG_PREFIX SILENCED: restart already attempted, container still $STATUS"
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
