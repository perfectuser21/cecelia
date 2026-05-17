#!/bin/bash
# Test: C-WORKER-EXECUTION-001 - Worker 任务执行
# Scope: Worker 能 dequeue、创建 runs 目录、根据 intent 路由、生成 summary

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Testing Worker Execution (C-WORKER-EXECUTION-001)..."

# Setup test environment
TEST_QUEUE="/tmp/test-queue-$(date +%s).jsonl"
TEST_STATE="/tmp/test-state-$(date +%s).json"
TEST_RUNS="/tmp/test-runs-$(date +%s)"
export QUEUE_FILE="$TEST_QUEUE"
export STATE_FILE="$TEST_STATE"
export RUNS_DIR="$TEST_RUNS"

mkdir -p "$TEST_RUNS"
echo '{"tasks":[],"runs":[],"stats":{"total":0,"succeeded":0,"failed":0}}' > "$TEST_STATE"

trap "rm -rf $TEST_QUEUE $TEST_STATE $TEST_RUNS" EXIT

# Test 1: Create a test task
echo -n "  [1/5] Enqueue test task... "
bash "$PROJECT_ROOT/gateway/gateway.sh" add test runQA P0 '{"project":"test-project","branch":"main"}' > /dev/null 2>&1
if [ -f "$TEST_QUEUE" ] && [ $(wc -l < "$TEST_QUEUE") -eq 1 ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 2: Worker dequeues task
echo -n "  [2/5] Worker dequeues task... "
# Run worker once (should process one task)
timeout 10 bash "$PROJECT_ROOT/worker/worker.sh" > /dev/null 2>&1 || true
QUEUE_LENGTH=$(wc -l < "$TEST_QUEUE" 2>/dev/null || echo "0")
if [ "$QUEUE_LENGTH" -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} (Queue still has $QUEUE_LENGTH tasks)"
    exit 1
fi

# Test 3: Runs directory created
echo -n "  [3/5] Runs directory created... "
RUN_DIRS=$(find "$TEST_RUNS" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [ "$RUN_DIRS" -ge 1 ]; then
    echo -e "${GREEN}PASS${NC} ($RUN_DIRS run directories)"
    RUN_DIR=$(find "$TEST_RUNS" -mindepth 1 -maxdepth 1 -type d | head -1)
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 4: Summary.json generated
echo -n "  [4/5] summary.json generated... "
if [ -f "$RUN_DIR/summary.json" ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    echo "Run directory: $RUN_DIR"
    ls -la "$RUN_DIR" || true
    exit 1
fi

# Test 5: State updated
echo -n "  [5/5] State updated... "
if [ -f "$TEST_STATE" ]; then
    TOTAL=$(jq -r '.stats.total // 0' "$TEST_STATE")
    if [ "$TOTAL" -ge 1 ]; then
        echo -e "${GREEN}PASS${NC} (Total runs: $TOTAL)"
    else
        echo -e "${RED}FAIL${NC}"
        cat "$TEST_STATE"
        exit 1
    fi
else
    echo -e "${RED}FAIL${NC} (State file not found)"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ C-WORKER-EXECUTION-001 PASSED${NC}"
