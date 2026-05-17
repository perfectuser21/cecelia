#!/usr/bin/env bash
# Brain 紧急回滚：从 Docker 容器 → launchd 裸跑
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="/Library/LaunchDaemons/com.cecelia.brain.plist"

echo "=== Brain 紧急回滚：从容器 → 裸跑 ==="

# 1. 停容器
echo "→ docker-compose stop + rm node-brain"
cd "$ROOT_DIR"
docker-compose stop node-brain 2>/dev/null || true
docker-compose rm -f node-brain 2>/dev/null || true

# 2. 等 5221 释放
for i in {1..10}; do
  ! lsof -i :5221 -t >/dev/null 2>&1 && break
  sleep 1
done

# 3. 拉起 launchd 裸跑（两个 scope 都尝试，保证至少一个起来）
USER_PLIST="$HOME/Library/LaunchAgents/com.cecelia.brain.plist"
echo "→ launchctl load 裸跑 Brain（user + system scope）"
launchctl load "$USER_PLIST" 2>/dev/null || true
sudo launchctl load "$PLIST" 2>/dev/null || true

# 4. 等端口就绪（最多 30 秒）
for i in {1..30}; do
  if curl -fs http://localhost:5221/api/brain/tick/status >/dev/null 2>&1; then
    echo "  ✅ 裸跑 Brain 已恢复 (${i}s)"
    ps -ef | grep 'brain/server.js' | grep -v grep | head -1
    exit 0
  fi
  sleep 1
done

echo "❌ 裸跑 Brain 30s 内没起来，手动排查"
exit 1
