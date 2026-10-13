#!/usr/bin/env bash
# 真PG隔离schema验证历史PASS资格、双部署门禁及七流程聚合闭包；禁止生产库。
set -euo pipefail
cd "$(dirname "$0")/../.."
export DB_NAME="${DB_NAME:-cecelia_scratch}"
export DB_HOST="${DB_HOST:-/tmp}"
export DB_USER="${DB_USER:-administrator}"
# fixture再次校验库身份与隔离schema；没有无库时放行分支。
npx vitest run --config vitest.integration.config.js src/lib/__tests__/integration/commander-method-selection.test.js
