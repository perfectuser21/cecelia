#!/bin/bash
set -euo pipefail

################################################################################
# Codex Immune Check Script
# 
# Purpose: Check Cecelia immune system health and collect diagnostic data
# Called by: Brain tick.js via codex_qa task
################################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/packages/.codex-immune-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/immune-$TIMESTAMP.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Logging function
log() {
  echo -e "$1" | tee -a "$LOG_FILE"
}

log_section() {
  log "\n=========================================="
  log "$1"
  log "=========================================="
}

# Start
log_section "Codex Immune Check Started"
log "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Log file: $LOG_FILE"

# D4: Health Check - Brain API
log_section "D4: Brain API Status"
BRAIN_URL="http://localhost:5221"

# Check if Brain is running
if curl -s --max-time 5 "$BRAIN_URL/api/health" > /dev/null 2>&1; then
  log "${GREEN}✓ Brain API is reachable${NC}"
  
  # Try to get immune system status
  log "\nQuerying immune system status..."
  IMMUNE_STATUS=$(curl -s --max-time 10 "$BRAIN_URL/api/immune/status" 2>&1 || echo '{"error":"failed"}')
  log "API Response: $IMMUNE_STATUS"
else
  log "${RED}✗ Brain API is not reachable at $BRAIN_URL${NC}"
  log "Please ensure Brain is running: cd $PROJECT_ROOT/packages/brain && npm start"
  exit 1
fi

# D5: Data Check - Query immune system tables via API
log_section "D5: Immune System Data"

# Get failure signatures
log "\n--- Failure Signatures (Top 10) ---"
SIGNATURES=$(curl -s --max-time 10 "$BRAIN_URL/api/immune/signatures?limit=10" 2>&1 || echo '[]')
log "failure_signatures count: $(echo "$SIGNATURES" | jq '. | length' 2>/dev/null || echo 0)"
echo "$SIGNATURES" | jq '.' >> "$LOG_FILE" 2>&1 || log "Failed to parse signatures"

# Get absorption policies
log "\n--- Absorption Policies ---"
POLICIES=$(curl -s --max-time 10 "$BRAIN_URL/api/immune/policies" 2>&1 || echo '[]')
log "absorption_policies count: $(echo "$POLICIES" | jq '. | length' 2>/dev/null || echo 0)"
echo "$POLICIES" | jq '.' >> "$LOG_FILE" 2>&1 || log "Failed to parse policies"

# Get recent policy evaluations
log "\n--- Recent Policy Evaluations (Last 24h) ---"
EVALUATIONS=$(curl -s --max-time 10 "$BRAIN_URL/api/immune/evaluations?hours=24" 2>&1 || echo '[]')
log "policy_evaluations count (24h): $(echo "$EVALUATIONS" | jq '. | length' 2>/dev/null || echo 0)"
echo "$EVALUATIONS" | jq '.' >> "$LOG_FILE" 2>&1 || log "Failed to parse evaluations"

# Summary
log_section "Summary"
SIG_COUNT=$(echo "$SIGNATURES" | jq '. | length' 2>/dev/null || echo 0)
POL_COUNT=$(echo "$POLICIES" | jq '. | length' 2>/dev/null || echo 0)
EVAL_COUNT=$(echo "$EVALUATIONS" | jq '. | length' 2>/dev/null || echo 0)

log "Failure Signatures: $SIG_COUNT"
log "Absorption Policies: $POL_COUNT"
log "Policy Evaluations (24h): $EVAL_COUNT"

if [ "$SIG_COUNT" -eq 0 ] && [ "$POL_COUNT" -eq 0 ]; then
  log "${GREEN}✓ Immune system is clean (no failures tracked)${NC}"
elif [ "$POL_COUNT" -gt 0 ]; then
  log "${YELLOW}⚠ Active policies detected - system is learning from failures${NC}"
else
  log "${YELLOW}⚠ Failures detected but no policies yet${NC}"
fi

# End
log_section "Codex Immune Check Completed"
log "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Full log: $LOG_FILE"

exit 0
