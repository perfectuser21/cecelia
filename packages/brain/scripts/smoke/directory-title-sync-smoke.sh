#!/usr/bin/env bash
set -euo pipefail
# 目录标题同步：只在隔离 scratch 或 CI 测试库运行真实 PostgreSQL 集成用例。
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo '目录标题smoke仅允许本地scratch或CI测试库' >&2
  exit 1
fi
cd "$BRAIN_DIR"
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/directory-projection.pg.integration.test.js \
  --maxWorkers=1 --minWorkers=1
