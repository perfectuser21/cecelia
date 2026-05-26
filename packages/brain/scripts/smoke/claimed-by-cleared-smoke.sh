#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_API:-http://localhost:5221}"

TASK=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"research","title":"smoke-claimed-by-test","priority":"P2"}')
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
  psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM tasks WHERE id='$ID'" > /dev/null
  exit 1
fi
echo "✅ claimed_by cleared after failed"

psql "${DATABASE_URL:-postgresql://localhost/cecelia}" -c "DELETE FROM tasks WHERE id='$ID'" > /dev/null
echo "✅ smoke passed"
