#!/usr/bin/env bash
# Test: OKR continue-feature.sh

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: OKR Feature Continuation ==="
echo ""

SCRIPT_PATH="/home/xx/perfect21/cecelia/engine/skills/okr/scripts/continue-feature.sh"

echo "Test 1: Script exists and is executable"
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ FAIL: Script not found at $SCRIPT_PATH"
    rm -rf "$TEST_DIR"
    exit 1
fi

if [ ! -x "$SCRIPT_PATH" ]; then
    echo "❌ FAIL: Script not executable"
    rm -rf "$TEST_DIR"
    exit 1
fi

echo "✅ PASS: Script exists and is executable"
echo ""

echo "Test 2: Can read feedback file"
cat > feedback.json << 'EOF'
{
  "feedback": {
    "summary": "Task 1 完成，登录 API 实现成功",
    "issues_found": ["需要处理 token 刷新"],
    "next_steps_suggested": ["实现 token 刷新机制"]
  }
}
EOF

OUTPUT=$(bash "$SCRIPT_PATH" "test-feature" "feedback.json" 2>/dev/null)

if echo "$OUTPUT" | jq -e '.feedback_read == true' >/dev/null; then
    echo "✅ PASS: Feedback file read successfully"
else
    echo "❌ FAIL: Failed to read feedback"
    echo "Output: $OUTPUT"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

echo "Test 3: Plan adjustment detection"
if echo "$OUTPUT" | jq -e 'has("plan_adjusted")' >/dev/null; then
    echo "✅ PASS: Plan adjustment field exists"
else
    echo "❌ FAIL: Plan adjustment field missing"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

echo "Test 4: Next task generation"
if echo "$OUTPUT" | jq -e 'has("next_task")' >/dev/null; then
    NEXT_TASK_STATUS=$(echo "$OUTPUT" | jq -r '.next_task.prd_status // "missing"')
    if [ "$NEXT_TASK_STATUS" = "detailed" ]; then
        echo "✅ PASS: Next task has detailed PRD"
    else
        echo "❌ FAIL: Next task status is $NEXT_TASK_STATUS (expected detailed)"
        rm -rf "$TEST_DIR"
        exit 1
    fi
else
    # Feature might be completed
    if echo "$OUTPUT" | jq -e '.feature_completed == true' >/dev/null; then
        echo "✅ PASS: Feature marked as completed (no next task)"
    else
        echo "❌ FAIL: Neither next_task nor feature_completed present"
        rm -rf "$TEST_DIR"
        exit 1
    fi
fi
echo ""

echo "Test 5: Feature completion detection"
cat > complete-feedback.json << 'EOF'
{
  "feedback": {
    "summary": "所有功能已完成",
    "issues_found": [],
    "next_steps_suggested": []
  }
}
EOF

# 创建临时 Plan 文件，标记为最后一个 Task
cat > /tmp/feature-test-feature-plan.json << 'EOF'
{
  "feature_id": "test-feature",
  "tasks": [
    {"id": "task-001", "status": "completed", "order": 1}
  ],
  "current_task_index": 0
}
EOF

OUTPUT=$(bash "$SCRIPT_PATH" "test-feature" "complete-feedback.json" 2>/dev/null)

if echo "$OUTPUT" | jq -e 'has("feature_completed")' >/dev/null; then
    echo "✅ PASS: Feature completion field exists"
else
    echo "❌ FAIL: Feature completion field missing"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

rm -rf "$TEST_DIR"
echo "✅ All tests passed"
