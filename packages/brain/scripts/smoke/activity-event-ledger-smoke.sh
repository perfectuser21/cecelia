#!/usr/bin/env bash
set -euo pipefail
TASK_BRAIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$TASK_BRAIN_DIR"
: "${ACTIVITY_EVENT_DATABASE_URL:?显式提供隔离scratch连接，禁止缺环境假绿}"
node src/orchestrator/__tests__/activity-event-ledger.pg.mjs
