#!/bin/bash
# Stop All Services

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Stopping all Cecelia Quality services..."
echo ""

# Stop Gateway HTTP
echo -n "Stopping Gateway HTTP... "
if pkill -f "gateway-http.js" 2>/dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Not running${NC}"
fi

# Stop Dashboard API
echo -n "Stopping Dashboard API... "
if pkill -f "api/server.js" 2>/dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Not running${NC}"
fi

echo ""
echo -e "${GREEN}✅ All services stopped${NC}"
