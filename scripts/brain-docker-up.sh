#!/usr/bin/env bash
# Brain 从 launchd 裸跑 → OrbStack Docker 容器运行
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="/Library/LaunchDaemons/com.cecelia.brain.plist"

echo "=== Brain Docker 切换：从裸跑 → 容器 ==="

# 1. 卸两个 scope 的 launchd 裸跑 Brain
#    历史遗留：system LaunchDaemons + user LaunchAgents 都注册了 Brain plist，
#    任一未卸都会让 KeepAlive 把裸跑 Brain 拉回来抢 5221 端口。
USER_PLIST="$HOME/Library/LaunchAgents/com.cecelia.brain.plist"

echo "→ 卸 user scope Brain plist"
launchctl unload "$USER_PLIST" 2>/dev/null || echo "  (user scope 已未加载)"

echo "→ 卸 system scope Brain plist"
sudo launchctl unload "$PLIST" 2>/dev/null || echo "  (system scope 已未加载)"

# 2. 等端口 5221 释放（最多 15 秒）
echo "→ 等端口 5221 释放..."
for i in {1..15}; do
  if ! lsof -i :5221 -t >/dev/null 2>&1; then
    echo "  ✅ 端口已释放 (${i}s)"
    break
  fi
  sleep 1
  if [ "$i" -eq 15 ]; then
    echo "  ❌ 端口 5221 15 秒内没释放，其他进程占用"
    lsof -i :5221 | head
    exit 1
  fi
done

# 3. 起 Docker Brain 容器（--force-recreate 确保 compose 配置改动生效，不复用旧容器）
echo "→ docker-compose up -d --force-recreate node-brain"
cd "$ROOT_DIR"
docker-compose up -d --force-recreate node-brain

# 4. 等容器 healthy（最多 90 秒 — 含 40s start_period + migration 时间）
echo "→ 等容器 healthy..."
for i in {1..90}; do
  STATUS=$(docker inspect --format '{{.State.Health.Status}}' cecelia-node-brain 2>/dev/null || echo "missing")
  if [ "$STATUS" = "healthy" ]; then
    echo "  ✅ Brain 容器 healthy (${i}s)"
    docker ps --filter name=cecelia-node-brain --format '  {{.Names}}\t{{.Status}}'
    exit 0
  fi
  if [ "$STATUS" = "unhealthy" ]; then
    echo "  ❌ Brain 容器 unhealthy"
    docker logs --tail 50 cecelia-node-brain
    exit 1
  fi
  sleep 1
done

echo "❌ 容器 90s 内没 healthy，当前状态: $STATUS"
docker logs --tail 30 cecelia-node-brain
exit 1
