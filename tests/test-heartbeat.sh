#!/bin/bash
# Test: C-HEARTBEAT-AUTO-001 - Heartbeat 自主监控
# Scope: 检查状态、检测异常、自动入队、触发 worker

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Testing Heartbeat Auto-monitoring (C-HEARTBEAT-AUTO-001)..."

# Setup test environment
TEST_QUEUE="/tmp/test-queue-$(date +%s).jsonl"
TEST_STATE="/tmp/test-state-$(date +%s).json"
export QUEUE_FILE="$TEST_QUEUE"
export STATE_FILE="$TEST_STATE"

# Create initial state with high failure rate (should trigger alert)
cat > "$TEST_STATE" <<EOF
{
  "tasks": [],
  "runs": [],
  "stats": {
    "total": 10,
    "succeeded": 3,
    "failed": 7
  }
}
EOF

trap "rm -f $TEST_QUEUE $TEST_STATE" EXIT

# Test 1: Heartbeat can read state
echo -n "  [1/4] Read system state... "
if bash "$PROJECT_ROOT/heartbeat/heartbeat.sh" > /tmp/heartbeat-test.log 2>&1; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    cat /tmp/heartbeat-test.log
    exit 1
fi

# Test 2: Heartbeat detects high failure rate
echo -n "  [2/4] Detect high failure rate... "
if grep -q "failure rate" /tmp/heartbeat-test.log 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    cat /tmp/heartbeat-test.log
    exit 1
fi

# Test 3: Create a normal state with pending queue
cat > "$TEST_STATE" <<EOF
{
  "tasks": [],
  "runs": [],
  "stats": {
    "total": 10,
    "succeeded": 9,
    "failed": 1
  }
}
EOF

# Add a task to queue
bash "$PROJECT_ROOT/gateway/gateway.sh" add heartbeat runQA P1 '{"project":"test"}' > /dev/null 2>&1

echo -n "  [3/4] Detect non-empty queue... "
bash "$PROJECT_ROOT/heartbeat/heartbeat.sh" > /tmp/heartbeat-test2.log 2>&1
if grep -q "queue" /tmp/heartbeat-test2.log 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    cat /tmp/heartbeat-test2.log
    exit 1
fi

# Test 4: Heartbeat runs without errors
echo -n "  [4/4] Heartbeat runs without errors... "
if bash "$PROJECT_ROOT/heartbeat/heartbeat.sh" > /dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ C-HEARTBEAT-AUTO-001 PASSED${NC}"

rm -f /tmp/heartbeat-test.log /tmp/heartbeat-test2.log
