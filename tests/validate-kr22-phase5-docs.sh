#!/bin/bash
# validate-kr22-phase5-docs.sh
# Validation tests for KR2.2 Phase 5 planning documents

set -e

echo "🧪 Validating KR2.2 Phase 5 documentation..."

FAILED=0

# Test 1: Check if implementation plan exists
echo "Test 1: Implementation plan file exists"
if [[ -f "docs/planning/KR22_PHASE5_IMPLEMENTATION_PLAN.md" ]]; then
    echo "  ✅ PASS: Implementation plan file exists"
else
    echo "  ❌ FAIL: Implementation plan file not found"
    FAILED=$((FAILED + 1))
fi

# Test 2: Check if plan has frontmatter with version
echo "Test 2: Implementation plan has version frontmatter"
if grep -q "^version:" docs/planning/KR22_PHASE5_IMPLEMENTATION_PLAN.md 2>/dev/null; then
    echo "  ✅ PASS: Version frontmatter found"
else
    echo "  ❌ FAIL: Version frontmatter not found"
    FAILED=$((FAILED + 1))
fi

# Test 3: Check if plan contains all 5 tasks
echo "Test 3: Implementation plan contains all 5 tasks"
TASK_COUNT=$(grep -c "^### Task 5\." docs/planning/KR22_PHASE5_IMPLEMENTATION_PLAN.md 2>/dev/null || echo "0")
if [[ "$TASK_COUNT" -eq 5 ]]; then
    echo "  ✅ PASS: All 5 tasks found ($TASK_COUNT)"
else
    echo "  ❌ FAIL: Expected 5 tasks, found $TASK_COUNT"
    FAILED=$((FAILED + 1))
fi

# Test 4: Check if plan has risk analysis
echo "Test 4: Implementation plan has risk analysis"
if grep -q "Risk Analysis" docs/planning/KR22_PHASE5_IMPLEMENTATION_PLAN.md 2>/dev/null; then
    echo "  ✅ PASS: Risk analysis section found"
else
    echo "  ❌ FAIL: Risk analysis section not found"
    FAILED=$((FAILED + 1))
fi

# Test 5: Check if plan has timeline
echo "Test 5: Implementation plan has timeline"
if grep -q "Timeline" docs/planning/KR22_PHASE5_IMPLEMENTATION_PLAN.md 2>/dev/null; then
    echo "  ✅ PASS: Timeline section found"
else
    echo "  ❌ FAIL: Timeline section not found"
    FAILED=$((FAILED + 1))
fi

# Test 6: Check if QA decision exists
echo "Test 6: QA decision file exists"
if [[ -f "docs/QA-DECISION-kr22-phase5.md" ]]; then
    echo "  ✅ PASS: QA decision file exists"
else
    echo "  ❌ FAIL: QA decision file not found"
    FAILED=$((FAILED + 1))
fi

# Test 7: Check if QA decision has required fields
echo "Test 7: QA decision has required schema fields"
if grep -q "Decision.*NO_RCI\|MUST_ADD_RCI\|UPDATE_RCI" docs/QA-DECISION-kr22-phase5.md 2>/dev/null && \
   grep -q "Priority.*P[012]" docs/QA-DECISION-kr22-phase5.md 2>/dev/null; then
    echo "  ✅ PASS: Required schema fields found"
else
    echo "  ❌ FAIL: Required schema fields missing"
    FAILED=$((FAILED + 1))
fi

# Test 8: Check if DoD references QA decision
echo "Test 8: DoD references QA decision"
if grep -q "QA: docs/QA-DECISION-kr22-phase5.md" .dod-kr22-phase5.md 2>/dev/null; then
    echo "  ✅ PASS: DoD references QA decision"
else
    echo "  ❌ FAIL: DoD does not reference QA decision"
    FAILED=$((FAILED + 1))
fi

# Test 9: Check if key documents have proper frontmatter (PRD and Implementation Plan required)
echo "Test 9: Key documents have frontmatter"
DOCS_WITH_FRONTMATTER=0
REQUIRED_DOCS=0
for doc in .prd-kr22-phase5.md docs/planning/KR22_PHASE5_IMPLEMENTATION_PLAN.md; do
    REQUIRED_DOCS=$((REQUIRED_DOCS + 1))
    if grep -q "^version:" "$doc" 2>/dev/null; then
        DOCS_WITH_FRONTMATTER=$((DOCS_WITH_FRONTMATTER + 1))
    fi
done
if [[ "$DOCS_WITH_FRONTMATTER" -eq "$REQUIRED_DOCS" ]]; then
    echo "  ✅ PASS: All $REQUIRED_DOCS key documents have frontmatter"
else
    echo "  ❌ FAIL: Only $DOCS_WITH_FRONTMATTER/$REQUIRED_DOCS key documents have frontmatter"
    FAILED=$((FAILED + 1))
fi

# Test 10: Check if gate files exist
echo "Test 10: Gate files exist (prd, dod, qa, audit)"
GATE_COUNT=0
for gate in prd dod qa audit; do
    if [[ -f ".gates/${gate}.gate" ]]; then
        GATE_COUNT=$((GATE_COUNT + 1))
    fi
done
if [[ "$GATE_COUNT" -eq 4 ]]; then
    echo "  ✅ PASS: All 4 gate files exist"
else
    echo "  ❌ FAIL: Only $GATE_COUNT/4 gate files exist"
    FAILED=$((FAILED + 1))
fi

echo ""
echo "======================================"
if [[ "$FAILED" -eq 0 ]]; then
    echo "✅ ALL TESTS PASSED (10/10)"
    exit 0
else
    echo "❌ TESTS FAILED: $FAILED/10 tests failed"
    exit 1
fi
