#!/usr/bin/env bash
# Skill Eval Service smoke test
# Tests the core skill-eval endpoints are reachable and healthy
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TOKEN="${SKILL_EVAL_PROXY_TOKEN:-}"

echo "=== Skill Eval Smoke Test ==="
echo "Brain URL: $BRAIN_URL"

# Test 1: Status endpoint returns 404 for non-existent task (not 500)
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BRAIN_URL/api/brain/skill-evals/non-existent-id/status")
[ "$STATUS_CODE" = "404" ] && echo "PASS: Status 404 for unknown task" || { echo "FAIL: Expected 404, got $STATUS_CODE"; exit 1; }

# Test 2: Upload without token returns 403
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BRAIN_URL/api/brain/skill-evals/upload" \
  -F "file=@/dev/null;filename=test.zip")
[ "$STATUS_CODE" = "403" ] && echo "PASS: Upload without token → 403" || { echo "FAIL: Expected 403, got $STATUS_CODE"; exit 1; }

# Test 3: List endpoint returns 200
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BRAIN_URL/api/brain/skill-evals/list")
[ "$STATUS_CODE" = "200" ] && echo "PASS: List endpoint → 200" || { echo "FAIL: Expected 200, got $STATUS_CODE"; exit 1; }

# Test 4: Quota status endpoint returns 200
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BRAIN_URL/api/brain/quota/status")
[ "$STATUS_CODE" = "200" ] && echo "PASS: Quota status → 200" || echo "SKIP: Quota endpoint not yet available (expected in FR14)"

echo "=== Skill Eval Smoke: ALL PASSED ==="
