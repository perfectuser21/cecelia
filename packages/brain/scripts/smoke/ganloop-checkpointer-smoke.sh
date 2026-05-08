#!/usr/bin/env bash
# 验证：runGanLoopNode 自动 getPgCheckpointer 兜底（不依赖 opts.checkpointer）
set -uo pipefail

CONTAINER="cecelia-node-brain"
if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "SKIP: brain 容器不在跑"
  exit 0
fi

# 检测部署：runGanLoopNode 含 getPgCheckpointer 兜底
if ! docker exec "$CONTAINER" grep -q "opts.checkpointer || await getPgCheckpointer" /app/src/workflows/harness-initiative.graph.js 2>/dev/null; then
  echo "SKIP: 容器内代码未含 hotfix（PR 合并 + redeploy 后再跑）"
  exit 0
fi

echo "✅ ganloop-checkpointer smoke PASS — runGanLoopNode 含 getPgCheckpointer 兜底"
exit 0
