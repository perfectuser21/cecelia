#!/bin/bash
set -euo pipefail

cd /workspace

HARNESS_TASK_ID="${HARNESS_TASK_ID:-ed561be4-940a-4c26-844c-e3c5a5a3f7c8}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$HARNESS_TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$HARNESS_TASK_ID" '
  (.id // .task.id) == $id
  and ((.title // .task.title) | contains("Kernel capability gate"))
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/07251915-kernel-ed561be4")
' >/dev/null

npx vitest run \
  sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts \
  sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  packages/brain/src/orchestrator/__tests__/derive.test.js \
  packages/brain/src/__tests__/dispatcher-preflight-three-strikes.test.js \
  packages/brain/src/__tests__/executor-codex-review-preflight.test.js \
  packages/brain/src/__tests__/fleet-heartbeat.test.js

bash scripts/check-version-sync.sh

