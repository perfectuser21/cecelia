#!/usr/bin/env bash
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# Verify GET /stream returns 400 when planner_task_id is missing
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/harness/stream")
if [ "$CODE" != "400" ]; then
  printf 'FAIL: expected 400 on missing param, got %s\n' "$CODE" >&2
  exit 1
fi

# Verify GET /stream returns 404 for unknown UUID
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000")
if [ "$CODE" != "404" ]; then
  printf 'FAIL: expected 404 for unknown UUID, got %s\n' "$CODE" >&2
  exit 1
fi

printf 'sse-stream smoke OK\n'
