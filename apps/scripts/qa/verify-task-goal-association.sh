#!/bin/bash
# 验证 Task 创建带 goal_id 关联功能
# Task ID: f2a212ae-daac-45fe-9c48-355371813647

set -e

API_BASE="http://localhost:5211/api/brain"
GOAL_ID="1c09826d-9608-46b5-9e89-b4c9111f0238"
RESULTS=()

echo "======================================"
echo "验证 Task 创建带 goal_id 关联功能"
echo "======================================"
echo ""

# 测试 1: 验证现有任务已关联 goal_id
echo "📝 测试 1: 验证现有任务已关联 goal_id"
# 使用 status 参数确保 API 返回完整数据
TASK_RESULT=$(curl -s "$API_BASE/action/update-task" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"task_id\": \"f2a212ae-daac-45fe-9c48-355371813647\", \"status\": \"in_progress\", \"idempotency_key\": \"verify-test-1-$(date +%s)-$RANDOM\"}")

TASK_GOAL_ID=$(echo "$TASK_RESULT" | jq -r '.task.goal_id // "null"')
if [[ "$TASK_GOAL_ID" == "$GOAL_ID" ]]; then
  echo "✅ PASS: Task 已关联 goal_id: $TASK_GOAL_ID"
  RESULTS+=("test1:PASS")
else
  echo "❌ FAIL: Task goal_id 不正确，期望 $GOAL_ID，实际 $TASK_GOAL_ID"
  RESULTS+=("test1:FAIL")
fi
echo ""

# 测试 2: 创建新 Task 时指定 goal_id
echo "📝 测试 2: 创建新 Task 时指定 goal_id"
TEST_TASK_TITLE="QA验证临时任务-$(date +%s)"
CREATE_RESULT=$(curl -s "$API_BASE/action/create-task" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$TEST_TASK_TITLE\", \"goal_id\": \"$GOAL_ID\", \"priority\": \"P2\", \"idempotency_key\": \"verify-create-$(date +%s)\"}")

NEW_TASK_ID=$(echo "$CREATE_RESULT" | jq -r '.task.id // "null"')
NEW_TASK_GOAL=$(echo "$CREATE_RESULT" | jq -r '.task.goal_id // "null"')

if [[ "$NEW_TASK_ID" != "null" && "$NEW_TASK_GOAL" == "$GOAL_ID" ]]; then
  echo "✅ PASS: 新 Task 创建成功并关联 goal_id"
  echo "   Task ID: $NEW_TASK_ID"
  echo "   Goal ID: $NEW_TASK_GOAL"
  RESULTS+=("test2:PASS")
else
  echo "❌ FAIL: 创建 Task 失败或 goal_id 未关联"
  echo "   结果: $CREATE_RESULT"
  RESULTS+=("test2:FAIL")
fi
echo ""

# 测试 3: 查询 Goal 下所有关联的 Tasks
echo "📝 测试 3: 查询 Goal 下所有关联的 Tasks"
# 通过 Brain status 查看 task_digest 中的任务
STATUS_RESULT=$(curl -s "$API_BASE/status")
P0_TASKS=$(echo "$STATUS_RESULT" | jq '[.task_digest.p0[] | select(.id != null)] | length')
P1_TASKS=$(echo "$STATUS_RESULT" | jq '[.task_digest.p1[] | select(.id != null)] | length')

# 检查 daily_focus 是否指向正确的 goal
FOCUS_GOAL=$(echo "$STATUS_RESULT" | jq -r '.daily_focus.objective_id // "null"')

if [[ "$FOCUS_GOAL" == "$GOAL_ID" ]]; then
  echo "✅ PASS: Brain daily_focus 指向正确的 Goal"
  echo "   Goal ID: $FOCUS_GOAL"
  echo "   P0 Tasks: $P0_TASKS"
  echo "   P1 Tasks: $P1_TASKS"
  RESULTS+=("test3:PASS")
else
  echo "⚠️ PARTIAL: daily_focus 指向不同的 Goal"
  echo "   当前 Focus: $FOCUS_GOAL"
  echo "   测试 Goal: $GOAL_ID"
  RESULTS+=("test3:PARTIAL")
fi
echo ""

# 测试 4: 更新 Task 状态验证
echo "📝 测试 4: 更新 Task 状态功能"
if [[ "$NEW_TASK_ID" != "null" ]]; then
  UPDATE_RESULT=$(curl -s "$API_BASE/action/update-task" -X POST \
    -H "Content-Type: application/json" \
    -d "{\"task_id\": \"$NEW_TASK_ID\", \"status\": \"completed\", \"idempotency_key\": \"verify-update-$(date +%s)\"}")
  
  UPDATED_STATUS=$(echo "$UPDATE_RESULT" | jq -r '.task.status // "null"')
  
  if [[ "$UPDATED_STATUS" == "completed" ]]; then
    echo "✅ PASS: Task 状态更新成功"
    echo "   Status: $UPDATED_STATUS"
    RESULTS+=("test4:PASS")
  else
    echo "❌ FAIL: Task 状态更新失败"
    echo "   结果: $UPDATE_RESULT"
    RESULTS+=("test4:FAIL")
  fi
else
  echo "⚠️ SKIP: 没有测试 Task 可用"
  RESULTS+=("test4:SKIP")
fi
echo ""

# 汇总结果
echo "======================================"
echo "验证结果汇总"
echo "======================================"
PASS_COUNT=0
FAIL_COUNT=0
for r in "${RESULTS[@]}"; do
  STATUS="${r#*:}"
  if [[ "$STATUS" == "PASS" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [[ "$STATUS" == "FAIL" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  echo "  $r"
done

echo ""
echo "通过: $PASS_COUNT / ${#RESULTS[@]}"
echo "失败: $FAIL_COUNT / ${#RESULTS[@]}"

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo ""
  echo "🎉 所有测试通过！Task 与 Goal 关联功能正常工作。"
  exit 0
else
  echo ""
  echo "⚠️ 有 $FAIL_COUNT 个测试失败，请检查。"
  exit 1
fi
