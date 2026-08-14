#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_API:-${BRAIN_URL:-http://localhost:5221}}"
SMOKE_TITLE="smoke-claimed-by-test-${GITHUB_RUN_ID:-local}-$$-$RANDOM"

TASK=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"research\",\"title\":\"$SMOKE_TITLE\",\"priority\":\"P2\"}")
ID=$(echo "$TASK" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "Created task $ID"

psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c \
  "UPDATE tasks SET status='in_progress', claimed_by='smoke-test-tick' WHERE id='$ID'" > /dev/null

curl -sf -X PATCH "$BRAIN/api/brain/tasks/$ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"failed"}' > /dev/null

CLAIMED=$(psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -tAc \
  "SELECT COALESCE(claimed_by,'') FROM tasks WHERE id='$ID'")
if [ -n "$CLAIMED" ]; then
  echo "FAIL: claimed_by=$CLAIMED not cleared after failed"
  exit 1
fi
echo "✅ claimed_by cleared after failed"
echo "✅ smoke passed"
