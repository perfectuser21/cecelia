#!/usr/bin/env bash
set -euo pipefail
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
schema=$(psql -X -qAt -v ON_ERROR_STOP=1 "$DB" -c "SELECT (SELECT COUNT(*) FROM schema_version WHERE version='374'), COUNT(*) FILTER (WHERE column_name IN ('scenario_count','scenario_evidence')), (SELECT COUNT(*) FROM pg_constraint WHERE conrelid='public.journey_assertion_receipts'::regclass AND conname='journey_assertion_receipt_verdict_chk') FROM information_schema.columns WHERE table_schema='public' AND table_name='journey_assertion_receipts'")
test "$schema" = "1|2|1"
echo "GP_ASSERTION_RECEIPT_SCHEMA_SMOKE_PASS"
