#!/bin/bash
# Smoke test: review-env-manager API endpoints
set -e

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# Check allocate endpoint exists
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/harness/review-env/allocate" \
  -H "Content-Type: application/json" -d '{}')
# 400 = endpoint exists (missing initiative_id → validation error)
# 404 = endpoint not registered
[ "$CODE" = "400" ] || { echo "FAIL: allocate endpoint not registered (code=$CODE)"; exit 1; }

# Check release endpoint exists
CODE2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/harness/review-env/release" \
  -H "Content-Type: application/json" -d '{}')
[ "$CODE2" = "400" ] || { echo "FAIL: release endpoint not registered (code=$CODE2)"; exit 1; }

echo "✅ review-env smoke: allocate + release endpoints registered"
