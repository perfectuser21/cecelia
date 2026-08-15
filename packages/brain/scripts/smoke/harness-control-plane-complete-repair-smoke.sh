#!/usr/bin/env bash
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://127.0.0.1:5221}"
DATABASE_URL="${DATABASE_URL:-}"
VERSION_JSON=$(curl -fsS "$BRAIN_URL/api/brain/version")

node -e '
const payload = JSON.parse(process.argv[1]);
const version = String(payload.version ?? "").split(".").map(Number);
const minimum = [1, 273, 46];
const versionIsCurrent = version.every((part, index) => part === minimum[index])
  || version.some((part, index) =>
    part > minimum[index]
    && minimum.slice(0, index).every((expected, previous) => version[previous] === expected)
  );
if (version.length !== 3 || version.some(Number.isNaN) || !versionIsCurrent) {
  throw new Error(`unexpected Brain version: ${payload.version}`);
}
if (Number(payload.schema_version) < 430) {
  throw new Error(`schema floor not deployed: ${payload.schema_version}`);
}
' "$VERSION_JSON"

if [[ -z "$DATABASE_URL" ]]; then
  printf '%s\n' 'FAIL: DATABASE_URL is required for control-plane authority smoke' >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
SELECT CASE WHEN
  to_regclass('public.harness_attempt_cleanup_outbox') IS NOT NULL
  AND to_regclass('public.planner_recovery_receipts') IS NOT NULL
  AND to_regclass('public.planner_recovery_consumptions') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='initiative_runs'
       AND column_name='planner_recovery_receipt_id'
  )
THEN 'PASS' ELSE 'FAIL' END;
" | grep -qx PASS

printf '%s\n' 'PASS: Brain 1.273.46 schema 430 control-plane authorities are deployed'
