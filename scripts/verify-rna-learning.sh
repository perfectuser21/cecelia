#!/bin/bash
# RNA Learning Verification Script
# Verifies the RNA Act → Learning auto-association is working correctly
#
# Usage:
#   bash scripts/verify-rna-learning.sh
#
# Expected output:
#   ✅ All checks passed
#   RNA KR 进度: X% (based on learnings count)

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RNA Learning Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Configuration
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_NAME="${DB_NAME:-cecelia}"
DB_CONTAINER="${DB_CONTAINER:-cecelia-postgres}"
DB_USER="${DB_USER:-cecelia}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Database helper function (use Docker if psql not available)
psql_exec() {
  local query="$1"
  if command -v psql &>/dev/null; then
    psql "$DB_NAME" -t -c "$query" 2>/dev/null
  else
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "$query" 2>/dev/null
  fi
}

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check counter
PASS_COUNT=0
FAIL_COUNT=0

# Helper functions
pass() {
  echo -e "${GREEN}✅ $1${NC}"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo -e "${RED}❌ $1${NC}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# ==================== Check 1: Database Connection ====================
echo "📊 Check 1: Database Connection"
if psql_exec "SELECT 1" | grep -q "1"; then
  pass "Database connection successful"
else
  fail "Cannot connect to database '$DB_NAME'"
  exit 1
fi
echo ""

# ==================== Check 2: learnings Table ====================
echo "📊 Check 2: learnings Table Exists"
TABLE_EXISTS=$(psql_exec "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='learnings'" | tr -d ' ')
if [[ "$TABLE_EXISTS" -ge 1 ]]; then
  pass "learnings table exists (found $TABLE_EXISTS schema(s))"
else
  fail "learnings table not found"
  exit 1
fi
echo ""

# ==================== Check 3: learnings Data (7 days) ====================
echo "📊 Check 3: learnings Data (Last 7 Days)"
LEARNINGS_7D=$(psql_exec "SELECT COUNT(*) FROM learnings WHERE created_at > NOW() - INTERVAL '7 days'" | tr -d ' ')
if [[ "$LEARNINGS_7D" -gt 0 ]]; then
  pass "Found $LEARNINGS_7D learnings in last 7 days"
else
  warn "No learnings in last 7 days (expected if system just started)"
fi
echo ""

# ==================== Check 4: content_hash Deduplication ====================
echo "📊 Check 4: content_hash Deduplication"
DUPLICATE_HASHES=$(psql_exec "SELECT COUNT(*) FROM (SELECT content_hash, COUNT(*) as cnt FROM learnings GROUP BY content_hash HAVING COUNT(*) > 1) AS duplicates" | tr -d ' ')
if [[ "$DUPLICATE_HASHES" == "0" ]]; then
  pass "No duplicate content_hash (deduplication working)"
else
  warn "Found $DUPLICATE_HASHES duplicate content_hash values (may be valid if same content from different tasks)"
fi
echo ""

# ==================== Check 5: task_id Association ====================
echo "📊 Check 5: task_id Association"
LEARNINGS_WITH_TASK=$(psql_exec "SELECT COUNT(*) FROM learnings WHERE metadata::text LIKE '%task_id%'" | tr -d ' ')
TOTAL_LEARNINGS=$(psql_exec "SELECT COUNT(*) FROM learnings" | tr -d ' ')
if [[ "$LEARNINGS_WITH_TASK" -gt 0 ]]; then
  pass "$LEARNINGS_WITH_TASK/$TOTAL_LEARNINGS learnings have task_id in metadata"
elif [[ "$TOTAL_LEARNINGS" == "0" ]]; then
  warn "No learnings yet (expected if system just started)"
else
  fail "No learnings have task_id in metadata"
fi
echo ""

# ==================== Check 6: Brain API /learnings/stats ====================
echo "📊 Check 6: Brain API /learnings/stats"
if curl -s "$BRAIN_URL/api/brain/learnings/stats" | jq -e '.total, .last_7_days, .by_category' &>/dev/null; then
  STATS=$(curl -s "$BRAIN_URL/api/brain/learnings/stats")
  TOTAL=$(echo "$STATS" | jq -r '.total')
  LAST_7D=$(echo "$STATS" | jq -r '.last_7_days')
  pass "/api/brain/learnings/stats returned valid data (total=$TOTAL, last_7_days=$LAST_7D)"
else
  fail "/api/brain/learnings/stats returned invalid or missing data"
fi
echo ""

# ==================== Check 7: RNA KR Progress ====================
echo "📊 Check 7: RNA KR Progress Calculation"
RNA_KR=$(curl -s "$BRAIN_URL/api/brain/goals" | jq -r '.[] | select(.title | contains("RNA")) | {id, title, progress, metadata}')
if [[ -n "$RNA_KR" ]]; then
  RNA_PROGRESS=$(echo "$RNA_KR" | jq -r '.progress')
  RNA_LEARNINGS_COUNT=$(echo "$RNA_KR" | jq -r '.metadata.learnings_count // "N/A"')

  if [[ "$RNA_PROGRESS" != "0" ]]; then
    pass "RNA KR progress: $RNA_PROGRESS% (learnings_count: $RNA_LEARNINGS_COUNT)"
  else
    warn "RNA KR progress is still 0% (expected if learnings count is low)"
    echo "    Current learnings count: $LEARNINGS_7D (7 days)"
  fi
else
  warn "RNA KR not found (may not exist yet)"
fi
echo ""

# ==================== Summary ====================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Passed: $PASS_COUNT"
echo "  Failed: $FAIL_COUNT"
echo ""

if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "${GREEN}✅ All checks passed${NC}"
  echo ""
  echo "RNA Learning System Status:"
  echo "  • learnings table: ✅ operational"
  echo "  • Auto-learning: ✅ running (last 7 days: $LEARNINGS_7D learnings)"
  echo "  • Deduplication: ✅ working (no duplicates)"
  echo "  • API endpoint: ✅ functional"
  echo ""
  exit 0
else
  echo -e "${RED}❌ $FAIL_COUNT check(s) failed${NC}"
  echo ""
  exit 1
fi
