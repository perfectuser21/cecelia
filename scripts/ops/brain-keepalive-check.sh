#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="cecelia-node-brain"
STATE_FILE="/tmp/brain-keepalive.alerting"
DAEMON_STATE_FILE="/tmp/brain-keepalive-daemon.alerting"
SILENCED_TTL=300    # 5 分钟后重试重启
DAEMON_TTL=600      # 10 分钟后重新发 daemon 不可用告警
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

file_age_seconds() {
  local file="$1"
  local now mtime
  now=$(date +%s)
  mtime=$(stat -f %m "$file" 2>/dev/null || echo 0)
  echo $((now - mtime))
}

STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")

if [[ "$STATUS" != "running" ]]; then
  if ! docker info >/dev/null 2>&1; then
    # Docker daemon 不可用 — 用独立 DAEMON_STATE_FILE（TTL 10 分钟），不触碰主 STATE_FILE
    if [[ ! -f "$DAEMON_STATE_FILE" ]] || [[ $(file_age_seconds "$DAEMON_STATE_FILE") -gt $DAEMON_TTL ]]; then
      echo "$LOG_PREFIX WARN: docker daemon unavailable, cannot restart Brain"
      send_feishu "🚨 [P0] Brain 容器已停止且 Docker daemon 不可用，需人工介入"
      touch "$DAEMON_STATE_FILE"
    else
      echo "$LOG_PREFIX SILENCED (daemon): docker daemon still unavailable, $(file_age_seconds "$DAEMON_STATE_FILE")s since last alert"
    fi
    exit 0
  fi

  # Docker daemon 可用 — 清除 daemon state
  rm -f "$DAEMON_STATE_FILE"

  # SILENCED TTL 检查：STATE_FILE 存在且未过期 → 继续静默
  if [[ -f "$STATE_FILE" ]] && [[ $(file_age_seconds "$STATE_FILE") -le $SILENCED_TTL ]]; then
    echo "$LOG_PREFIX SILENCED: restart already attempted, container still $STATUS ($(file_age_seconds "$STATE_FILE")s < ${SILENCED_TTL}s TTL)"
    exit 0
  fi

  # STATE_FILE 过期或不存在 → 尝试重启
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX Re-attempting restart after TTL expiry..."
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX Brain not running (status=$STATUS), attempting restart..."
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
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX RECOVERED: $CONTAINER_NAME is running again"
    send_feishu "✅ Brain 容器已恢复运行"
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX OK: $CONTAINER_NAME is running"
  fi
  rm -f "$DAEMON_STATE_FILE"
fi
