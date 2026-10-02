#!/usr/bin/env bash
set -euo pipefail
# 真实HTTP→隔离PostgreSQL；新旧幂等、并发、整批冲突回滚与证据读回。
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo 'Span smoke仅允许隔离scratch或CI测试库' >&2
  exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/span-ingestion.pg.integration.test.js \
  src/lib/__tests__/span-ingestion.test.js src/routes/spans.test.js \
  --maxWorkers=1 --minWorkers=1
