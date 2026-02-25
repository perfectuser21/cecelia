#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Starting Cecelia Quality Platform${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Step 1: Check dependencies
echo -e "${YELLOW}Step 1: Checking dependencies...${NC}"

if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is not installed${NC}"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo -e "${YELLOW}Warning: jq is not installed (optional)${NC}"
fi

echo -e "${GREEN}✓ Dependencies OK${NC}"
echo

# Step 2: Initialize data directories
echo -e "${YELLOW}Step 2: Initializing data directories...${NC}"

mkdir -p state queue runs worker

if [ ! -f state/state.json ]; then
  echo '{
  "health": "ok",
  "queueLength": 0,
  "priorityCounts": {"P0": 0, "P1": 0, "P2": 0},
  "lastRun": null,
  "lastHeartbeat": null,
  "stats": {"totalTasks": 0, "successRate": 0},
  "systemHealth": {
    "inbox_count": 0,
    "todo_count": 0,
    "doing_count": 0,
    "done_count": 0,
    "failed_24h": 0
  },
  "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
}' > state/state.json
  echo -e "${GREEN}✓ Initialized state/state.json${NC}"
fi

if [ ! -f queue/queue.jsonl ]; then
  touch queue/queue.jsonl
  echo -e "${GREEN}✓ Initialized queue/queue.jsonl${NC}"
fi

echo

# Step 3: Install API dependencies
echo -e "${YELLOW}Step 3: Installing API dependencies...${NC}"

cd api
if [ ! -d node_modules ]; then
  npm install
else
  echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi
cd ..

echo

# Step 4: Start Dashboard API
echo -e "${YELLOW}Step 4: Starting Dashboard API (Port 5681)...${NC}"

cd api
nohup npm start > /tmp/cecelia-api.log 2>&1 &
API_PID=$!
echo "$API_PID" > /tmp/cecelia-api.pid
cd ..

echo -e "${GREEN}✓ Dashboard API started (PID: $API_PID)${NC}"
echo -e "  Logs: /tmp/cecelia-api.log"
echo

# Step 5: Wait for API to be ready
echo -e "${YELLOW}Step 5: Waiting for API to be ready...${NC}"

MAX_WAIT=30
COUNTER=0

while [ $COUNTER -lt $MAX_WAIT ]; do
  if curl -s http://localhost:5681/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ API is ready!${NC}"
    break
  fi
  
  COUNTER=$((COUNTER + 1))
  if [ $COUNTER -eq $MAX_WAIT ]; then
    echo -e "${RED}Error: API failed to start within ${MAX_WAIT}s${NC}"
    echo -e "${YELLOW}Check logs: tail /tmp/cecelia-api.log${NC}"
    exit 1
  fi
  
  sleep 1
done

echo

# Step 6: Health check
echo -e "${YELLOW}Step 6: Running health checks...${NC}"

HEALTH_RESPONSE=$(curl -s http://localhost:5681/api/health)
echo -e "${GREEN}✓ Health check OK${NC}"
echo -e "  Response: $HEALTH_RESPONSE"
echo

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  All services started successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "API Endpoints:"
echo -e "  ${YELLOW}Health:${NC}    http://localhost:5681/api/health"
echo -e "  ${YELLOW}State:${NC}     http://localhost:5681/api/state"
echo -e "  ${YELLOW}Queue:${NC}     http://localhost:5681/api/queue"
echo -e "  ${YELLOW}Runs:${NC}      http://localhost:5681/api/runs"
echo -e "  ${YELLOW}Failures:${NC}  http://localhost:5681/api/failures"
echo
echo -e "Test commands:"
echo -e "  ${YELLOW}curl http://localhost:5681/api/health | jq .${NC}"
echo -e "  ${YELLOW}curl http://localhost:5681/api/state | jq .${NC}"
echo
echo -e "Stop services:"
echo -e "  ${YELLOW}bash scripts/stop-all.sh${NC}"
echo
