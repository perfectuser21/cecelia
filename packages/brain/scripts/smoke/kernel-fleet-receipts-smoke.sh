#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the migrated Kernel test database}"

expected_columns="actual_machine_id,execution_transport,lease_generation,machine_attestation_status,remote_job_id,requested_machine_id"
receipt_schema=$(
  psql -X -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
BEGIN READ ONLY;
SELECT
  (SELECT COUNT(*) FROM schema_version WHERE version = '363'),
  COUNT(*),
  string_agg(column_name, ',' ORDER BY column_name)
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'harness_attempts'
  AND column_name IN (
    'requested_machine_id',
    'actual_machine_id',
    'execution_transport',
    'remote_job_id',
    'machine_attestation_status',
    'lease_generation'
  );
COMMIT;
SQL
)

IFS='|' read -r migration_count column_count actual_columns <<<"$receipt_schema"
test "$migration_count" = "1"
test "$column_count" = "6"
test "$actual_columns" = "$expected_columns"

echo "PASS: migration 363 receipt schema has all six fleet evidence fields"
