#!/usr/bin/env bash
set -euo pipefail
TASK_BRAIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$TASK_BRAIN_DIR"
node src/orchestrator/__tests__/activity-event-ledger.pg.mjs
