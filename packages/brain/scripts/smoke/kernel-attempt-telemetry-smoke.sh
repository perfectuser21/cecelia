#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

test -f packages/brain/migrations/361_kernel_attempt_telemetry.sql
test -f packages/brain/src/orchestrator/attempt-telemetry.js
grep -q "attempt-telemetry" packages/brain/src/routes/harness.routes.js
grep -q "logical_cycle_id" packages/brain/src/orchestrator/attempt-store.js
grep -q "reconcileExpiredKernelAttempt" packages/brain/src/harness-relay-watchdog.js

node --input-type=module - <<'NODE'
import {
  calculateAttemptTime,
  REQUIRED_TIMED_ROLES,
  DERIVED_TIME_ROLES,
} from './packages/brain/src/orchestrator/attempt-telemetry.js';

const timing = calculateAttemptTime({
  created_at: '2026-07-25T00:00:00.000Z',
  started_at: '2026-07-25T00:00:00.500Z',
  completed_at: '2026-07-25T00:00:01.500Z',
  time_derived: false,
});
if (timing.active_time_ms !== 1000
    || timing.wait_time_ms !== 500
    || timing.wall_time_ms !== 1500) {
  throw new Error(`unexpected timing: ${JSON.stringify(timing)}`);
}
if (REQUIRED_TIMED_ROLES.join(',') !== 'planner,generator,reviewer,evaluator,judge,reporter') {
  throw new Error('timed role contract drift');
}
if (!DERIVED_TIME_ROLES.includes('judge') || !DERIVED_TIME_ROLES.includes('reporter')) {
  throw new Error('derived role contract drift');
}
NODE

echo "✅ kernel-attempt-telemetry smoke PASS"
