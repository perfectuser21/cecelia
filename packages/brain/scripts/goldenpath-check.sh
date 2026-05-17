#!/usr/bin/env bash
# L4 GoldenPath: Brain Minimal Life Loop
#
# Verifies the Brain's core lifecycle in a fresh CI environment:
#   1. Server starts (migrations + selfcheck)
#   2. Health endpoint responds
#   3. Status endpoint returns valid structure
#   4. Manual tick executes successfully
#   5. Tick status reports correct state
#   6. Tasks API endpoint responds
#
# Requires: PostgreSQL running, migrations already applied, ENV_REGION=us
# Does NOT require: ANTHROPIC_API_KEY (no LLM calls in empty-DB tick)
set -euo pipefail

PORT=${BRAIN_PORT:-5299}
export BRAIN_PORT=$PORT

FAILED=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILED=1; }

echo "=== L4 GoldenPath: Brain Minimal Life Loop ==="
echo ""

# 1. Start server in background
echo "[1/6] Starting Brain server on port $PORT..."
node server.js > /tmp/brain-goldenpath.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 2. Wait for health check
echo "[2/6] Waiting for health check..."
HEALTHY=0
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then
    pass "Server healthy after ${i}s"
    HEALTHY=1
    break
  fi
  # Check if server process died
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "Server process died during startup"
    echo "  --- Server log ---"
    cat /tmp/brain-goldenpath.log
    echo "  --- End log ---"
    exit 1
  fi
  sleep 1
done
if [ "$HEALTHY" -eq 0 ]; then
  fail "Server did not become healthy in 30s"
  echo "  --- Server log (last 20 lines) ---"
  tail -20 /tmp/brain-goldenpath.log
  echo "  --- End log ---"
  exit 1
fi

# 3. Check /api/brain/hardening/status (reliable: only queries core tables)
echo "[3/6] Checking /api/brain/hardening/status..."
STATUS_RESP=$(curl -s -w "\n%{http_code}" "http://localhost:$PORT/api/brain/hardening/status" || echo "")
HTTP_CODE=$(echo "$STATUS_RESP" | tail -1)
STATUS_BODY=$(echo "$STATUS_RESP" | sed '$d')
if [ "$HTTP_CODE" = "200" ]; then
  VERSION=$(echo "$STATUS_BODY" | jq -r '.version // empty' 2>/dev/null || echo "")
  if [ -n "$VERSION" ]; then
    pass "Hardening status OK (version: $VERSION)"
  else
    pass "Hardening status returned 200"
  fi
else
  fail "Hardening status returned HTTP $HTTP_CODE"
  echo "  Response: $(echo "$STATUS_BODY" | head -c 300)"
fi

# 4. Trigger one manual tick
echo "[4/6] Triggering manual tick..."
TICK=$(curl -sf -X POST "http://localhost:$PORT/api/brain/tick" || echo "")
if [ -z "$TICK" ]; then
  fail "Tick endpoint returned empty response"
else
  TICK_SUCCESS=$(echo "$TICK" | jq -r '.success // empty' 2>/dev/null || echo "")
  TICK_REASON=$(echo "$TICK" | jq -r '.reason // "none"' 2>/dev/null || echo "unknown")
  if [ "$TICK_SUCCESS" = "true" ]; then
    pass "Tick executed successfully (reason: $TICK_REASON)"
  else
    fail "Tick returned success=$TICK_SUCCESS"
    echo "  Response: $(echo "$TICK" | head -c 300)"
  fi
fi

# 5. Check tick status
echo "[5/6] Checking tick status..."
TICK_STATUS=$(curl -sf "http://localhost:$PORT/api/brain/tick/status" || echo "")
if [ -z "$TICK_STATUS" ]; then
  fail "Tick status endpoint returned empty response"
else
  if echo "$TICK_STATUS" | jq -e '.' > /dev/null 2>&1; then
    pass "Tick status endpoint returns valid JSON"
  else
    fail "Tick status returned invalid JSON"
  fi
fi

# 6. Check Tasks API
echo "[6/6] Checking Tasks API..."
TASKS=$(curl -sf "http://localhost:$PORT/api/brain/tasks?status=queued&limit=1" || echo "")
if [ -z "$TASKS" ]; then
  fail "Tasks endpoint returned empty response"
else
  if echo "$TASKS" | jq -e '. | type == "array"' > /dev/null 2>&1; then
    pass "Tasks API responds with valid structure"
  else
    fail "Tasks API returned invalid structure"
    echo "  Response: $(echo "$TASKS" | head -c 200)"
  fi
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "=== GoldenPath PASSED ==="
  echo "  Server started, selfcheck passed, status OK, tick executed, Tasks API OK"
  exit 0
else
  echo "=== GoldenPath FAILED ==="
  echo "  --- Full server log ---"
  cat /tmp/brain-goldenpath.log
  echo "  --- End log ---"
  exit 1
fi
