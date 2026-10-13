#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT/packages/brain"
export NODE_ENV=test
npx vitest run src/projection/__tests__/workflow-observation.test.js src/projection/__tests__/workflow-body.test.js src/__tests__/task-run-notion-projection.test.js --maxWorkers=1 --minWorkers=1
case "${DB_NAME:-}" in
  cecelia_scratch|cecelia_test) ;;
  *) echo 'PostgreSQL验收只允许显式隔离scratch/test库' >&2; exit 1 ;;
esac
npx vitest run --config vitest.integration.config.js src/lib/__tests__/integration/task-run-workflow.test.js src/__tests__/integration/directory-projection.pg.integration.test.js --maxWorkers=1 --minWorkers=1
