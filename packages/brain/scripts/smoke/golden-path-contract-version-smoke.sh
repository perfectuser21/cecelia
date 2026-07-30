#!/usr/bin/env bash
# Real API + PostgreSQL smoke for the versioned Golden Path contract Gate.
set -euo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
DB_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
RUN_KEY="gp-contract-smoke-$(date +%s)-$$"
GP_ID=""
JOURNEY_ID=""
PROPOSAL_TASK_ID=""
ACTION_V1=""
ACTION_V2=""

cleanup() {
  [ -n "$GP_ID" ] || return 0
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
DELETE FROM golden_path_contract_versions WHERE golden_path_id = '$GP_ID';
DELETE FROM decisions WHERE context->>'golden_path_id' = '$GP_ID';
DELETE FROM golden_paths WHERE id = '$GP_ID';
DELETE FROM tasks
 WHERE id = NULLIF('$PROPOSAL_TASK_ID', '')::uuid
    OR payload->>'golden_path_id' = '$GP_ID';
DELETE FROM pending_actions
 WHERE id IN (
   NULLIF('$ACTION_V1', '')::uuid,
   NULLIF('$ACTION_V2', '')::uuid
 );
DELETE FROM journeys WHERE id = NULLIF('$JOURNEY_ID', '')::uuid;
SQL
}
trap cleanup EXIT

request() {
  local method="$1" path="$2" data="${3:-}"
  local response
  if [ -n "$data" ]; then
    response=$(curl -sS -w $'\n%{http_code}' -X "$method" "$API$path" \
      -H 'Content-Type: application/json' -d "$data")
  else
    response=$(curl -sS -w $'\n%{http_code}' -X "$method" "$API$path")
  fi
  HTTP_CODE="${response##*$'\n'}"
  HTTP_BODY="${response%$'\n'*}"
  echo "[$method $path] HTTP $HTTP_CODE"
  echo "$HTTP_BODY"
}

expect_code() {
  [ "$HTTP_CODE" = "$1" ] || {
    echo "expected HTTP $1, got $HTTP_CODE"
    exit 1
  }
}

JOURNEY_ID=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc \
  "INSERT INTO journeys (name, description)
   VALUES ('$RUN_KEY', 'versioned GP contract smoke')
   RETURNING id" | head -1)

request POST /golden-paths \
  "{\"title\":\"$RUN_KEY\",\"one_liner\":\"真实合同签字生命周期\",\"journey_id\":\"$JOURNEY_ID\"}"
expect_code 201
GP_ID=$(jq -er '.golden_path.id' <<<"$HTTP_BODY")

request POST "/golden-paths/$GP_ID/select" '{}'
expect_code 200
PROPOSAL_TASK_ID=$(jq -er '.proposal_task_id' <<<"$HTTP_BODY")

request PATCH "/golden-paths/$GP_ID" \
  '{"status":"converged","proposal_doc":"# Contract smoke proposal"}'
expect_code 200

CONTRACT_V1='{
  "fr_summary":{"statements":["用户提交后看到成功结果"]},
  "lifelines_and_nfr":{"items":[{
    "statement":"写入必须唯一",
    "class":"lifeline",
    "verification":"SELECT COUNT(*) = 1",
    "rationale":"重复写入即业务失败"
  }]},
  "yield_order":{
    "order":["安全/资金正确性","数据一致性","功能完整","性能","体验顺滑"],
    "override_reason":null
  },
  "external_commitment_changes":{"changes":[],"none":true},
  "release_and_blast_radius":{
    "stages":["internal"],
    "blast_radius":"单一 smoke Journey",
    "rollback_triggers":["错误率 > 1%"]
  },
  "success_and_close":{
    "metrics":["成功率 >= 99%"],
    "observation_window":"24h",
    "close_conditions":["24h 达标"],
    "shutdown_conditions":["连续 5 分钟错误率 > 1%"]
  },
  "budget_guard":{
    "total_cost_cap_usd":10,
    "atom_cost_cap_usd":2,
    "atom_runtime_sec":1800,
    "atom_parallelism":1
  }
}'

request POST "/golden-paths/$GP_ID/contracts" "$CONTRACT_V1"
expect_code 201
CONTRACT_V1_ID=$(jq -er '.contract_version.id' <<<"$HTTP_BODY")
CONTRACT_V1_HASH=$(jq -er '.contract_version.content_hash' <<<"$HTTP_BODY")
ACTION_V1=$(jq -er '.pending_action_id' <<<"$HTTP_BODY")

request POST "/pending-actions/$ACTION_V1/approve" '{"reviewer":"smoke-owner"}'
expect_code 200
TASK_V1=$(jq -er '.execution_result.task.id' <<<"$HTTP_BODY")
jq -e --arg id "$CONTRACT_V1_ID" --arg hash "$CONTRACT_V1_HASH" \
  '.execution_result.task.payload
   | .gp_contract_id == $id
   and .gp_contract_version == 1
   and .gp_contract_hash == $hash' <<<"$HTTP_BODY" >/dev/null

CONTRACT_V2=$(jq -c \
  '.success_and_close.observation_window = "48h"' <<<"$CONTRACT_V1")
request POST "/golden-paths/$GP_ID/contracts" "$CONTRACT_V2"
expect_code 201
CONTRACT_V2_ID=$(jq -er '.contract_version.id' <<<"$HTTP_BODY")
ACTION_V2=$(jq -er '.pending_action_id' <<<"$HTTP_BODY")

LIFECYCLE=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc \
  "SELECT string_agg(version || ':' || status, ',' ORDER BY version)
     FROM golden_path_contract_versions
    WHERE golden_path_id = '$GP_ID'")
[ "$LIFECYCLE" = "1:invalidated,2:pending_signature" ]
[ "$(psql "$DB_URL" -tAc "SELECT status FROM tasks WHERE id = '$TASK_V1'")" = "cancelled" ]

request PATCH "/golden-paths/$GP_ID" '{"status":"converged"}'
expect_code 200
request POST "/pending-actions/$ACTION_V2/approve" '{"reviewer":"smoke-owner"}'
expect_code 200
TASK_V2=$(jq -er '.execution_result.task.id' <<<"$HTTP_BODY")
[ "$TASK_V2" != "$TASK_V1" ]
jq -e --arg id "$CONTRACT_V2_ID" \
  '.execution_result.task.payload
   | .gp_contract_id == $id and .gp_contract_version == 2' \
  <<<"$HTTP_BODY" >/dev/null

FINAL=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc \
  "SELECT string_agg(version || ':' || status, ',' ORDER BY version)
     FROM golden_path_contract_versions
    WHERE golden_path_id = '$GP_ID'")
[ "$FINAL" = "1:invalidated,2:signed" ]

echo "golden-path contract version smoke: PASS ($FINAL)"
