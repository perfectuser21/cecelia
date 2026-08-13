#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

: "${DB_URL:?DB_URL is required and must target a scratch database}"
NODE_EXECUTABLE="$(command -v node)"
PSQL_EXECUTABLE="$(command -v psql)"
DATABASE_NAME="$($NODE_EXECUTABLE -e "const u=new URL(process.argv[1]);process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DB_URL")"
[[ "$DATABASE_NAME" =~ _scratch$ ]] || fail "拒绝连接非 scratch 库: ${DATABASE_NAME:-<empty>}"
ACTIVE_DATABASE="$($PSQL_EXECUTABLE "$DB_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')"
[[ "$ACTIVE_DATABASE" == "$DATABASE_NAME" ]] || fail "连接目标不一致: $ACTIVE_DATABASE"
SCHEMA_VERSION="$($PSQL_EXECUTABLE "$DB_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT max(version) FROM schema_version')"
[[ "$SCHEMA_VERSION" -ge 416 ]] || fail "schema_version=$SCHEMA_VERSION, expected>=416"

printf '%s\n' '── Unified Work Router scratch smoke ──'
printf 'database=%s baseline=%s\n' "$DATABASE_NAME" "${BASELINE_SHA:-<unset>}"

DATABASE_URL="$DB_URL" REPO_ROOT_CECELIA="$ROOT_DIR" \
  bash packages/brain/scripts/smoke/map-fact-snapshot-smoke.sh
pass '四类 repo 事实已刷新为当前 revision'

DB_NAME="$DATABASE_NAME" NODE_ENV=test DB_URL="$DB_URL" \
  "$NODE_EXECUTABLE" packages/brain/scripts/smoke/unified-work-router-smoke.mjs
pass 'API / Intent / Capture 真入口与 Kernel/Map/Impact 实弹'

(cd packages/brain && DB_NAME="$DATABASE_NAME" NODE_ENV=test npx vitest run \
  --config vitest.integration.config.js \
  src/__tests__/integration/map-recovery-consumption.integration.test.js \
  --reporter=dot --silent)
pass 'map_recovery 不可变合同与单 Attempt 消费'

bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh
npx vitest run packages/brain/src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=dot
bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh
bash docker/cecelia-runner/__tests__/entrypoint-frozen-baseline-guard.test.sh
pass '有头、无头与 Generator trust boundary'

printf '%s\n' 'ALL PASS: Unified Work Router scratch smoke'
