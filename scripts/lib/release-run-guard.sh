#!/usr/bin/env bash
# Server-owned guard for every direct production release script.
set -euo pipefail

guard_dir="$(cd "$(dirname "$0")" && pwd)"
effect_kind="${1:-production}"
release_run_id="${KERNEL_RELEASE_RUN_ID:-}"
merge_sha="${KERNEL_RELEASE_MERGE_SHA:-}"
release_authorization="${KERNEL_RELEASE_AUTHORIZATION:-}"
brain_url="${BRAIN_URL:-http://localhost:5221}"
deploy_token="${DEPLOY_TOKEN:-}"

deny() {
  echo "ReleaseRun authority required: $1" >&2
  exit 78
}

if [[ "${KERNEL_RELEASE_BOOTSTRAP:-0}" == "1" ]]; then
  bootstrap_run_id="${KERNEL_RELEASE_BOOTSTRAP_RUN_ID:-}"
  bootstrap_database_url="${KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL:-}"
  bootstrap_repository="${KERNEL_RELEASE_REPOSITORY:-}"
  bootstrap_pr_number="${KERNEL_RELEASE_PR_NUMBER:-}"
  bootstrap_source_sha="${KERNEL_RELEASE_SOURCE_HEAD_SHA:-}"
  bootstrap_actor="${KERNEL_RELEASE_BOOTSTRAP_ACTOR:-}"
  bootstrap_key_id="${KERNEL_RELEASE_BOOTSTRAP_APPROVAL_KEY_ID:-}"
  bootstrap_signature="${KERNEL_RELEASE_BOOTSTRAP_APPROVAL_SIGNATURE:-}"
  bootstrap_trust_key="/etc/cecelia/kernel-release-bootstrap-owner-v1.pub"
  [[ "$effect_kind" == "production" || "$effect_kind" == "staging" ]] \
    || deny "invalid bootstrap effect kind"
  [[ "$bootstrap_run_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
    || deny "missing or malformed bootstrap run id"
  [[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]] \
    || deny "missing or malformed bootstrap merge SHA"
  [[ "$bootstrap_database_url" =~ ^postgres(ql)?:// ]] \
    || deny "explicit bootstrap database URL required"
  command -v psql >/dev/null || deny "bootstrap ledger cannot be verified"
  bootstrap_approval_digest=$(node "$guard_dir/verify-bootstrap-approval.mjs" \
    "$bootstrap_trust_key" "$bootstrap_repository" "$bootstrap_pr_number" \
    "$bootstrap_source_sha" "$merge_sha" "$bootstrap_actor" \
    "$bootstrap_key_id" "$bootstrap_signature") \
    || deny "bootstrap owner approval cannot be verified"

  expected_state="staging_intent"
  [[ "$effect_kind" == "production" ]] && expected_state="production_intent"
  attempt_id=$(psql "$bootstrap_database_url" -XqAtv ON_ERROR_STOP=1 \
    -v run_id="$bootstrap_run_id" \
    -v merge_sha="$merge_sha" \
    -v repository="$bootstrap_repository" \
    -v pr_number="$bootstrap_pr_number" \
    -v source_sha="$bootstrap_source_sha" \
    -v actor="$bootstrap_actor" \
    -v key_id="$bootstrap_key_id" \
    -v approval_digest="$bootstrap_approval_digest" \
    -v effect_kind="$effect_kind" \
    -v expected_state="$expected_state" <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended(:'run_id', 0));
WITH latest_state AS (
  SELECT state
    FROM kernel_release_bootstrap_transitions
   WHERE bootstrap_run_id = :'run_id'
   ORDER BY append_seq DESC
   LIMIT 1
),
latest_attempt AS (
  SELECT a.*,
         r.receipt_status
    FROM kernel_release_bootstrap_effect_attempts a
    LEFT JOIN LATERAL (
      SELECT receipt_status
        FROM kernel_release_bootstrap_effect_receipts
       WHERE effect_attempt_id = a.id
       ORDER BY append_seq DESC
       LIMIT 1
    ) r ON TRUE
   WHERE a.bootstrap_run_id = :'run_id'
     AND a.effect_kind = :'effect_kind'
   ORDER BY a.generation DESC
   LIMIT 1
),
claimed AS (
  INSERT INTO kernel_release_bootstrap_effect_attempts (
    bootstrap_run_id, effect_kind, generation, lease_expires_at
  )
  SELECT r.id, :'effect_kind',
         COALESCE((SELECT generation FROM latest_attempt), 0) + 1,
         clock_timestamp() + interval '5 minutes'
    FROM kernel_release_bootstrap_runs r
   WHERE r.id = :'run_id'
     AND r.merge_sha = :'merge_sha'
     AND r.repository = :'repository'
     AND r.pr_number = :'pr_number'::integer
     AND r.source_head_sha = :'source_sha'
     AND r.approved_by = :'actor'
     AND r.approval_key_id = :'key_id'
     AND r.approval_digest = :'approval_digest'
     AND (SELECT state FROM latest_state) = :'expected_state'
     AND (
       NOT EXISTS (SELECT 1 FROM latest_attempt)
       OR (SELECT lease_expires_at <= clock_timestamp() FROM latest_attempt)
       OR (SELECT receipt_status IN ('failed', 'observed_unconfirmed') FROM latest_attempt)
     )
  RETURNING id
)
SELECT id FROM claimed;
COMMIT;
SQL
  ) || deny "bootstrap effect claim failed"
  attempt_id=$(printf '%s\n' "$attempt_id" | grep -E '^[0-9]+$' | tail -1 || true)
  [[ -n "$attempt_id" ]] \
    || deny "bootstrap stage is invalid, terminal, or already has a live attempt"
  exit 0
fi

[[ "$effect_kind" == "production" || "$effect_kind" == "staging" ]] \
  || deny "invalid effect kind"
[[ "$release_run_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
  || deny "missing or malformed release_run_id"
[[ "$merge_sha" =~ ^[0-9a-fA-F]{40}$ ]] \
  || deny "missing or malformed merge_sha"
[[ "$release_authorization" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
  || deny "missing or malformed release_authorization"
[[ -n "$deploy_token" ]] || deny "DEPLOY_TOKEN unavailable"

response_file=$(mktemp "${TMPDIR:-/tmp}/release-authority.XXXXXX")
trap 'rm -f "$response_file"' EXIT
http_code=$(curl --silent --show-error --output "$response_file" --write-out "%{http_code}" \
  -X POST "${brain_url}/api/brain/release-runs/authorize" \
  -H "Authorization: Bearer ${deploy_token}" \
  -H "Content-Type: application/json" \
  -d "{\"release_run_id\":\"${release_run_id}\",\"merge_sha\":\"${merge_sha}\",\"release_authorization\":\"${release_authorization}\",\"effect_kind\":\"${effect_kind}\"}" \
  --connect-timeout 10 --max-time 20) \
  || deny "authorization service unavailable"

[[ "$http_code" == "200" ]] || deny "server denied release effect (HTTP ${http_code})"
grep -Eq '"authorized"[[:space:]]*:[[:space:]]*true' "$response_file" \
  || deny "server response lacked authorization receipt"
