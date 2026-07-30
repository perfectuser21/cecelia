#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BRAIN_BASE="${BRAIN_URL:-http://localhost:5221}"

cd "$REPO_ROOT"

echo "[gp-ledger-phase3] checking database readiness"
node packages/brain/src/gp-ledger-readiness.js

STEP_ID="$(
  psql "${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" \
    -Atq \
    -c "SELECT id FROM journey_steps WHERE journey_id='ac2e35bc-849a-48cd-917f-79d15c5ac886' AND step_number=1"
)"
if [ -z "$STEP_ID" ]; then
  echo "FAIL: GP-B S1 journey step is missing"
  exit 1
fi

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT
HTTP_CODE="$(
  curl -sS -o "$BODY_FILE" -w '%{http_code}' \
    "$BRAIN_BASE/api/brain/journey_steps/$STEP_ID/ledger"
)"
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: journey-step ledger returned HTTP $HTTP_CODE"
  cat "$BODY_FILE"
  exit 1
fi

node - "$BODY_FILE" <<'NODE'
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (body?.step?.home !== 'biz') throw new Error('GP-B S1 home is not biz');
if (!Array.isArray(body?.zones?.element) || body.zones.element.length === 0) {
  throw new Error('element zone is empty');
}
if (!Array.isArray(body?.nfr_decisions) || body.nfr_decisions.length !== 1) {
  throw new Error('step-scoped NFR decision is missing');
}
if (body?.readiness?.positive_missing !== 0 || body?.readiness?.ready !== true) {
  throw new Error(`ledger is not ready: ${JSON.stringify(body?.readiness)}`);
}
NODE

echo "PASS: Golden Path §③ readiness gate"

