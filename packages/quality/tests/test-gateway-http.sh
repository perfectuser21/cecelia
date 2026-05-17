#!/bin/bash
# Test: C-GATEWAY-HTTP-001 - Gateway HTTP 服务器
# Scope: POST /enqueue 接收任务，GET /status 返回状态，GET /health 返回健康

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PORT=15680
export GATEWAY_PORT=$PORT

echo "Testing Gateway HTTP Server (C-GATEWAY-HTTP-001)..."

# Start server in background
cd "$PROJECT_ROOT/gateway"
node gateway-http.js > /tmp/test-gateway-http.log 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true; rm -f /tmp/test-gateway-http.log" EXIT

# Wait for server to start
sleep 2

# Test 1: Health endpoint
echo -n "  [1/4] GET /health... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}PASS${NC} (HTTP $HTTP_CODE)"
else
    echo -e "${RED}FAIL${NC} (HTTP $HTTP_CODE)"
    exit 1
fi

# Test 2: Status endpoint
echo -n "  [2/4] GET /status... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/status")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo -e "${GREEN}PASS${NC} (HTTP $HTTP_CODE)"
else
    echo -e "${RED}FAIL${NC} (HTTP $HTTP_CODE)"
    exit 1
fi

# Test 3: Enqueue endpoint with valid task
echo -n "  [3/4] POST /enqueue (valid task)... "
RESPONSE=$(curl -s -X POST "http://localhost:$PORT/enqueue" \
    -H "Content-Type: application/json" \
    -d '{
        "taskId": "test-'$(uuidgen)'",
        "source": "test",
        "intent": "runQA",
        "priority": "P0",
        "payload": {"project": "test"}
    }')
if echo "$RESPONSE" | grep -q "success"; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi

# Test 4: Enqueue endpoint with invalid task (missing required fields)
echo -n "  [4/4] POST /enqueue (invalid task)... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:$PORT/enqueue" \
    -H "Content-Type: application/json" \
    -d '{"invalid": "task"}')
if [ "$HTTP_CODE" -eq 400 ]; then
    echo -e "${GREEN}PASS${NC} (HTTP $HTTP_CODE - rejected as expected)"
else
    echo -e "${RED}FAIL${NC} (HTTP $HTTP_CODE - should reject invalid task)"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ C-GATEWAY-HTTP-001 PASSED${NC}"
