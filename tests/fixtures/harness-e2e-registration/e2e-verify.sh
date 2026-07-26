#!/bin/bash
set -euo pipefail

cd /workspace

HARNESS_TASK_ID="${HARNESS_TASK_ID:-fixture-task-id}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$HARNESS_TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$HARNESS_TASK_ID" '
  (.id // .task.id) == $id
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/fixture-kernel")
' >/dev/null

npx vitest run \
  sprints/fixture-kernel/tests/preflight-capability-gate.contract.test.ts \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js

bash scripts/check-version-sync.sh
