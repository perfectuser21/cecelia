#!/usr/bin/env bash
set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-cecelia}"
PG_DB="${PG_DB:-cecelia}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"

TEST_ID=$(uuidgen | tr 'A-Z' 'a-z')
echo "[B13 smoke] test_initiative_id=$TEST_ID"

cleanup() {
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
    -c "DELETE FROM initiative_contracts WHERE initiative_id='$TEST_ID'::uuid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c "
  INSERT INTO initiative_contracts (initiative_id, version, status, prd_content, contract_content, review_rounds, budget_cap_usd, timeout_sec, branch, approved_at)
  VALUES ('$TEST_ID'::uuid, 1, 'approved', 'prd-v1', 'contract-v1', 1, 10.0, 3600, 'branch-v1', NOW())
  ON CONFLICT (initiative_id, version) DO UPDATE SET
    status = EXCLUDED.status, prd_content = EXCLUDED.prd_content,
    contract_content = EXCLUDED.contract_content, review_rounds = EXCLUDED.review_rounds,
    budget_cap_usd = EXCLUDED.budget_cap_usd, timeout_sec = EXCLUDED.timeout_sec,
    branch = EXCLUDED.branch, approved_at = NOW()
" || { echo "[B13 smoke] first INSERT failed"; exit 1; }

psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c "
  INSERT INTO initiative_contracts (initiative_id, version, status, prd_content, contract_content, review_rounds, budget_cap_usd, timeout_sec, branch, approved_at)
  VALUES ('$TEST_ID'::uuid, 1, 'approved', 'prd-v2', 'contract-v2', 2, 20.0, 7200, 'branch-v2', NOW())
  ON CONFLICT (initiative_id, version) DO UPDATE SET
    status = EXCLUDED.status, prd_content = EXCLUDED.prd_content,
    contract_content = EXCLUDED.contract_content, review_rounds = EXCLUDED.review_rounds,
    budget_cap_usd = EXCLUDED.budget_cap_usd, timeout_sec = EXCLUDED.timeout_sec,
    branch = EXCLUDED.branch, approved_at = NOW()
" || { echo "[B13 smoke] second INSERT (must UPDATE) failed"; exit 1; }

ROW_COUNT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT count(*) FROM initiative_contracts WHERE initiative_id='$TEST_ID'::uuid")
[[ "$ROW_COUNT" == "1" ]] || { echo "[B13 smoke] expected row_count=1, got $ROW_COUNT"; exit 1; }

CONTRACT=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT contract_content FROM initiative_contracts WHERE initiative_id='$TEST_ID'::uuid")
[[ "$CONTRACT" == "contract-v2" ]] || { echo "[B13 smoke] expected contract-v2, got $CONTRACT"; exit 1; }

echo "[B13 smoke] PASS — dbUpsert ON CONFLICT 幂等验证通过"
