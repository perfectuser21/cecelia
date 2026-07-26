#!/usr/bin/env bash
set -euo pipefail

: "${BRAIN_URL:?BRAIN_URL must point to a running Brain backed by the test database}"
: "${DATABASE_URL:?DATABASE_URL must point to the migrated Kernel test database}"

health_body=$(mktemp)
telemetry_body=$(mktemp)
trap 'rm -f "$health_body" "$telemetry_body"' EXIT

health_code=$(
  curl -sS --max-time 5 -o "$health_body" -w '%{http_code}' \
    "$BRAIN_URL/api/brain/healthz"
)
telemetry_code=$(
  curl -sS --max-time 5 -o "$telemetry_body" -w '%{http_code}' \
    -H 'x-tenant-id: kernel-fleet-verification-smoke' \
    "$BRAIN_URL/api/brain/harness/tasks/00000000-0000-4000-8000-000000000000/attempt-telemetry"
)

node --input-type=module - "$health_body" "$health_code" "$telemetry_body" "$telemetry_code" <<'NODE'
import { readFileSync } from 'node:fs';

const [, , healthPath, healthCode, telemetryPath, telemetryCode] = process.argv;
const health = JSON.parse(readFileSync(healthPath, 'utf8'));
const telemetry = JSON.parse(readFileSync(telemetryPath, 'utf8'));

if (!['200', '503'].includes(healthCode) || health.db !== 'connected') {
  throw new Error(`Brain test DB health failed: ${healthCode} ${JSON.stringify(health)}`);
}
if (telemetryCode !== '404' || telemetry.error !== 'telemetry_not_found') {
  throw new Error(`telemetry read path drifted: ${telemetryCode} ${JSON.stringify(telemetry)}`);
}
NODE

schema_contract=$(
  psql -X -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
BEGIN READ ONLY;
SELECT
  current_database(),
  (SELECT COUNT(*) FROM schema_version WHERE version = '363'),
  COUNT(*) FILTER (
    WHERE column_name IN (
      'requested_machine_id',
      'actual_machine_id',
      'execution_transport',
      'remote_job_id',
      'machine_attestation_status',
      'lease_generation'
    )
  ),
  (SELECT COUNT(*)
     FROM pg_constraint
    WHERE conrelid = 'public.harness_attempts'::regclass
      AND conname IN (
        'harness_attempts_execution_transport_check',
        'harness_attempts_machine_attestation_status_check'
      ))
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'harness_attempts';
COMMIT;
SQL
)

IFS='|' read -r database_name migration_count receipt_columns receipt_constraints \
  <<<"$schema_contract"
case "$database_name" in
  *_test|*_scratch) ;;
  *) echo "FAIL: verification smoke refuses non-test database: $database_name" >&2; exit 1 ;;
esac
test "$migration_count" = "1"
test "$receipt_columns" = "6"
test "$receipt_constraints" = "2"

echo "PASS: real Brain telemetry and test DB fleet receipts are read-only verifiable"
