#!/bin/bash
# Start All Services - One-command startup for Cecelia Quality Platform

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}"
cat <<'EOF'
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║      Cecelia Quality Platform - Start All Services      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Check dependencies
echo "Checking dependencies..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found${NC}"
    exit 1
fi

# Check SQLite3
if ! command -v sqlite3 &> /dev/null; then
    echo -e "${YELLOW}⚠️  SQLite3 not found. Run: sudo apt-get install -y sqlite3${NC}"
    echo "Continuing without database features..."
fi

# Check jq
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}⚠️  jq not found. Run: sudo apt-get install -y jq${NC}"
fi

echo -e "${GREEN}✅ Dependencies OK${NC}"
echo ""

# Step 1: Initialize Database (if not exists)
if [[ ! -f "$PROJECT_ROOT/db/cecelia.db" && -x "$PROJECT_ROOT/scripts/db-init.sh" ]]; then
    echo "📦 Initializing database..."
    bash "$PROJECT_ROOT/scripts/db-init.sh" init
    echo ""
fi

# Step 2: Start Gateway HTTP Server
echo "🚪 Starting Gateway HTTP Server..."
if pgrep -f "gateway-http.js" > /dev/null; then
    echo -e "${YELLOW}Gateway HTTP already running${NC}"
else
    cd "$PROJECT_ROOT/gateway"
    nohup node gateway-http.js > /tmp/gateway-http.log 2>&1 &
    GATEWAY_PID=$!
    sleep 2

    if pgrep -f "gateway-http.js" > /dev/null; then
        echo -e "${GREEN}✅ Gateway HTTP started (PID: $GATEWAY_PID)${NC}"
        echo "   Logs: tail -f /tmp/gateway-http.log"
        echo "   URL: http://localhost:5680"
    else
        echo -e "${RED}❌ Failed to start Gateway HTTP${NC}"
    fi
fi
echo ""

# Step 3: Start Dashboard API Server
echo "🖥️  Starting Dashboard API Server..."

# Install API dependencies if needed
if [[ ! -d "$PROJECT_ROOT/api/node_modules" ]]; then
    echo "Installing API dependencies..."
    cd "$PROJECT_ROOT/api"
    npm install --silent
fi

if pgrep -f "api/server.js" > /dev/null; then
    echo -e "${YELLOW}Dashboard API already running${NC}"
else
    cd "$PROJECT_ROOT/api"
    nohup node server.js > /tmp/cecelia-api.log 2>&1 &
    API_PID=$!
    sleep 2

    if pgrep -f "api/server.js" > /dev/null; then
        echo -e "${GREEN}✅ Dashboard API started (PID: $API_PID)${NC}"
        echo "   Logs: tail -f /tmp/cecelia-api.log"
        echo "   URL: http://localhost:5681"
    else
        echo -e "${RED}❌ Failed to start Dashboard API${NC}"
    fi
fi
echo ""

# Step 4: Test services
echo "🧪 Testing services..."

# Test Gateway HTTP
echo -n "  Gateway HTTP... "
if curl -s http://localhost:5680/health > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
fi

# Test Dashboard API
echo -n "  Dashboard API... "
if curl -s http://localhost:5681/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
fi

echo ""

# Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ All services started!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo "Services running:"
echo "  1. Gateway HTTP:    http://localhost:5680"
echo "  2. Dashboard API:   http://localhost:5681"
echo ""

echo "Quick commands:"
echo "  • Submit task:      curl -X POST http://localhost:5680/add -H 'Content-Type: application/json' -d '{...}'"
echo "  • View queue:       curl http://localhost:5680/status"
echo "  • View state:       curl http://localhost:5681/api/state | jq ."
echo "  • Execute worker:   bash worker/worker.sh"
echo "  • Heartbeat:        bash heartbeat/heartbeat.sh"
echo ""

echo "Logs:"
echo "  • Gateway HTTP:     tail -f /tmp/gateway-http.log"
echo "  • Dashboard API:    tail -f /tmp/cecelia-api.log"
echo ""

echo "Stop services:"
echo "  • Gateway HTTP:     pkill -f gateway-http.js"
echo "  • Dashboard API:    pkill -f 'api/server.js'"
echo "  • All:              bash scripts/stop-all.sh"
echo ""

echo -e "${GREEN}🚀 Cecelia Quality Platform is ready!${NC}"
