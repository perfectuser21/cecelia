#!/bin/bash
# Test: C-GATEWAY-CLI-001 - Gateway CLI 命令
# Scope: add/enqueue/status 命令正常工作

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Testing Gateway CLI Commands (C-GATEWAY-CLI-001)..."

# Setup test queue
TEST_QUEUE="/tmp/test-queue-$(date +%s).jsonl"
export QUEUE_FILE="$TEST_QUEUE"
trap "rm -f $TEST_QUEUE" EXIT

# Test 1: gateway.sh status (empty queue)
echo -n "  [1/4] gateway.sh status (empty)... "
OUTPUT=$(bash "$PROJECT_ROOT/gateway/gateway.sh" status)
if echo "$OUTPUT" | grep -q "Queue is empty"; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    echo "Output: $OUTPUT"
    exit 1
fi

# Test 2: gateway.sh add (CLI mode)
echo -n "  [2/4] gateway.sh add... "
bash "$PROJECT_ROOT/gateway/gateway.sh" add test runQA P0 '{"project":"test-project"}' > /dev/null 2>&1
if [ -f "$TEST_QUEUE" ] && [ $(wc -l < "$TEST_QUEUE") -eq 1 ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 3: gateway.sh enqueue (JSON mode)
echo -n "  [3/4] gateway.sh enqueue... "
TASK_JSON='{"taskId":"'$(uuidgen)'","source":"test","intent":"runQA","priority":"P1","payload":{}}'
echo "$TASK_JSON" | bash "$PROJECT_ROOT/gateway/gateway.sh" enqueue > /dev/null 2>&1
if [ $(wc -l < "$TEST_QUEUE") -eq 2 ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 4: gateway.sh status (non-empty queue)
echo -n "  [4/4] gateway.sh status (2 tasks)... "
OUTPUT=$(bash "$PROJECT_ROOT/gateway/gateway.sh" status)
if echo "$OUTPUT" | grep -q "Total tasks: 2"; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    echo "Output: $OUTPUT"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ C-GATEWAY-CLI-001 PASSED${NC}"
