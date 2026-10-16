#!/usr/bin/env bash
# 纯Skill候选：单元合同与真实隔离PG账本；真实CLI由显式验收开关执行。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"
node ../../node_modules/vitest/vitest.mjs run src/workflow-authoring/execution-ledger.test.js \
  src/workflow-authoring/execution-proof.test.js src/workflow-authoring/assembly-driver.test.js \
  src/workflow-authoring/assembly-orchestration.test.js src/workflow-authoring/query-budget.test.js \
  src/workflow-authoring/readiness-admission.test.js src/workflow-authoring/revalidation.test.js \
  src/invocations/candidate-target.test.js --maxWorkers=3 --minWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/authoring-candidate.pg.integration.test.js \
  src/__tests__/integration/workflow-authoring-execution.pg.integration.test.js --maxWorkers=1 --minWorkers=1
