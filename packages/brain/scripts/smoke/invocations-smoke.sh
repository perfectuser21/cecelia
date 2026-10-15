#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node --check src/routes/invocations.js
node --check src/invocations/resolve.js
node --check src/invocations/store.js
node --check src/invocations/runtime.js
node --check src/orchestrator/invocation-plan.js
node --check src/orchestrator/skill-activity-adapter.js
npx vitest run src/routes/invocations.test.js src/orchestrator/invocation-plan.test.js src/orchestrator/skill-activity-adapter.test.js --maxWorkers=2 --minWorkers=1
