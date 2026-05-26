#!/bin/bash
set -e

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TIMEOUT=300

echo "=== Route B 端到端验证 ==="
echo "Brain URL: $BRAIN_URL"

# B2: Brain 健康检查
echo ""
echo "[1/5] 检查 Brain 健康状态..."
HEALTH=$(curl -sf "$BRAIN_URL/api/brain/health" 2>/dev/null) || {
  echo "❌ Brain 离线（$BRAIN_URL/api/brain/health 无响应），终止验证"
  exit 1
}
echo "✅ Brain 在线: $HEALTH"

# B6: 基线快照 + 时间窗口防造假（date +%s + 300s 窗口）
echo ""
echo "[2/5] 获取 task_type=dev 基线快照..."
BEFORE_TIME=$(date +%s)
BEFORE_COUNT=$(curl -sf "$BRAIN_URL/api/brain/tasks?task_type=dev&limit=100" 2>/dev/null \
  | jq '[.[] | select(.task_type == "dev")] | length' 2>/dev/null || echo "0")
echo "基线计数: $BEFORE_COUNT 条 task_type=dev 任务"

# B3: Route B 触发命令（POST /api/brain/tasks，task_type=dev）
echo ""
echo "[3/5] 触发 Route B（POST /api/brain/tasks）..."
TASK_TITLE="Route B 验证测试任务 $(date +%Y%m%d_%H%M%S)"
RESPONSE=$(curl -sf -X POST "$BRAIN_URL/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"dev\",\"title\":\"$TASK_TITLE\",\"status\":\"in_progress\"}") || {
  echo "❌ POST /api/brain/tasks 失败"
  exit 1
}
echo "响应: $RESPONSE"

NEW_TASK_ID=$(echo "$RESPONSE" | jq -r '.id // .task_id // empty')
[ -z "$NEW_TASK_ID" ] && NEW_TASK_ID=$(echo "$RESPONSE" | jq -r '.data.id // empty')
echo "新 task ID: $NEW_TASK_ID"

# B4: status 双值断言（in_progress OR completed）
echo ""
echo "[4/5] 验证 task_type=dev 新任务落表（status: in_progress 或 completed）..."
AFTER_COUNT=0
FOUND=false
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  TASKS=$(curl -sf "$BRAIN_URL/api/brain/tasks?task_type=dev&limit=100" 2>/dev/null || echo "[]")
  AFTER_COUNT=$(echo "$TASKS" | jq '[.[] | select(.task_type == "dev")] | length' 2>/dev/null || echo "0")

  if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
    # B4: status 双值断言
    NEW_TASK=$(echo "$TASKS" | jq --argjson before "$BEFORE_COUNT" \
      '[.[] | select(.task_type == "dev")] | sort_by(.created_at) | .[-1]')
    TASK_STATUS=$(echo "$NEW_TASK" | jq -r '.status')
    if [ "$TASK_STATUS" = "in_progress" ] || [ "$TASK_STATUS" = "completed" ]; then
      FOUND=true
      break
    fi
  fi

  AFTER_TIME=$(date +%s)
  ELAPSED=$((AFTER_TIME - BEFORE_TIME))
  [ "$ELAPSED" -ge "$TIMEOUT" ] && break
  sleep 1
done

if [ "$FOUND" = "false" ]; then
  echo "❌ 未在时间窗口（${TIMEOUT}s）内发现新的 task_type=dev 任务（status=in_progress 或 completed）"
  echo "   基线: $BEFORE_COUNT → 当前: $AFTER_COUNT"
  exit 1
fi

# B5: task_type=dev + title 非空断言
echo ""
echo "[5/5] 验证 task_type=dev 和 title 非空..."
VERIFY_TASK=$(curl -sf "$BRAIN_URL/api/brain/tasks?task_type=dev&limit=100" 2>/dev/null \
  | jq --arg title "$TASK_TITLE" '.[] | select(.title == $title or (.title | contains("Route B 验证")))' 2>/dev/null | head -1)

VERIFY_TASK_TYPE=$(echo "$VERIFY_TASK" | jq -r '.task_type // empty')
VERIFY_TITLE=$(echo "$VERIFY_TASK" | jq -r '.title // empty')

if [ "$VERIFY_TASK_TYPE" != "dev" ]; then
  echo "❌ task_type 断言失败: 期望 dev，实际 '$VERIFY_TASK_TYPE'"
  exit 1
fi
if [ -z "$VERIFY_TITLE" ]; then
  echo "❌ title 非空断言失败: title 为空"
  exit 1
fi
echo "✅ task_type=dev ✓  title='$VERIFY_TITLE' ✓"

echo ""
echo "✅ Route B 验证通过 — POST /api/brain/tasks 端到端生效，task_type=dev 任务落表成功"
