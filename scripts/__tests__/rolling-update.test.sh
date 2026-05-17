#!/usr/bin/env bash
#
# Tests for rolling-update.sh
#
# These are static code quality checks, not integration tests.
# Integration tests require actual Docker environment and running Brain.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROLLING_UPDATE_SCRIPT="$ROOT_DIR/scripts/rolling-update.sh"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0

# Test helper functions
pass() {
  echo -e "${GREEN}✓${NC} $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo -e "${RED}✗${NC} $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

echo "Testing rolling-update.sh..."
echo ""

# ============================================================
# Test 1: Script exists
# ============================================================
if [ -f "$ROLLING_UPDATE_SCRIPT" ]; then
  pass "Script exists at scripts/rolling-update.sh"
else
  fail "Script does not exist at scripts/rolling-update.sh"
fi

# ============================================================
# Test 2: Script is executable
# ============================================================
if [ -x "$ROLLING_UPDATE_SCRIPT" ]; then
  pass "Script is executable"
else
  fail "Script is not executable (missing chmod +x)"
fi

# ============================================================
# Test 3: Script has error handling (set -euo pipefail)
# ============================================================
if grep -q "set -euo pipefail" "$ROLLING_UPDATE_SCRIPT"; then
  pass "Script has error handling (set -euo pipefail)"
else
  fail "Script missing error handling (set -euo pipefail)"
fi

# ============================================================
# Test 4: Script has shebang
# ============================================================
if head -1 "$ROLLING_UPDATE_SCRIPT" | grep -q "#!/usr/bin/env bash"; then
  pass "Script has correct shebang"
else
  fail "Script missing or incorrect shebang"
fi

# ============================================================
# Test 5: Script defines required variables
# ============================================================
if grep -q "BLUE_CONTAINER=" "$ROLLING_UPDATE_SCRIPT" && \
   grep -q "GREEN_CONTAINER=" "$ROLLING_UPDATE_SCRIPT"; then
  pass "Script defines container name variables"
else
  fail "Script missing container name variables"
fi

# ============================================================
# Test 6: Script has health check logic
# ============================================================
if grep -q "api/brain/health" "$ROLLING_UPDATE_SCRIPT"; then
  pass "Script includes health check logic"
else
  fail "Script missing health check logic"
fi

# ============================================================
# Test 7: Script has rollback logic
# ============================================================
if grep -q "Rolling back" "$ROLLING_UPDATE_SCRIPT"; then
  pass "Script includes rollback logic"
else
  fail "Script missing rollback logic"
fi

# ============================================================
# Test 8: Script respects ENV_REGION
# ============================================================
if grep -q "ENV_REGION" "$ROLLING_UPDATE_SCRIPT"; then
  pass "Script respects ENV_REGION variable"
else
  fail "Script missing ENV_REGION support"
fi

# ============================================================
# Test 9: Script calls brain-build.sh
# ============================================================
if grep -q "brain-build.sh" "$ROLLING_UPDATE_SCRIPT"; then
  pass "Script calls brain-build.sh"
else
  fail "Script does not call brain-build.sh"
fi

# ============================================================
# Test 10: Script has clear output (step markers)
# ============================================================
if grep -q "\[1/6\]" "$ROLLING_UPDATE_SCRIPT" && \
   grep -q "\[6/6\]" "$ROLLING_UPDATE_SCRIPT"; then
  pass "Script has clear step markers"
else
  fail "Script missing step markers"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed:${NC} $TESTS_PASSED"
echo -e "${RED}Failed:${NC} $TESTS_FAILED"
echo "=========================================="

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
