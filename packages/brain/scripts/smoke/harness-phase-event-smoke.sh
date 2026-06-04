#!/usr/bin/env bash
# smoke test: POST + PATCH /api/brain/harness/phase-event 路由可用性
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"

# Brain 不可达时优雅跳过（不阻断 CI）
curl -sf "${BRAIN}/api/brain/harness/ping" >/dev/null 2>&1 || { echo "SKIP: Brain not running at ${BRAIN}"; exit 0; }
echo "Brain reachable at ${BRAIN}"

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
INITIATIVE_ID=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d '[:space:]')
if [ -z "$INITIATIVE_ID" ]; then
  echo "SKIP: no initiative_run in DB — cannot test POST /phase-event FK constraint"
  exit 0
fi

echo "Using initiative_id: $INITIATIVE_ID"
RESP=$(curl -sf -X POST "${BRAIN}/api/brain/harness/phase-event" \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"${INITIATIVE_ID}\",\"node\":\"smoke\",\"status\":\"running\",\"model\":\"smoke-test\"}")
echo "POST response: $RESP"

EVENT_ID=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).id))" "$RESP" 2>/dev/null)
[ -z "$EVENT_ID" ] && { echo "FAIL: no id in POST response"; exit 1; }
echo "phase-event id: $EVENT_ID"

TS_END=$(date +%s%3N)
PATCH_RESP=$(curl -sf -X PATCH "${BRAIN}/api/brain/harness/phase-event/${EVENT_ID}" \
  -H 'Content-Type: application/json' \
  -d "{\"status\":\"completed\",\"ts_end\":${TS_END},\"cost_usd\":0.0001}")
echo "PATCH response: $PATCH_RESP"

node -e "
const r = JSON.parse(process.argv[1]);
if (r.status !== 'completed') throw new Error('status not completed: ' + r.status);
if (typeof r.ts_end !== 'number') throw new Error('ts_end not number: ' + typeof r.ts_end);
if (typeof r.cost_usd !== 'number') throw new Error('cost_usd not number: ' + typeof r.cost_usd);
if (!r.model) throw new Error('model missing from response');
console.log('smoke PASS: POST + PATCH /phase-event validated');
" "$PATCH_RESP"
