#!/bin/bash
# Complete MVP Demo - End-to-end demonstration
# Runs the entire Cecelia Quality Platform in a single command

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

banner() {
  echo -e "${CYAN}"
  cat <<'EOF'
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║      Cecelia Quality Platform - MVP Demo                ║
║                                                          ║
║      VPS = 大脑 | Notion = UI | QA = 免疫系统            ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
EOF
  echo -e "${NC}"
}

step() {
  local step_num="$1"
  local step_name="$2"
  echo ""
  echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Step $step_num: $step_name${NC}"
  echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

success() {
  echo -e "${GREEN}✅ $1${NC}"
}

error() {
  echo -e "${RED}❌ $1${NC}"
}

warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

info() {
  echo -e "${CYAN}ℹ️  $1${NC}"
}

# Change to project root
cd "$PROJECT_ROOT"

# Start demo
banner

# ============================================
# Step 1: Initialize Database
# ============================================
step "1" "Initialize Database"

if [[ -f "db/cecelia.db" ]]; then
  warning "Database already exists, skipping initialization"
else
  bash scripts/db-init.sh init
  success "Database initialized"
fi

echo ""
bash scripts/db-init.sh stats

# ============================================
# Step 2: Start Gateway HTTP Server (Background)
# ============================================
step "2" "Start Gateway HTTP Server"

# Check if already running
if pgrep -f "gateway-http.js" > /dev/null; then
  warning "Gateway HTTP already running"
else
  nohup node gateway/gateway-http.js > /tmp/gateway-http.log 2>&1 &
  local gateway_pid=$!
  sleep 2

  # Check if started successfully
  if pgrep -f "gateway-http.js" > /dev/null; then
    success "Gateway HTTP started (PID: $gateway_pid)"
    info "Logs: tail -f /tmp/gateway-http.log"
  else
    error "Failed to start Gateway HTTP"
    exit 1
  fi
fi

# Test health endpoint
echo ""
echo "Testing Gateway HTTP..."
curl -s http://localhost:5680/health | jq .

# ============================================
# Step 3: Enqueue Tasks
# ============================================
step "3" "Enqueue Test Tasks"

echo "Enqueuing 3 test tasks..."
echo ""

# Task 1: runQA (P0)
echo "1. Task: runQA (P0)"
bash gateway/gateway.sh add cloudcode runQA P0 '{
  "project": "cecelia-quality",
  "branch": "develop",
  "scope": "pr"
}' | grep -E "(✅|📊)"

# Task 2: fixBug (P1)
echo ""
echo "2. Task: fixBug (P1)"
bash gateway/gateway.sh add notion fixBug P1 '{
  "project": "zenithjoy-engine",
  "branch": "fix/auth-bug",
  "issue": "#123"
}' | grep -E "(✅|📊)"

# Task 3: optimizeSelf (P2)
echo ""
echo "3. Task: optimizeSelf (P2)"
bash gateway/gateway.sh add heartbeat optimizeSelf P2 '{
  "reason": "demo_check"
}' | grep -E "(✅|📊)"

echo ""
success "3 tasks enqueued"

# Show queue status
echo ""
bash gateway/gateway.sh status

# ============================================
# Step 4: Heartbeat Check
# ============================================
step "4" "Heartbeat Check"

bash heartbeat/heartbeat.sh

# ============================================
# Step 5: Worker Execution
# ============================================
step "5" "Worker Execution"

info "Processing tasks from queue..."
echo ""

# Process first task
bash worker/worker.sh

echo ""
success "First task processed"

# ============================================
# Step 6: Check Results
# ============================================
step "6" "Check Results"

echo "Recent runs:"
echo ""
bash scripts/db-api.sh system:health | jq .

echo ""
echo "Active tasks:"
bash scripts/db-api.sh tasks:active | jq -r '.[] | "- [\(.status)] \(.title) (priority: \(.priority))"' 2>/dev/null || echo "  (No active tasks)"

echo ""
echo "Run directories:"
ls -lh runs/ | tail -5 || echo "  (No runs yet)"

# ============================================
# Step 7: Generate Summary
# ============================================
step "7" "Generate Summary"

# Find latest run
LATEST_RUN=$(ls -t runs/ | head -1 || echo "")

if [[ -n "$LATEST_RUN" && -d "runs/$LATEST_RUN" ]]; then
  echo "Latest run: $LATEST_RUN"
  echo ""

  if [[ -f "runs/$LATEST_RUN/task.json" ]]; then
    echo "Task details:"
    cat "runs/$LATEST_RUN/task.json" | jq .
  fi

  echo ""

  if [[ -f "runs/$LATEST_RUN/result.json" ]]; then
    echo "Result:"
    cat "runs/$LATEST_RUN/result.json" | jq .
  fi

  echo ""

  if [[ -d "runs/$LATEST_RUN/evidence" ]]; then
    echo "Evidence files:"
    ls -lh "runs/$LATEST_RUN/evidence/" || echo "  (No evidence)"
  fi
else
  warning "No runs found"
fi

# ============================================
# Step 8: Notion Sync (Simulated)
# ============================================
step "8" "Notion Sync (Simulated)"

if [[ -n "${NOTION_TOKEN:-}" ]]; then
  info "NOTION_TOKEN found, running real sync..."
  bash scripts/notion-sync.sh
else
  warning "NOTION_TOKEN not set, simulating sync..."

  echo ""
  echo "To enable real Notion sync:"
  echo "  1. Get your Notion API token"
  echo "  2. Create two databases: System State, System Runs"
  echo "  3. Set environment variables:"
  echo ""
  echo "  export NOTION_TOKEN='secret_xxx'"
  echo "  export NOTION_STATE_DB_ID='database-id-1'"
  echo "  export NOTION_RUNS_DB_ID='database-id-2'"
  echo ""

  # Simulate sync
  echo "Simulating Notion sync..."
  sleep 1
  success "State synced (simulated)"
  success "Runs synced (simulated)"

  # Update DB
  sqlite3 db/cecelia.db "UPDATE system_state SET value = '\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"', updated_at = datetime('now')
                         WHERE key = 'last_sync_notion';"
fi

# ============================================
# Step 9: Final State
# ============================================
step "9" "Final System State"

echo "Queue status:"
bash gateway/gateway.sh status

echo ""
echo "System health:"
bash scripts/db-api.sh system:health | jq .

echo ""
echo "State file:"
cat state/state.json | jq . 2>/dev/null || echo "{}" | jq .

# ============================================
# Summary
# ============================================
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Demo Complete!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo ""
echo "What just happened:"
echo "  1. ✅ Database initialized (SQLite)"
echo "  2. ✅ Gateway HTTP server started"
echo "  3. ✅ 3 tasks enqueued (P0, P1, P2)"
echo "  4. ✅ Heartbeat checked system health"
echo "  5. ✅ Worker processed first task"
echo "  6. ✅ Results written to runs/<runId>/"
echo "  7. ✅ Summary generated"
echo "  8. ✅ Notion sync (simulated)"
echo "  9. ✅ Final state updated"

echo ""
echo "Next steps:"
echo "  • Check logs: tail -f /tmp/gateway-http.log"
echo "  • View runs: ls -lh runs/"
echo "  • Query DB: bash scripts/db-init.sh query 'SELECT * FROM tasks;'"
echo "  • Process more: bash worker/worker.sh"
echo "  • Stop gateway: pkill -f gateway-http.js"

echo ""
echo "Gateway HTTP API:"
echo "  POST http://localhost:5680/enqueue"
echo "  POST http://localhost:5680/add"
echo "  GET  http://localhost:5680/status"
echo "  GET  http://localhost:5680/health"

echo ""
echo -e "${CYAN}Cecelia Quality Platform - Ready to serve!${NC}"
echo ""
