#!/usr/bin/env bash
# Layer 3 smoke: harness-task spawn-and-interrupt 模式 vs 实际生产 graph
# Phase 1: 在 brain 容器内验证 spawnDockerDetached + harness-task graph build OK
# Phase 2: 部署后真 e2e（要 W8 acceptance task 跑通才算）— 留给 Layer 4
set -uo pipefail

CONTAINER="cecelia-node-brain"
if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "SKIP: brain 容器不在跑（CI 环境无 brain 容器）"
  exit 0
fi

# 检测部署：容器内 harness-task.graph.js 是否含 awaitCallbackNode（Layer 3 标志）
if ! docker exec "$CONTAINER" grep -q "awaitCallbackNode\|await_callback" /app/src/workflows/harness-task.graph.js 2>/dev/null; then
  echo "SKIP: 容器内 harness-task.graph.js 未含 Layer 3 awaitCallbackNode（PR 合并 + brain redeploy 后再跑）"
  exit 0
fi

# 检测部署：容器内 spawn/detached.js 是否存在（Layer 3 helper）
if ! docker exec "$CONTAINER" test -f /app/src/spawn/detached.js 2>/dev/null; then
  echo "SKIP: 容器内 spawn/detached.js 不存在"
  exit 0
fi

# Phase 1: 容器内 build harness-task graph 不崩
RESULT=$(docker exec "$CONTAINER" node --input-type=module -e "
  try {
    const m = await import('/app/src/workflows/harness-task.graph.js');
    if (typeof m.buildHarnessTaskGraph !== 'function') {
      console.error('FAIL: buildHarnessTaskGraph not exported');
      process.exit(1);
    }
    const graph = m.buildHarnessTaskGraph();
    if (!graph) {
      console.error('FAIL: buildHarnessTaskGraph returned falsy');
      process.exit(2);
    }
    console.log('OK:graph_build');
  } catch (err) {
    console.error('NODE_ERROR:' + err.message);
    process.exit(3);
  }
" 2>&1)

if [[ "$RESULT" == *"OK:graph_build"* ]]; then
  echo "✅ Phase 1 PASS — harness-task graph build 通过 (含 Layer 3 spawn-interrupt 节点)"
  echo "Phase 2 真 e2e (W8 acceptance task) 留给 Layer 4 验收"
  exit 0
fi

echo "❌ FAIL Phase 1: $RESULT"
exit 1
