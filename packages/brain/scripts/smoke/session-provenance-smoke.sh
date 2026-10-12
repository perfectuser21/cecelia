#!/usr/bin/env bash
# 真实 launcher → HTTP Brain 路由 → scratch PostgreSQL → GET/SQL 读回。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DB_NAME="${DB_NAME:-cecelia_scratch}"
if [[ "$DB_NAME" != cecelia_scratch ]]; then
  echo "session-provenance smoke requires DB_NAME=cecelia_scratch" >&2
  exit 2
fi
cd "$ROOT"
NODE_ENV=test npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/session-provenance.integration.test.js \
  --maxWorkers=1 --minWorkers=1
