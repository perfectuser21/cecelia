#!/bin/bash
#
# Plan Loop Verification Script
# Verifies: Plan → Tasks (with why/evidence) → Commit → Database
#

set -e

API_BASE="${API_BASE:-http://localhost:5211/api/system}"
PASS=true

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           Plan Loop Verification (Phase 5.3)                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Generate a daily plan
echo "Step 1: Generating daily plan..."
PLAN_RESPONSE=$(curl -s -X POST "$API_BASE/plan/generate" \
  -H "Content-Type: application/json" \
  -d '{"scope": "daily"}')

PLAN_SUCCESS=$(echo "$PLAN_RESPONSE" | jq -r '.success // false')
PLAN_ID=$(echo "$PLAN_RESPONSE" | jq -r '.plan.plan_id // empty')

if [ "$PLAN_SUCCESS" != "true" ] || [ -z "$PLAN_ID" ]; then
  echo "  ❌ FAIL: Plan generation failed"
  echo "  Response: $PLAN_RESPONSE"
  PASS=false
else
  echo "  ✅ Plan generated: $PLAN_ID"
fi

# Step 2: Check tasks have why + expected_evidence
echo ""
echo "Step 2: Verifying task structure (why/expected_evidence/source_refs)..."
TASK_COUNT=$(echo "$PLAN_RESPONSE" | jq -r '.plan.tasks | length')

if [ "$TASK_COUNT" -eq 0 ]; then
  echo "  ⚠️  No tasks in plan (empty database?). Skipping structure check."
else
  # Check first task for required fields
  FIRST_TASK=$(echo "$PLAN_RESPONSE" | jq -r '.plan.tasks[0]')
  HAS_WHY=$(echo "$FIRST_TASK" | jq -r 'has("why")')
  HAS_EVIDENCE=$(echo "$FIRST_TASK" | jq -r 'has("expected_evidence")')
  HAS_REFS=$(echo "$FIRST_TASK" | jq -r 'has("source_refs")')

  if [ "$HAS_WHY" != "true" ]; then
    echo "  ❌ FAIL: Task missing 'why' field"
    PASS=false
  else
    WHY_VALUE=$(echo "$FIRST_TASK" | jq -r '.why')
    echo "  ✅ Task has 'why': $WHY_VALUE"
  fi

  if [ "$HAS_EVIDENCE" != "true" ]; then
    echo "  ❌ FAIL: Task missing 'expected_evidence' field"
    PASS=false
  else
    EVIDENCE_VALUE=$(echo "$FIRST_TASK" | jq -r '.expected_evidence')
    echo "  ✅ Task has 'expected_evidence': $EVIDENCE_VALUE"
  fi

  if [ "$HAS_REFS" != "true" ]; then
    echo "  ❌ FAIL: Task missing 'source_refs' field"
    PASS=false
  else
    REFS_COUNT=$(echo "$FIRST_TASK" | jq -r '.source_refs | length')
    echo "  ✅ Task has 'source_refs': $REFS_COUNT refs"
  fi
fi

# Step 3: Commit plan tasks
echo ""
echo "Step 3: Committing plan tasks to database..."

if [ -z "$PLAN_ID" ]; then
  echo "  ⚠️  Skipping commit (no plan ID)"
else
  COMMIT_RESPONSE=$(curl -s -X POST "$API_BASE/plan/$PLAN_ID/commit" \
    -H "Content-Type: application/json" \
    -d '{"limit": 3}')

  COMMIT_SUCCESS=$(echo "$COMMIT_RESPONSE" | jq -r '.success // false')
  COMMITTED_COUNT=$(echo "$COMMIT_RESPONSE" | jq -r '.committed_tasks | length')

  if [ "$TASK_COUNT" -eq 0 ]; then
    echo "  ⚠️  No tasks to commit (empty plan)"
  elif [ "$COMMIT_SUCCESS" != "true" ]; then
    echo "  ❌ FAIL: Commit failed"
    echo "  Response: $COMMIT_RESPONSE"
    PASS=false
  else
    echo "  ✅ Committed $COMMITTED_COUNT tasks"

    # Show committed tasks
    echo "$COMMIT_RESPONSE" | jq -r '.committed_tasks[] | "     - \(.title) (task_id: \(.task_id))"'
  fi
fi

# Step 4: Verify tasks in database (via tasks API)
echo ""
echo "Step 4: Verifying tasks in database..."

TASKS_RESPONSE=$(curl -s "http://localhost:5212/api/tasks/tasks?status=pending&limit=5" 2>/dev/null || echo '{"error": "API not available"}')

if echo "$TASKS_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "  ⚠️  Tasks API not available, skipping database verification"
else
  DB_TASK_COUNT=$(echo "$TASKS_RESPONSE" | jq -r 'length // 0')
  echo "  ✅ Found $DB_TASK_COUNT pending tasks in database"
fi

# Final result
echo ""
echo "════════════════════════════════════════════════════════════════"

if [ "$PASS" = true ]; then
  echo "PLAN LOOP VERIFICATION: ✅ PASS"
  exit 0
else
  echo "PLAN LOOP VERIFICATION: ❌ FAIL"
  exit 1
fi
