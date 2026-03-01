#!/usr/bin/env bash
# brain-reload.sh — Brain 服务快速重启
#
# 用途：重启 Brain 容器（不重建镜像）
#   - 适用于：配置变更、环境变量更新、挂载文件修改
#   - 代码变更（packages/brain/**）请用 brain-deploy.sh
#
# 用法：
#   bash scripts/brain-reload.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTAINER="cecelia-node-brain"
HEALTH_URL="http://localhost:5221/api/brain/health"

echo "=== Brain 快速重启 ==="
echo ""

# 检查容器是否存在
if ! docker inspect "$CONTAINER" &>/dev/null; then
  echo "[ERROR] 容器 $CONTAINER 不存在"
  echo "  请先运行 bash scripts/brain-deploy.sh 完整部署"
  exit 1
fi

echo "[1/2] 重启容器 $CONTAINER..."
docker compose -f "$ROOT_DIR/docker-compose.yml" restart node-brain
echo ""

echo "[2/2] 等待健康检查..."
TRIES=0
MAX_TRIES=12
while [ $TRIES -lt $MAX_TRIES ]; do
  sleep 5
  TRIES=$((TRIES + 1))
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo ""
    echo "=== Brain 重启成功 ==="
    echo "  版本: $(curl -s $HEALTH_URL | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("version","unknown"))' 2>/dev/null || echo 'unknown')"
    exit 0
  fi
  echo "  等待中 ${TRIES}/${MAX_TRIES}..."
done

echo ""
echo "[ERROR] 健康检查超时（60s）"
echo "  查看日志：docker logs $CONTAINER --tail 50"
exit 1
