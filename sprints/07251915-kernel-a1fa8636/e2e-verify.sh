#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DATABASE_URL:?必须由 evaluator 显式注入 _test/_scratch，禁止生产 fallback}"
: "${CONTRACT_BASE_SHA:?必须锚定 generator 开始前合同 commit}"
DB_NAME=$(node -e 'const d=new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);if(!/(_test|_scratch)$/.test(d)||d==="cecelia")process.exit(1);process.stdout.write(d)')
export DB_NAME
export NODE_ENV=test

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

TEST_DATABASE_URL="$TEST_DATABASE_URL" CONTRACT_BASE_SHA="$CONTRACT_BASE_SHA" \
  npx vitest run \
    sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.contract.test.ts \
    sprints/07251915-kernel-a1fa8636/tests/kernel-attempt-telemetry.pg.contract.test.ts \
    --reporter=verbose

(cd packages/brain && ../../node_modules/.bin/vitest run \
  src/__tests__/migration-357-harness-attempts.test.js \
  src/orchestrator/__tests__/attempt-store.test.js \
  src/orchestrator/__tests__/derive.test.js \
  src/orchestrator/__tests__/contract-store.test.js \
  src/orchestrator/__tests__/kernel-handlers.test.js \
  src/orchestrator/__tests__/kernel-callback-flow.integration.test.js \
  src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  --reporter=dot)

bash scripts/check-version-sync.sh
echo "✅ Kernel telemetry Golden Path 验证通过"
