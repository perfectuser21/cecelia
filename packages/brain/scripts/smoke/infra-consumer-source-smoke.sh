#!/usr/bin/env bash
set -euo pipefail
# 只验证隔离来源账；没有写测试授权时不连接数据库或HTTP。
if [[ "${SMOKE_ALLOW_WRITE:-}" != 1 ]]; then exit 0; fi
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch && ! ( "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true && "$DB_NAME" == cecelia_test ) ]]; then
  echo 'infra来源smoke只允许scratch/Actions测试库' >&2; exit 1
fi
if [[ "${CI:-}" != true ]]; then export DB_HOST="${DB_HOST:-/tmp}"; fi
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.js \
  src/__tests__/integration/infra-consumer-source.pg.integration.test.js
