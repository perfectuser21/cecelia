#!/bin/bash
# Cecelia System Verification Script
# Run daily or after deployments to verify system health

PASS=0
FAIL=0
WARN=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
  local name="$1"
  local result="$2"
  local expected="$3"

  if [[ "$result" == *"$expected"* ]]; then
    echo -e "${GREEN}✓${NC} $name"
    PASS=$((PASS+1))
  else
    echo -e "${RED}✗${NC} $name"
    echo "  Expected: $expected"
    echo "  Got: $result"
    FAIL=$((FAIL+1))
  fi
}

warn_check() {
  local name="$1"
  local result="$2"
  local expected="$3"

  if [[ "$result" == *"$expected"* ]]; then
    echo -e "${GREEN}✓${NC} $name"
    PASS=$((PASS+1))
  else
    echo -e "${YELLOW}⚠${NC} $name (non-critical)"
    WARN=$((WARN+1))
  fi
}

echo "============================================"
echo "Cecelia System Verification"
echo "============================================"
echo ""

# 1. Direct Service Health Checks
echo "1. Direct Service Health Checks"
echo "--------------------------------"

# Brain (5220)
BRAIN_HEALTH=$(curl -s --max-time 5 http://localhost:5220/health 2>/dev/null || echo "TIMEOUT")
check "Brain API (5220)" "$BRAIN_HEALTH" '"status":"healthy"'

# Quality (5681)
QUALITY_HEALTH=$(curl -s --max-time 5 http://localhost:5681/api/health 2>/dev/null || echo "TIMEOUT")
check "Quality API (5681)" "$QUALITY_HEALTH" '"status":"ok"'

# N8N (5679)
N8N_HEALTH=$(curl -s --max-time 5 http://localhost:5679/healthz 2>/dev/null || echo "TIMEOUT")
check "N8N Workflows (5679)" "$N8N_HEALTH" '"status":"ok"'

# Workspace (5211)
WORKSPACE_HEALTH=$(curl -s --max-time 5 http://localhost:5211/api/system/health 2>/dev/null || echo "TIMEOUT")
check "Workspace (5211)" "$WORKSPACE_HEALTH" '"status":"healthy"'

echo ""

# 2. Aggregated System Status
echo "2. Aggregated System Status"
echo "--------------------------------"

SYSTEM_STATUS=$(curl -s --max-time 10 http://localhost:5211/api/system/status 2>/dev/null || echo "TIMEOUT")
HEALTH=$(echo "$SYSTEM_STATUS" | jq -r '.data.health' 2>/dev/null || echo "ERROR")
check "Overall health" "$HEALTH" "ok"

BRAIN_AGG=$(echo "$SYSTEM_STATUS" | jq -r '.data.brain.health' 2>/dev/null || echo "ERROR")
check "Brain aggregated status" "$BRAIN_AGG" "ok"

QUALITY_AGG=$(echo "$SYSTEM_STATUS" | jq -r '.data.quality.health' 2>/dev/null || echo "ERROR")
check "Quality aggregated status" "$QUALITY_AGG" "ok"

WORKFLOWS_AGG=$(echo "$SYSTEM_STATUS" | jq -r '.data.workflows.health' 2>/dev/null || echo "ERROR")
check "Workflows aggregated status" "$WORKFLOWS_AGG" "ok"

echo ""

# 3. Panorama Services
echo "3. Panorama Services"
echo "--------------------------------"

PANORAMA=$(curl -s --max-time 10 http://localhost:5211/api/panorama/full 2>/dev/null || echo "TIMEOUT")
BRAIN_SVC=$(echo "$PANORAMA" | jq -r '.data.services[] | select(.name=="semantic-brain") | .status' 2>/dev/null || echo "ERROR")
check "Brain in panorama" "$BRAIN_SVC" "up"

QUALITY_SVC=$(echo "$PANORAMA" | jq -r '.data.services[] | select(.name=="quality") | .status' 2>/dev/null || echo "ERROR")
check "Quality in panorama" "$QUALITY_SVC" "up"

N8N_SVC=$(echo "$PANORAMA" | jq -r '.data.services[] | select(.name=="n8n") | .status' 2>/dev/null || echo "ERROR")
check "N8N in panorama" "$N8N_SVC" "up"

echo ""

# 4. Boundary Verification
echo "4. Boundary Verification"
echo "--------------------------------"

# Brain should NOT have execution endpoints
BRAIN_EXEC=$(curl -s --max-time 3 http://localhost:5220/execute 2>/dev/null || echo "NOT_FOUND")
# Both "Not Found" and "Cannot" are valid 404 responses
if [[ "$BRAIN_EXEC" == *"Not Found"* ]] || [[ "$BRAIN_EXEC" == *"Cannot"* ]]; then
  echo -e "${GREEN}✓${NC} Brain has no /execute endpoint"
  PASS=$((PASS+1))
else
  echo -e "${RED}✗${NC} Brain has no /execute endpoint"
  FAIL=$((FAIL+1))
fi

# Quality should NOT have scheduling endpoints
QUALITY_SCHED=$(curl -s --max-time 3 http://localhost:5681/api/schedule 2>/dev/null || echo "NOT_FOUND")
# Both "Not Found" and "Cannot" are valid 404 responses
if [[ "$QUALITY_SCHED" == *"Not Found"* ]] || [[ "$QUALITY_SCHED" == *"Cannot"* ]]; then
  echo -e "${GREEN}✓${NC} Quality has no /schedule endpoint"
  PASS=$((PASS+1))
else
  echo -e "${RED}✗${NC} Quality has no /schedule endpoint"
  FAIL=$((FAIL+1))
fi

echo ""

# 5. Proxy Verification
echo "5. Proxy Verification"
echo "--------------------------------"

# /api/quality/* should proxy to Quality
PROXY_QUALITY=$(curl -s --max-time 5 http://localhost:5211/api/quality/health 2>/dev/null || echo "TIMEOUT")
check "Quality proxy working" "$PROXY_QUALITY" '"status":"ok"'

# /api/orchestrator/* should proxy to Brain
PROXY_ORCH=$(curl -s --max-time 5 http://localhost:5211/api/orchestrator/health 2>/dev/null || echo "TIMEOUT")
warn_check "Orchestrator proxy working" "$PROXY_ORCH" "status"

echo ""

# Summary
echo "============================================"
echo "Summary"
echo "============================================"
echo -e "Passed: ${GREEN}$PASS${NC}"
echo -e "Failed: ${RED}$FAIL${NC}"
echo -e "Warnings: ${YELLOW}$WARN${NC}"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}VERIFICATION FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}VERIFICATION PASSED${NC}"
  exit 0
fi
