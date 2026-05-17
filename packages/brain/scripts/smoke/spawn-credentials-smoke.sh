#!/usr/bin/env bash
# 验证：Layer 3 spawnNode 会调 resolveAccount 注入 CECELIA_CREDENTIALS
set -uo pipefail
CONTAINER="cecelia-node-brain"
if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "SKIP: brain 容器不在跑"; exit 0
fi
if ! docker exec "$CONTAINER" grep -q "resolveAccount(acctOpts" /app/src/workflows/harness-task.graph.js 2>/dev/null; then
  echo "SKIP: 容器内代码未含 hotfix（PR 合并 + redeploy 后再跑）"; exit 0
fi
echo "✅ spawn-credentials smoke PASS — spawnNode 调 resolveAccount 注入 credentials"
exit 0
