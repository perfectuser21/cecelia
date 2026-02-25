#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Stopping Cecelia Quality Platform${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Stop Dashboard API
if [ -f /tmp/cecelia-api.pid ]; then
  API_PID=$(cat /tmp/cecelia-api.pid)
  
  if ps -p "$API_PID" > /dev/null 2>&1; then
    echo -e "${YELLOW}Stopping Dashboard API (PID: $API_PID)...${NC}"
    kill "$API_PID"
    rm /tmp/cecelia-api.pid
    echo -e "${GREEN}✓ Dashboard API stopped${NC}"
  else
    echo -e "${YELLOW}Dashboard API is not running (PID file exists but process not found)${NC}"
    rm /tmp/cecelia-api.pid
  fi
else
  # Try to find and kill by port
  API_PID=$(lsof -t -i:5681 2>/dev/null || true)
  
  if [ -n "$API_PID" ]; then
    echo -e "${YELLOW}Found Dashboard API on port 5681 (PID: $API_PID)${NC}"
    kill "$API_PID"
    echo -e "${GREEN}✓ Dashboard API stopped${NC}"
  else
    echo -e "${YELLOW}Dashboard API is not running${NC}"
  fi
fi

echo

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  All services stopped${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
