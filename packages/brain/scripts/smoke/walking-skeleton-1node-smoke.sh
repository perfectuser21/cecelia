#!/usr/bin/env bash
# walking-skeleton-1node smoke — LangGraph 修正 Sprint Stream 5
#
# 真 e2e：起 brain → trigger → 等 spawn docker → 等 callback POST → 验证 status=completed。
# 含 Phase 2 brain kill resume 测试（PG checkpointer 跨进程 resume 实证）。
#
# 默认 SKIP（brain 不在跑），CI 不阻塞。本地手动跑：
#   bash packages/brain/scripts/smoke/walking-skeleton-1node-smoke.sh

set -uo pipefail

CONTAINER="cecelia-node-brain"
COMPOSE_FILE="/Users/administrator/perfect21/cecelia/docker-compose.yml"

if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "SKIP: brain 容器 ($CONTAINER) 不在跑"
  exit 0
fi

# 检测 endpoint 部署
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  http://localhost:5221/api/brain/walking-skeleton-1node/trigger \
  -H "Content-Type: application/json" \
  -d '{}')
if [ "$RESPONSE" = "404" ]; then
  echo "SKIP: walking-skeleton-1node endpoint 未部署（旧版 brain image）"
  exit 0
fi

echo "=== Phase 1: 正常 e2e（spawn → callback → resume） ==="
START=$(date +%s)
RESULT=$(curl -s -X POST \
  http://localhost:5221/api/brain/walking-skeleton-1node/trigger \
  -H "Content-Type: application/json" \
  -d '{}')
THREAD_ID=$(echo "$RESULT" | jq -r '.thread_id // empty')
if [ -z "$THREAD_ID" ] || [ "$THREAD_ID" = "null" ]; then
  echo "FAIL Phase 1: trigger 没返回 thread_id, response=$RESULT"
  exit 1
fi
echo "trigger OK: thread_id=$THREAD_ID"

# 等 callback 自动完成（5 分钟超时）
STATUS=""
for i in $(seq 1 60); do
  STATUS=$(curl -s "http://localhost:5221/api/brain/walking-skeleton-1node/status/$THREAD_ID" 2>/dev/null | jq -r '.status // empty' 2>/dev/null)
  if [ "$STATUS" = "completed" ]; then
    ELAPSED=$(($(date +%s) - START))
    echo "✅ Phase 1 PASS — 完成耗时 ${ELAPSED}s (thread $THREAD_ID)"
    break
  fi
  sleep 5
done

if [ "$STATUS" != "completed" ]; then
  echo "❌ Phase 1 FAIL — 5 分钟超时未完成 (last status=$STATUS)"
  exit 1
fi

# Phase 2: brain kill resume 测试
echo ""
echo "=== Phase 2: brain kill resume 测试（PG checkpointer 跨进程恢复） ==="

RESULT2=$(curl -s -X POST http://localhost:5221/api/brain/walking-skeleton-1node/trigger \
  -H "Content-Type: application/json" -d '{}')
THREAD2=$(echo "$RESULT2" | jq -r '.thread_id // empty')
if [ -z "$THREAD2" ] || [ "$THREAD2" = "null" ]; then
  echo "FAIL Phase 2: trigger 没返回 thread_id, response=$RESULT2"
  exit 1
fi
echo "trigger Phase 2: $THREAD2"

# 给 spawn 一点时间触发（spawn docker 是即时的，sibling alpine 还在 sleep 2 + 后续 wget）
# 我们要在 callback 到达前 kill brain，模拟 brain 崩溃但 sibling container 还活着
sleep 1

echo "kill brain container..."
docker compose -f "$COMPOSE_FILE" restart node-brain 2>&1 | tail -2

# 等 brain 重启并 ready
echo "等 brain ready..."
BRAIN_READY=false
for i in {1..30}; do
  if curl -sf localhost:5221/api/brain/health >/dev/null 2>&1; then
    echo "✓ brain ready (耗时 ${i}*2s)"
    BRAIN_READY=true
    break
  fi
  sleep 2
done

if [ "$BRAIN_READY" = "false" ]; then
  echo "❌ Phase 2 FAIL — brain restart 后 60s 未 ready"
  exit 1
fi

# 等 callback 自动完成
# 注意：alpine container 在 brain restart 期间发的 callback 可能被 brain reject（brain 还没 ready）
# 真实场景下 callback router 应该有 retry，但 walking skeleton 验证 PG checkpointer 还在
# 即使 callback 失败，graph state 应该可恢复（在 await_callback 节点 interrupt）
echo "等 graph 从 PG checkpointer resume（callback 路由触发）..."
STATUS2=""
for i in $(seq 1 60); do
  STATUS2=$(curl -s "http://localhost:5221/api/brain/walking-skeleton-1node/status/$THREAD2" 2>/dev/null | jq -r '.status // empty' 2>/dev/null)
  if [ "$STATUS2" = "completed" ]; then
    echo "✅ Phase 2 PASS — brain restart 后 graph resume 成功 (thread $THREAD2)"
    exit 0
  fi
  sleep 5
done

# Phase 2 失败时给个有用 hint
echo "❌ Phase 2 FAIL — brain restart 后 graph 未在 5min 内 completed (last status=$STATUS2)"
echo "   可能原因 a) callback 在 brain restart 窗口被丢；b) PG checkpointer 没保 state"
echo "   debug: SELECT * FROM walking_skeleton_thread_lookup WHERE thread_id='$THREAD2';"
exit 1
