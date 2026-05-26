#!/usr/bin/env bash
# Keepalive for cecelia-bridge (port 3457). Mirrors brain-keepalive pattern.
set -euo pipefail

BRIDGE_URL="http://localhost:3457/health"
STATE_FILE="/tmp/bridge-keepalive.alerting"
SILENCED_TTL=300       # 5 分钟后重试
HEALTH_TIMEOUT=3       # health check 超时秒数
RESTART_WAIT=5         # 重启后等待秒数
WEBHOOK_URL="${FEISHU_BOT_WEBHOOK:-}"
LOG_PREFIX="[bridge-keepalive]"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRIDGE_SCRIPT="$REPO_ROOT/packages/brain/scripts/cecelia-bridge.cjs"
BRIDGE_LOG="/tmp/bridge-keepalive-spawn.log"
BRIDGE_PLIST_LABEL="com.cecelia.bridge"
USER_ID=$(id -u)

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

is_bridge_healthy() {
  curl -sf --max-time "$HEALTH_TIMEOUT" "$BRIDGE_URL" >/dev/null 2>&1
}

attempt_restart() {
  # 优先尝试 launchctl kickstart（利用已有 plist）
  echo "$LOG_PREFIX Trying launchctl kickstart gui/${USER_ID}/${BRIDGE_PLIST_LABEL}..."
  if launchctl kickstart "gui/${USER_ID}/${BRIDGE_PLIST_LABEL}" 2>/dev/null; then
    sleep "$RESTART_WAIT"
    if is_bridge_healthy; then
      echo "$LOG_PREFIX RESTARTED via launchctl"
      return 0
    fi
    echo "$LOG_PREFIX launchctl kickstart 后仍不健康，尝试 direct spawn..."
  else
    echo "$LOG_PREFIX launchctl kickstart 失败，尝试 direct spawn..."
  fi

  # Fallback: 杀掉旧进程，直接 spawn
  pkill -f "cecelia-bridge.cjs" 2>/dev/null || true
  sleep 1
  NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
  nohup "$NODE_BIN" "$BRIDGE_SCRIPT" >> "$BRIDGE_LOG" 2>&1 &
  sleep "$RESTART_WAIT"
  if is_bridge_healthy; then
    echo "$LOG_PREFIX RESTARTED via direct spawn"
    return 0
  fi

  return 1
}

# ── Main ──────────────────────────────────────────────

if is_bridge_healthy; then
  if [[ -f "$STATE_FILE" ]]; then
    echo "$LOG_PREFIX RECOVERED: bridge is healthy again"
    send_feishu "✅ cecelia-bridge 已恢复健康（http://localhost:3457）"
    rm -f "$STATE_FILE"
  else
    echo "$LOG_PREFIX OK: bridge is healthy"
  fi
  exit 0
fi

# Bridge 不健康 — 检查 SILENCED TTL
if [[ -f "$STATE_FILE" ]] && [[ $(file_age_seconds "$STATE_FILE") -le $SILENCED_TTL ]]; then
  echo "$LOG_PREFIX SILENCED: restart already attempted, bridge still unhealthy ($(file_age_seconds "$STATE_FILE")s < ${SILENCED_TTL}s TTL)"
  exit 0
fi

# STATE_FILE 过期或不存在 → 尝试重启
if [[ -f "$STATE_FILE" ]]; then
  echo "$LOG_PREFIX Re-attempting restart after TTL expiry..."
  rm -f "$STATE_FILE"
else
  echo "$LOG_PREFIX Bridge unhealthy at $BRIDGE_URL, attempting restart..."
fi

if attempt_restart; then
  send_feishu "✅ cecelia-bridge 已自动重启恢复（http://localhost:3457）"
else
  echo "$LOG_PREFIX ALERT: restart failed, bridge still unhealthy — sending P0"
  send_feishu "🚨 [P0] cecelia-bridge 已停止且自动重启失败\n所有 harness_initiative 任务将以 no_executor 堆积\n请手动检查：node $BRIDGE_SCRIPT"
  touch "$STATE_FILE"
fi
