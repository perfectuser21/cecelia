#!/usr/bin/env bash
# Server-owned guard for every direct production release script.
set -euo pipefail

release_run_deny() {
  echo "ReleaseRun authority required: $1" >&2
  exit 78
}

require_release_run_authority() {
  local guard_dir effect_kind release_run_id merge_sha release_authorization brain_url
  local deploy_token private_config_file private_values
  guard_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  effect_kind="${1:-production}"
  release_run_id="${KERNEL_RELEASE_RUN_ID:-}"
  merge_sha="${KERNEL_RELEASE_MERGE_SHA:-}"
  release_authorization="${KERNEL_RELEASE_AUTHORIZATION:-}"
  brain_url="${BRAIN_URL:-http://localhost:5221}"
  deploy_token="${DEPLOY_TOKEN:-}"
  private_config_file="${KERNEL_RELEASE_PRIVATE_CONFIG_FILE:-}"

  if [[ -n "$private_config_file" ]]; then
    private_values=$(node "$guard_dir/read-release-worker-authority.mjs" \
      "$private_config_file") \
      || release_run_deny "private worker authority invalid"
    IFS=$'\t' read -r release_authorization deploy_token <<< "$private_values"
  fi

if [[ "${KERNEL_RELEASE_BOOTSTRAP:-0}" == "1" ]]; then
  bootstrap_run_id="${KERNEL_RELEASE_BOOTSTRAP_RUN_ID:-}"
  bootstrap_private_config_file="${KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE:-}"
  bootstrap_pg_service_file="${KERNEL_RELEASE_BOOTSTRAP_PG_SERVICE_FILE:-}"
  bootstrap_pgpass_file="${KERNEL_RELEASE_BOOTSTRAP_PGPASS_FILE:-}"
  bootstrap_repository="${KERNEL_RELEASE_REPOSITORY:-}"
  bootstrap_pr_number="${KERNEL_RELEASE_PR_NUMBER:-}"
  bootstrap_source_sha="${KERNEL_RELEASE_SOURCE_HEAD_SHA:-}"
  bootstrap_actor="${KERNEL_RELEASE_BOOTSTRAP_ACTOR:-}"
  bootstrap_key_id="${KERNEL_RELEASE_BOOTSTRAP_APPROVAL_KEY_ID:-}"
  bootstrap_trust_key="/etc/cecelia/kernel-release-bootstrap-owner-v1.pub"
  [[ "$effect_kind" == "production" || "$effect_kind" == "staging" ]] \
    || release_run_deny "invalid bootstrap effect kind"
  [[ "$bootstrap_run_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
    || release_run_deny "missing or malformed bootstrap run id"
  [[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]] \
    || release_run_deny "missing or malformed bootstrap merge SHA"
  node "$guard_dir/bootstrap-private-config.mjs" \
    validate "$bootstrap_private_config_file" \
    || release_run_deny "private bootstrap config unavailable"
  for bootstrap_pg_file in \
    "$bootstrap_pg_service_file" "$bootstrap_pgpass_file"; do
    [[ "$bootstrap_pg_file" == /* && -f "$bootstrap_pg_file" && ! -L "$bootstrap_pg_file" ]] \
      || release_run_deny "private bootstrap database reference unavailable"
    if stat -f '%u:%Lp' "$bootstrap_pg_file" >/dev/null 2>&1; then
      bootstrap_pg_mode=$(stat -f '%u:%Lp' "$bootstrap_pg_file")
    else
      bootstrap_pg_mode=$(stat -c '%u:%a' "$bootstrap_pg_file")
    fi
    [[ "$bootstrap_pg_mode" == "$(id -u):600" ]] \
      || release_run_deny "private bootstrap database reference must be mode 0600"
  done
  command -v psql >/dev/null || release_run_deny "bootstrap ledger cannot be verified"
  bootstrap_approval_digest=$(node "$guard_dir/verify-bootstrap-approval.mjs" \
    "$bootstrap_trust_key" "$bootstrap_private_config_file" \
    "$bootstrap_repository" "$bootstrap_pr_number" "$bootstrap_source_sha" \
    "$merge_sha" "$bootstrap_actor" "$bootstrap_key_id") \
    || release_run_deny "bootstrap owner approval cannot be verified"

  expected_state="staging_intent"
  [[ "$effect_kind" == "production" ]] && expected_state="production_intent"
  attempt_id=$(env -i \
    PATH="$PATH" HOME="${HOME:-}" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" \
    PGSERVICEFILE="$bootstrap_pg_service_file" \
    PGPASSFILE="$bootstrap_pgpass_file" \
    PGSERVICE=kernel_release_bootstrap \
    psql -XqAtv ON_ERROR_STOP=1 \
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
         GREATEST(
           a.lease_expires_at,
           COALESCE(MAX(renewal.lease_expires_at), a.lease_expires_at)
         ) AS effective_lease_expires_at,
         r.receipt_status
    FROM kernel_release_bootstrap_effect_attempts a
    LEFT JOIN kernel_release_bootstrap_effect_attempt_renewals renewal
      ON renewal.effect_attempt_id = a.id
     AND renewal.generation = a.generation
    LEFT JOIN LATERAL (
      SELECT receipt_status
        FROM kernel_release_bootstrap_effect_receipts
       WHERE effect_attempt_id = a.id
       ORDER BY append_seq DESC
       LIMIT 1
    ) r ON TRUE
   WHERE a.bootstrap_run_id = :'run_id'
     AND a.effect_kind = :'effect_kind'
   GROUP BY a.id, r.receipt_status
   ORDER BY a.generation DESC
   LIMIT 1
),
claimed AS (
  INSERT INTO kernel_release_bootstrap_effect_attempts (
    bootstrap_run_id, effect_kind, generation, lease_expires_at
  )
  SELECT r.id, :'effect_kind',
         COALESCE((SELECT generation FROM latest_attempt), 0) + 1,
         clock_timestamp() + interval '15 minutes'
    FROM kernel_release_bootstrap_runs r
   WHERE r.id = :'run_id'
     AND r.merge_sha = :'merge_sha'
     AND r.repository = :'repository'
     AND r.pr_number = :'pr_number'::integer
     AND r.source_head_sha = :'source_sha'
     AND r.approved_by = :'actor'
     AND r.approval_key_id = :'key_id'
     AND r.approval_digest = :'approval_digest'
     AND EXISTS (
       SELECT 1
         FROM kernel_release_bootstrap_e2e_manifests manifest
        WHERE manifest.bootstrap_run_id = r.id
          AND manifest.repository = r.repository
          AND manifest.merge_sha = r.merge_sha
     )
     AND (SELECT state FROM latest_state) = :'expected_state'
     AND (
       NOT EXISTS (SELECT 1 FROM latest_attempt)
       OR (SELECT effective_lease_expires_at <= clock_timestamp() FROM latest_attempt)
       OR (SELECT receipt_status IN ('failed', 'observed_unconfirmed') FROM latest_attempt)
     )
  RETURNING id
)
SELECT id FROM claimed;
COMMIT;
SQL
  ) || release_run_deny "bootstrap effect claim failed"
  attempt_id=$(printf '%s\n' "$attempt_id" | grep -E '^[0-9]+$' | tail -1 || true)
  [[ -n "$attempt_id" ]] \
    || release_run_deny "bootstrap stage is invalid, terminal, or already has a live attempt"
  bootstrap_attempt_file="${KERNEL_RELEASE_BOOTSTRAP_ATTEMPT_FILE:-}"
  [[ "$bootstrap_attempt_file" == /*
    && -f "$bootstrap_attempt_file"
    && ! -L "$bootstrap_attempt_file" ]] \
    || release_run_deny "private bootstrap attempt handoff unavailable"
  printf '%s\n' "$attempt_id" > "$bootstrap_attempt_file"
  chmod 600 "$bootstrap_attempt_file"
  return 0
fi

[[ "$effect_kind" == "production" || "$effect_kind" == "staging" ]] \
  || release_run_deny "invalid effect kind"
[[ "$release_run_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
  || release_run_deny "missing or malformed release_run_id"
[[ "$merge_sha" =~ ^[0-9a-fA-F]{40}$ ]] \
  || release_run_deny "missing or malformed merge_sha"
[[ "$release_authorization" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] \
  || release_run_deny "missing or malformed release_authorization"
[[ "$deploy_token" =~ ^[A-Za-z0-9._~-]+$ ]] \
  || release_run_deny "DEPLOY_TOKEN unavailable or malformed"

response_file=$(mktemp "${TMPDIR:-/tmp}/release-authority.XXXXXX")
trap 'rm -f "$response_file"' EXIT
http_code=$(curl --config - --silent --show-error --output "$response_file" --write-out "%{http_code}" \
  -X POST "${brain_url}/api/brain/release-runs/authorize" \
  --connect-timeout 10 --max-time 20 <<CURL_CONFIG
header = "Authorization: Bearer ${deploy_token}"
header = "Content-Type: application/json"
data = "{\\"release_run_id\\":\\"${release_run_id}\\",\\"merge_sha\\":\\"${merge_sha}\\",\\"release_authorization\\":\\"${release_authorization}\\",\\"effect_kind\\":\\"${effect_kind}\\"}"
CURL_CONFIG
) \
  || release_run_deny "authorization service unavailable"

[[ "$http_code" == "200" ]] || release_run_deny "server denied release effect (HTTP ${http_code})"
grep -Eq '"authorized"[[:space:]]*:[[:space:]]*true' "$response_file" \
  || release_run_deny "server response lacked authorization receipt"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  require_release_run_authority "${1:-production}"
fi
