#!/usr/bin/env bash
# brain-reload.sh — Brain 服务快速重启
#
# 用途：重启 Brain 服务（不重建镜像）
#   - 适用于：配置变更、环境变量更新、挂载文件修改
#   - 代码变更（packages/brain/**）请用 brain-deploy.sh
#
# 支持模式：
#   - Docker: docker compose restart node-brain
#   - launchd (macOS): launchctl kickstart -k gui/<uid>/com.cecelia.brain
#
# 用法：
#   bash scripts/brain-reload.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HEALTH_URL="http://localhost:5221/api/brain/health"

# ── 重启模式检测 ──────────────────────────────────────────────────────────────
LAUNCHD_SERVICE="com.cecelia.brain"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_SERVICE}.plist"
RELOAD_MODE="docker"

if ! docker info >/dev/null 2>&1 || ! docker inspect cecelia-node-brain >/dev/null 2>&1; then
    if [[ -f "$LAUNCHD_PLIST" ]]; then
        RELOAD_MODE="launchd"
    fi
fi

echo "=== Brain 快速重启 (mode=${RELOAD_MODE}) ==="
echo ""

# ── 执行重启 ──────────────────────────────────────────────────────────────────

if [[ "$RELOAD_MODE" == "docker" ]]; then
    CONTAINER="cecelia-node-brain"
    if ! docker inspect "$CONTAINER" &>/dev/null; then
      echo "[ERROR] 容器 $CONTAINER 不存在"
      echo "  请先运行 bash scripts/brain-deploy.sh 完整部署"
      exit 1
    fi

    echo "[1/2] 重启容器 $CONTAINER..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" restart node-brain

elif [[ "$RELOAD_MODE" == "launchd" ]]; then
    echo "[1/2] 通过 launchd 重启 Brain..."
    launchctl kickstart -k "gui/$(id -u)/${LAUNCHD_SERVICE}"
fi

echo ""

# ── 等待健康检查 ──────────────────────────────────────────────────────────────

echo "[2/2] 等待健康检查..."
TRIES=0
MAX_TRIES=12
while [ $TRIES -lt $MAX_TRIES ]; do
  sleep 5
  TRIES=$((TRIES + 1))
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo ""
    echo "=== Brain 重启成功 (${RELOAD_MODE}) ==="
    echo "  版本: $(curl -s $HEALTH_URL | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("version","unknown"))' 2>/dev/null || echo 'unknown')"
    exit 0
  fi
  echo "  等待中 ${TRIES}/${MAX_TRIES}..."
done

echo ""
echo "[ERROR] 健康检查超时（60s）"
if [[ "$RELOAD_MODE" == "docker" ]]; then
    echo "  查看日志：docker logs cecelia-node-brain --tail 50"
else
    echo "  查看日志：tail -50 $ROOT_DIR/logs/brain-error.log"
fi
exit 1
