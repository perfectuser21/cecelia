#!/usr/bin/env bash
# post-merge-deploy.sh — Post-merge 自动部署（Harness v4.0）
# 当 Harness PR merge 到 main 后触发：Brain 重启 + health gate + 回退 + Dashboard 条件构建
#
# 用法：
#   bash scripts/post-merge-deploy.sh [TASK_ID] [CHANGED_FILES]
#   HARNESS_TASK_ID=<id> bash scripts/post-merge-deploy.sh
#   CHANGED_FILES="packages/brain/src/server.js apps/dashboard/..." bash scripts/post-merge-deploy.sh

set -uo pipefail

BRAIN_BASE_URL="http://localhost:5221"
HEALTH_TIMEOUT=60
TASK_ID="${1:-${HARNESS_TASK_ID:-}}"
CHANGED_FILES="${2:-${CHANGED_FILES:-}}"
PREVIOUS_COMMIT="${ROLLBACK_COMMIT:-HEAD~1}"

echo "=== Post-Merge 自动部署 ==="
echo "  TASK_ID : ${TASK_ID:-<none>}"
echo "  TIMEOUT : ${HEALTH_TIMEOUT}s"

_patch_brain() {
  local status="$1"
  local msg="$2"
  if [ -n "$TASK_ID" ]; then
    curl -sf -X PATCH "${BRAIN_BASE_URL}/api/brain/tasks/${TASK_ID}" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"${status}\",\"result\":{\"message\":\"${msg}\"}}" \
      >/dev/null 2>&1 || true
  fi
}

_restart_brain() {
  echo "[deploy] 重启 Brain..."
  if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q brain; then
    pm2 restart brain
  elif command -v systemctl >/dev/null 2>&1 && systemctl is-enabled cecelia-brain.service >/dev/null 2>&1; then
    systemctl restart cecelia-brain.service
  else
    bash "$(dirname "$0")/brain-reload.sh" 2>/dev/null || true
  fi
}

_restart_brain

echo "[deploy] 轮询 health check（超时 ${HEALTH_TIMEOUT}s）..."
POLL_INTERVAL=5
HEALTH_PASSED=false
ELAPSED=0

for attempt in $(seq 1 $((HEALTH_TIMEOUT / POLL_INTERVAL))); do
  sleep "$POLL_INTERVAL"
  ELAPSED=$((attempt * POLL_INTERVAL))
  if curl -sf --max-time 5 "http://localhost:5221/api/brain/health" >/dev/null 2>&1; then
    HEALTH_PASSED=true
    echo "[deploy] Health check 通过（${ELAPSED}s）"
    break
  fi
  echo "[deploy] 等待中 ${ELAPSED}/${HEALTH_TIMEOUT}s..."
done

if [ "$HEALTH_PASSED" = "false" ]; then
  echo "[deploy] ❌ Health check 超时，开始回退..."
  git reset --hard "${PREVIOUS_COMMIT}" 2>/dev/null || git revert --no-edit HEAD 2>/dev/null || true
  _restart_brain
  _patch_brain "failed" "Health check timeout after ${HEALTH_TIMEOUT}s, rolled back"
  echo "[deploy] 回退完成，Brain 失败状态已回写"
  exit 1
fi

_patch_brain "deployed" "Brain deployed and healthy"
echo "[deploy] ✅ Brain 部署成功，已回写 deployed 状态"

if echo "${CHANGED_FILES}" | grep -q "apps/dashboard"; then
  echo "[deploy] 检测到 apps/dashboard 变更，开始构建..."
  cd "$(dirname "$0")/../apps/dashboard" && npm run build
  echo "[deploy] Dashboard 构建完成"
fi

echo "=== 部署完成 ==="
