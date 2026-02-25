#!/usr/bin/env bash
# Test: OKR decompose-feature.sh

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: OKR Feature Decomposition ==="
echo ""

SCRIPT_PATH="/home/xx/perfect21/cecelia/engine/skills/okr/scripts/decompose-feature.sh"

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

echo "Test 2: Simple requirement detection (single task)"
OUTPUT=$(bash "$SCRIPT_PATH" "修复登录bug" 2>/dev/null)

if echo "$OUTPUT" | jq -e '.feature.complexity == "single"' >/dev/null; then
    echo "✅ PASS: Simple requirement detected as single task"
else
    echo "❌ FAIL: Simple requirement not detected correctly"
    echo "Output: $OUTPUT"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

echo "Test 3: Complex requirement detection (multiple tasks)"
OUTPUT=$(bash "$SCRIPT_PATH" "实现完整的用户认证系统" 2>/dev/null)

if echo "$OUTPUT" | jq -e '.feature.complexity == "multiple"' >/dev/null; then
    echo "✅ PASS: Complex requirement detected as multiple tasks"
else
    echo "❌ FAIL: Complex requirement not detected correctly"
    echo "Output: $OUTPUT"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

echo "Test 4: Single task mode generates 1 detailed PRD"
OUTPUT=$(bash "$SCRIPT_PATH" "修复登录bug" 2>/dev/null)
TASK_COUNT=$(echo "$OUTPUT" | jq '.tasks | length')

if [ "$TASK_COUNT" -eq 1 ]; then
    echo "✅ PASS: Single task mode generates 1 task"
else
    echo "❌ FAIL: Single task mode generated $TASK_COUNT tasks (expected 1)"
    rm -rf "$TEST_DIR"
    exit 1
fi

TASK_STATUS=$(echo "$OUTPUT" | jq -r '.tasks[0].prd_status')
if [ "$TASK_STATUS" = "detailed" ]; then
    echo "✅ PASS: Task 1 has detailed PRD"
else
    echo "❌ FAIL: Task 1 status is $TASK_STATUS (expected detailed)"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

echo "Test 5: Multiple task mode generates 1 detailed + 2+ drafts"
OUTPUT=$(bash "$SCRIPT_PATH" "实现完整的用户认证系统" 2>/dev/null)
TASK_COUNT=$(echo "$OUTPUT" | jq '.tasks | length')

if [ "$TASK_COUNT" -ge 2 ]; then
    echo "✅ PASS: Multiple task mode generates $TASK_COUNT tasks"
else
    echo "❌ FAIL: Multiple task mode generated $TASK_COUNT tasks (expected >= 2)"
    rm -rf "$TEST_DIR"
    exit 1
fi

TASK1_STATUS=$(echo "$OUTPUT" | jq -r '.tasks[0].prd_status')
if [ "$TASK1_STATUS" = "detailed" ]; then
    echo "✅ PASS: Task 1 has detailed PRD"
else
    echo "❌ FAIL: Task 1 status is $TASK1_STATUS (expected detailed)"
    rm -rf "$TEST_DIR"
    exit 1
fi

TASK2_STATUS=$(echo "$OUTPUT" | jq -r '.tasks[1].prd_status')
if [ "$TASK2_STATUS" = "draft" ]; then
    echo "✅ PASS: Task 2 has draft status"
else
    echo "❌ FAIL: Task 2 status is $TASK2_STATUS (expected draft)"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

echo "Test 6: Feature description is detailed (>100 chars)"
OUTPUT=$(bash "$SCRIPT_PATH" "实现用户认证系统" 2>/dev/null)
DESC_LENGTH=$(echo "$OUTPUT" | jq -r '.feature.description' | wc -c)

if [ "$DESC_LENGTH" -gt 100 ]; then
    echo "✅ PASS: Feature description is detailed ($DESC_LENGTH chars)"
else
    echo "❌ FAIL: Feature description too short ($DESC_LENGTH chars)"
    rm -rf "$TEST_DIR"
    exit 1
fi
echo ""

rm -rf "$TEST_DIR"
echo "✅ All tests passed"
