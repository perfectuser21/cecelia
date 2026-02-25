#!/usr/bin/env bash
# Test: OKR Database Integration

set -e

TEST_DIR="$(mktemp -d)"
cd "$TEST_DIR"

echo "=== Test: OKR Database Integration ==="
echo ""

# Create test output.json
cat > output.json << 'EOF'
{
  "objective": "提升开发效率",
  "key_results": [{
    "title": "KR1: 完成 Validation Loop",
    "features": [{
      "title": "实现 PRD Validation",
      "description": "为 PRD 添加 90 分制验证系统",
      "repository": "cecelia-engine"
    }, {
      "title": "实现 DoD Validation",
      "description": "为 DoD 添加 90 分制验证系统",
      "repository": "cecelia-engine"
    }]
  }]
}
EOF

echo "Test 1: Script exists and is executable"
SCRIPT_PATH="/home/xx/perfect21/cecelia/engine/skills/okr/scripts/store-to-database.sh"

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

echo "Test 2: Script can parse output.json"
# Test that script at least validates input
if bash "$SCRIPT_PATH" output.json 2>&1 | grep -q "Reading output.json"; then
    echo "✅ PASS: Script can read output.json"
else
    echo "❌ FAIL: Script cannot read output.json"
    rm -rf "$TEST_DIR"
    exit 1
fi

echo ""

echo "Test 3: Script handles Brain service unavailable"
# Script should gracefully handle when Brain is down
OUTPUT=$(bash "$SCRIPT_PATH" output.json 2>&1 || true)

if echo "$OUTPUT" | grep -q "Brain service unavailable\|Saving to pending-tasks.json\|Brain service OK"; then
    echo "✅ PASS: Script handles Brain service status"
else
    echo "❌ FAIL: Script doesn't handle Brain service properly"
    echo "Output: $OUTPUT"
    rm -rf "$TEST_DIR"
    exit 1
fi

echo ""

# Note: We can't test actual API calls without Brain service running
# Those should be tested manually or in CI with Brain service available

rm -rf "$TEST_DIR"
echo "✅ All basic tests passed"
echo ""
echo "Note: Full integration tests require Brain service running"
echo "  To test manually:"
echo "    1. Ensure Brain is running (localhost:5221)"
echo "    2. Create test output.json"
echo "    3. Run: bash store-to-database.sh output.json"
echo "    4. Verify: curl localhost:5212/api/tasks/tasks"
