#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

if [[ "${HARNESS_ROLE_CHAIN_ENABLED:-}" != '1' ]]; then
  printf '%s\n' 'SKIP: real Harness role chain requires explicit opt-in'
  exit 0
fi

: "${DB_URL:?DB_URL is required}"
: "${BASELINE_SHA:?BASELINE_SHA is required}"
BRAIN_URL=${BRAIN_URL:-http://127.0.0.1:5221}
EVIDENCE_DIR=${ROLE_CHAIN_EVIDENCE_DIR:-"$ROOT_DIR/sprints/08121555-unified-work-router/evidence/role-chain"}
mkdir -p "$EVIDENCE_DIR"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
json_get() { jq -er "$2" <<<"$1"; }

git merge-base --is-ancestor "$BASELINE_SHA" HEAD \
  || fail 'frozen implementation baseline is not an ancestor of HEAD'
curl -fsS "$BRAIN_URL/api/brain/health" >/dev/null \
  || fail 'Brain controller endpoint is unavailable'

TASK_ID=${HARNESS_ROLE_CHAIN_TASK_ID:-}
if [[ -z "$TASK_ID" ]]; then
  CREATE_BODY=$(jq -nc \
    --arg title "Unified Work Router role-chain $(date -u +%Y%m%dT%H%M%SZ)" \
    --arg base "$BASELINE_SHA" \
    --arg branch "$(git branch --show-current)" \
    '{title:$title,task_type:"harness_initiative",priority:"P1",payload:{mutation_intent:"write",domain:"coding",change_kind:"bugfix",repo:"cecelia",map_scope:["F0"],base_sha:$base,branch:$branch,target_environment:"local_api"}}')
  CREATE_RESPONSE=$(curl -fsS -X POST "$BRAIN_URL/api/brain/tasks" \
    -H 'content-type: application/json' -d "$CREATE_BODY") \
    || fail 'Controller failed to create role-chain task'
  TASK_ID=$(json_get "$CREATE_RESPONSE" '.id // .task.id // .task_id')
fi
[[ "$TASK_ID" =~ ^[0-9a-f-]{36}$ ]] || fail 'Controller returned an invalid task id'

RUN_ID=''
DEADLINE=$((SECONDS + ${HARNESS_ROLE_CHAIN_TIMEOUT_SECONDS:-900}))
while ((SECONDS < DEADLINE)); do
  RUN_ID=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -At \
    -v task_id="$TASK_ID" -c \
    "SELECT id FROM initiative_runs WHERE current_task_id=:'task_id'::uuid ORDER BY created_at DESC LIMIT 1" \
    | tr -d '[:space:]')
  [[ "$RUN_ID" =~ ^[0-9a-f-]{36}$ ]] && break
  sleep 2
done
[[ "$RUN_ID" =~ ^[0-9a-f-]{36}$ ]] || fail 'Controller did not create a Kernel run'
printf '%s\n' "$RUN_ID" > "$EVIDENCE_DIR/run-id"

while ((SECONDS < DEADLINE)); do
  RUN_JSON=$(curl -fsS "$BRAIN_URL/api/brain/orchestrator/relay-runs/by-id/$RUN_ID") \
    || fail 'authoritative Kernel run endpoint failed'
  PHASE=$(json_get "$RUN_JSON" '.phase')
  [[ "$PHASE" == done || "$PHASE" == failed ]] && break
  sleep 5
done
[[ "${PHASE:-}" == done ]] || fail "role chain terminal phase is ${PHASE:-timeout}"
json_get "$RUN_JSON" '.evaluate_verdict == "PASS"' >/dev/null \
  || fail 'evaluate_verdict is not literal PASS'
json_get "$RUN_JSON" '.judge_verdict == "PASS"' >/dev/null \
  || fail 'judge_verdict is not literal PASS'

psql "$DB_URL" -v ON_ERROR_STOP=1 -At -v run_id="$RUN_ID" -c \
  "SELECT count(DISTINCT role)=3 FROM harness_attempts WHERE run_id=:'run_id'::uuid AND role IN ('generator','evaluator','judge') AND status='completed'" \
  | grep -qx t || fail 'generator/evaluator/judge attempts are incomplete'
psql "$DB_URL" -v ON_ERROR_STOP=1 -At -v run_id="$RUN_ID" -c \
  "SELECT EXISTS (SELECT 1 FROM orchestrator_decision_log WHERE run_id=:'run_id'::uuid AND action='merge_pr' AND detail->>'reason'='all_gates_passed')" \
  | grep -qx t || fail 'all_gates_passed merge decision is absent'

printf '%s\n' "$RUN_JSON" > "$EVIDENCE_DIR/controller.json"
psql "$DB_URL" -v ON_ERROR_STOP=1 -At -v run_id="$RUN_ID" -F $'\t' -c \
  "SELECT role,provider,COALESCE(account_id,''),COALESCE(actual_machine_id,machine_id,''),COALESCE(remote_job_id,''),id,COALESCE(task_bundle#>>'{inputs,capability_snapshot_id}','') FROM harness_attempts WHERE run_id=:'run_id'::uuid AND role IN ('generator','evaluator','judge') ORDER BY created_at" \
  | while IFS=$'\t' read -r role provider account machine container attempt snapshot; do
      jq -nc --arg role "$role" --arg provider "$provider" --arg account "$account" \
        --arg machine "$machine" --arg container_id "$container" --arg attempt_id "$attempt" \
        --arg capability_snapshot_id "$snapshot" \
        '{role:$role,provider:$provider,account:$account,machine:$machine,container_id:$container_id,attempt_id:$attempt_id,capability_snapshot_id:$capability_snapshot_id}' \
        > "$EVIDENCE_DIR/$role-provenance.json"
    done

GENERATOR_SHA=$(sha256sum "$EVIDENCE_DIR/generator-provenance.json" | cut -d' ' -f1)
jq -nc --slurpfile identity "$EVIDENCE_DIR/evaluator-provenance.json" \
  --arg generator_evidence_sha256 "$GENERATOR_SHA" \
  '$identity[0] + {generator_evidence_sha256:$generator_evidence_sha256,verdict:"PASS"}' \
  > "$EVIDENCE_DIR/evaluator-evidence.json"
EVALUATOR_SHA=$(sha256sum "$EVIDENCE_DIR/evaluator-evidence.json" | cut -d' ' -f1)
jq -nc --slurpfile identity "$EVIDENCE_DIR/judge-provenance.json" \
  --arg evaluator_evidence_sha256 "$EVALUATOR_SHA" \
  '$identity[0] + {evaluator_evidence_sha256:$evaluator_evidence_sha256,verdict:"PASS",reason:"all_gates_passed"}' \
  > "$EVIDENCE_DIR/judge-evidence.json"

CONTAINER_ID=$(json_get "$(<"$EVIDENCE_DIR/generator-provenance.json")" '.container_id')
docker inspect "$CONTAINER_ID" >/dev/null || fail 'generator container provenance cannot be inspected'
printf 'PASS: controller generator evaluator judge role chain %s all_gates_passed\n' "$RUN_ID"
