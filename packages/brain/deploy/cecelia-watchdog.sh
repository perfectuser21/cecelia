#!/usr/bin/env bash
# Cecelia Watchdog — 每分钟检查 Brain 和 Bridge，挂了自动重启
# SSOT 位置：packages/brain/deploy/cecelia-watchdog.sh
# 部署位置：~/bin/cecelia-watchdog.sh（由 install.sh 拷贝）
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

BRAIN_DIR="/Users/administrator/perfect21/cecelia/packages/brain"
LOG_DIR="/Users/administrator/perfect21/cecelia/logs"

# Brain
if ! curl -sf http://localhost:5221/api/brain/health > /dev/null 2>&1; then
  echo "[$(TZ=Asia/Shanghai date)] Brain down, restarting..." >> "$LOG_DIR/watchdog.log"
  cd "$BRAIN_DIR"
  CECELIA_WORK_DIR=/Users/administrator/perfect21/cecelia \
  REPO_ROOT=/Users/administrator/perfect21/cecelia \
  ENV_REGION=us \
  WORKTREE_BASE=/Users/administrator/perfect21/cecelia/.claude/worktrees \
  CECELIA_RUN_PATH=/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh \
  CONSCIOUSNESS_ENABLED=false \
  BRAIN_QUIET_MODE=true \
  nohup /opt/homebrew/bin/node server.js >> "$LOG_DIR/brain.log" 2>> "$LOG_DIR/brain-error.log" &
  echo "[$(TZ=Asia/Shanghai date)] Brain restarted, PID: $!" >> "$LOG_DIR/watchdog.log"
fi

# Bridge
if ! curl -sf http://localhost:3457/health > /dev/null 2>&1; then
  echo "[$(TZ=Asia/Shanghai date)] Bridge down, restarting..." >> "$LOG_DIR/watchdog.log"
  cd "$BRAIN_DIR"
  BRAIN_URL=http://localhost:5221 \
  BRIDGE_PORT=3457 \
  nohup /opt/homebrew/bin/node scripts/cecelia-bridge.cjs >> "$LOG_DIR/bridge.log" 2>> "$LOG_DIR/bridge-error.log" &
  echo "[$(TZ=Asia/Shanghai date)] Bridge restarted, PID: $!" >> "$LOG_DIR/watchdog.log"
fi
