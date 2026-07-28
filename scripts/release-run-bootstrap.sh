#!/usr/bin/env bash
# One-time N-1 -> ReleaseRun cutover. The bootstrap is itself an append-only,
# crash-recoverable release: authenticated approval -> staging -> production.
set -euo pipefail

bootstrap_root="$(cd "$(dirname "$0")/.." && pwd)"

deny() {
  echo "Kernel ReleaseRun bootstrap denied: $1" >&2
  exit 78
}

[[ "${KERNEL_RELEASE_BOOTSTRAP:-0}" == "1" ]] || deny "bootstrap disabled"
[[ -z "${KERNEL_RELEASE_BOOTSTRAP_OWNER_SECRET:-}" ]] \
  || deny "caller-supplied owner secrets are forbidden"

deploy_root="${KERNEL_RELEASE_BOOTSTRAP_DEPLOY_ROOT:-}"
private_config_file="${KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE:-}"
repository="${KERNEL_RELEASE_REPOSITORY:-}"
pr_number="${KERNEL_RELEASE_PR_NUMBER:-}"
source_head_sha="${KERNEL_RELEASE_SOURCE_HEAD_SHA:-}"
merge_sha="${KERNEL_RELEASE_MERGE_SHA:-}"
actor="${KERNEL_RELEASE_BOOTSTRAP_ACTOR:-}"
approval_key_id="${KERNEL_RELEASE_BOOTSTRAP_APPROVAL_KEY_ID:-}"
trust_key="/etc/cecelia/kernel-release-bootstrap-owner-v1.pub"

[[ "$deploy_root" == /* ]] \
  || deny "a dedicated absolute deploy root is required"
[[ "$(git -C "$deploy_root" rev-parse --is-inside-work-tree 2>/dev/null || true)" == "true" ]] \
  || deny "dedicated deploy root is not a git worktree"
env -i PATH="$PATH" HOME="${HOME:-}" \
  node "$bootstrap_root/scripts/lib/bootstrap-private-config.mjs" \
  validate "$private_config_file" \
  || deny "owner-only bootstrap private config is required"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || deny "repository must be owner/name"
[[ "$pr_number" =~ ^[1-9][0-9]*$ ]] || deny "positive PR number required"
[[ "$source_head_sha" =~ ^[0-9a-f]{40}$ ]] || deny "exact source SHA required"
[[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]] || deny "exact merge SHA required"
[[ -n "$actor" ]] || deny "owner actor required"
[[ "$approval_key_id" == "owner-v1" ]] \
  || deny "known rotating owner approval key required"
command -v psql >/dev/null || deny "psql unavailable"
command -v gh >/dev/null || deny "GitHub authoritative read unavailable"

# The trust root is installed out-of-band, is never accepted from the caller,
# and must be an immutable root-owned file.
[[ -f "$trust_key" && ! -L "$trust_key" ]] || deny "owner trust root unavailable"
if stat -f '%u:%Lp' "$trust_key" >/dev/null 2>&1; then
  trust_mode=$(stat -f '%u:%Lp' "$trust_key")
else
  trust_mode=$(stat -c '%u:%a' "$trust_key")
fi
[[ "$trust_mode" == "0:444" ]] \
  || deny "owner trust root must be root-owned, non-writable, mode 0444"

# Prevalidate the dedicated deployment root and the exact GitHub merge relation
# before migration 375 or any bootstrap ledger row can be created.
[[ -z "$(git -C "$deploy_root" status --porcelain --untracked-files=no)" ]] \
  || deny "dedicated deploy root is dirty"
origin_url=$(git -C "$deploy_root" remote get-url origin)
case "$origin_url" in
  "git@github.com:${repository}.git"|"https://github.com/${repository}.git"|"ssh://git@github.com/${repository}.git") ;;
  *) deny "deploy root origin does not exactly match GitHub repository" ;;
esac
pr_facts=$(gh api --method GET "/repos/${repository}/pulls/${pr_number}" \
  | node "$bootstrap_root/scripts/lib/validate-bootstrap-pr.mjs" \
      "$repository" "$source_head_sha" "$merge_sha") \
  || deny "GitHub PR authority could not be read"
IFS=$'\t' read -r pr_state pr_merged pr_head_sha pr_merge_sha pr_base <<< "$pr_facts"
[[ "$pr_state" == "closed"
  && "$pr_merged" == "true"
  && "$pr_head_sha" == "$source_head_sha"
  && "$pr_merge_sha" == "$merge_sha"
  && "$pr_base" == "main" ]] \
  || deny "GitHub PR facts do not match approved release axes"

source_ref="refs/kernel-bootstrap/pr-${pr_number}-source"
merge_ref="refs/kernel-bootstrap/pr-${pr_number}-merge"
main_ref="refs/kernel-bootstrap/pr-${pr_number}-main"
manifest_file=""
receipt_file=""
attempt_file=""
attempt_renewal_pid=""
bootstrap_pg_dir=""
bootstrap_pg_service_file=""
bootstrap_pgpass_file=""
stop_attempt_renewal() {
  if [[ -n "$attempt_renewal_pid" ]]; then
    kill "$attempt_renewal_pid" >/dev/null 2>&1 || true
    wait "$attempt_renewal_pid" >/dev/null 2>&1 || true
    attempt_renewal_pid=""
  fi
}
cleanup_refs() {
  stop_attempt_renewal
  git -C "$deploy_root" update-ref -d "$source_ref" >/dev/null 2>&1 || true
  git -C "$deploy_root" update-ref -d "$merge_ref" >/dev/null 2>&1 || true
  git -C "$deploy_root" update-ref -d "$main_ref" >/dev/null 2>&1 || true
  [[ -z "$manifest_file" ]] || rm -f "$manifest_file"
  [[ -z "$receipt_file" ]] || rm -f "$receipt_file"
  [[ -z "$attempt_file" ]] || rm -f "$attempt_file"
  [[ -z "$bootstrap_pg_service_file" ]] || rm -f "$bootstrap_pg_service_file"
  [[ -z "$bootstrap_pgpass_file" ]] || rm -f "$bootstrap_pgpass_file"
  [[ -z "$bootstrap_pg_dir" ]] || rmdir "$bootstrap_pg_dir" 2>/dev/null || true
}
trap cleanup_refs EXIT
git -C "$deploy_root" fetch --no-tags origin \
  "${source_head_sha}:${source_ref}" >/dev/null 2>&1 \
  || deny "exact source SHA could not be fetched"
git -C "$deploy_root" fetch --no-tags origin \
  "${merge_sha}:${merge_ref}" >/dev/null 2>&1 \
  || deny "exact merge SHA could not be fetched"
git -C "$deploy_root" fetch --no-tags origin \
  "refs/heads/main:${main_ref}" >/dev/null 2>&1 \
  || deny "origin/main could not be fetched"
[[ "$(git -C "$deploy_root" rev-parse "$source_ref")" == "$source_head_sha" ]] \
  || deny "fetched source ref does not match approved source SHA"
[[ "$(git -C "$deploy_root" rev-parse "$merge_ref")" == "$merge_sha" ]] \
  || deny "fetched merge ref does not match approved merge SHA"
git -C "$deploy_root" merge-base --is-ancestor "$merge_sha" "$main_ref" \
  || deny "approved merge SHA is not reachable from origin/main"
git -C "$deploy_root" switch --detach "$merge_sha" >/dev/null
[[ "$(git -C "$deploy_root" rev-parse HEAD)" == "$merge_sha" ]] \
  || deny "dedicated deploy root checkout is not exact merge SHA"

bootstrap_pg_dir=$(mktemp -d "${TMPDIR:-/tmp}/kernel-bootstrap-pg.XXXXXX")
chmod 700 "$bootstrap_pg_dir"
bootstrap_pg_service_file="$bootstrap_pg_dir/pg_service.conf"
bootstrap_pgpass_file="$bootstrap_pg_dir/pgpass"
env -i PATH="$PATH" HOME="${HOME:-}" \
  node "$bootstrap_root/scripts/lib/bootstrap-private-config.mjs" write-pg-files \
  "$private_config_file" "$bootstrap_pg_service_file" "$bootstrap_pgpass_file" \
  || deny "private bootstrap database references could not be created"

psql_bootstrap() {
  env -i \
  PATH="$PATH" HOME="${HOME:-}" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" \
  PGSERVICEFILE="$bootstrap_pg_service_file" \
  PGPASSFILE="$bootstrap_pgpass_file" PGSERVICE=kernel_release_bootstrap \
    psql "$@"
}

production_database=$(psql_bootstrap -XqAtv ON_ERROR_STOP=1 \
  -c 'SELECT current_database()') || deny "production database unavailable"
[[ "$production_database" == "cecelia" ]] \
  || deny "bootstrap database must be the production cecelia database"

approval_digest=$(env -i PATH="$PATH" HOME="${HOME:-}" \
  node "$bootstrap_root/scripts/lib/verify-bootstrap-approval.mjs" \
  "$trust_key" "$private_config_file" "$repository" "$pr_number" \
  "$source_head_sha" "$merge_sha" "$actor" "$approval_key_id") \
  || deny "owner approval signature invalid"

# The exact merge tree's canonical runner is the SSOT. Starting from the
# deployed N-1 schema, it applies every missing dependency in order (369..375);
# invoking the ReleaseRun migrations alone is forbidden because their merge-receipt FKs
# depend on migration 372.
pre_cutover_schema=$(psql_bootstrap -XqAtv ON_ERROR_STOP=1 \
  -c "SELECT COALESCE(max(version::integer), 0) FROM schema_version
       WHERE version ~ '^[0-9]+$'") \
  || deny "could not read production schema version"
[[ "$pre_cutover_schema" -ge 368 && "$pre_cutover_schema" -le 375 ]] \
  || deny "production schema is outside the supported N-1 cutover window"
(
  cd "$deploy_root/packages/brain"
  env -i PATH="$PATH" HOME="${HOME:-}" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" \
    KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE="$private_config_file" \
    node --input-type=module - <<'NODE'
import pg from 'pg';
import { runMigrations } from './src/migrate.js';
import { readBootstrapPrivateConfig } from '../../scripts/lib/bootstrap-private-config.mjs';

const privateConfig = readBootstrapPrivateConfig(
  process.env.KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE,
);
const pool = new pg.Pool({
  connectionString: privateConfig.database_url,
  max: 1,
});
try {
  await runMigrations(pool);
} finally {
  await pool.end();
}
NODE
) || deny "canonical migration 369-375 sequence failed"

run_record=$(psql_bootstrap -XqAtv ON_ERROR_STOP=1 \
  -v repository="$repository" \
  -v pr_number="$pr_number" \
  -v source_sha="$source_head_sha" \
  -v merge_sha="$merge_sha" \
  -v actor="$actor" \
  -v key_id="$approval_key_id" \
  -v approval_digest="$approval_digest" <<'SQL'
INSERT INTO kernel_release_bootstrap_runs (
  repository, pr_number, source_head_sha, merge_sha,
  approved_by, approval_key_id, approval_digest
)
VALUES (
  :'repository', :'pr_number'::integer, :'source_sha', :'merge_sha',
  :'actor', :'key_id', :'approval_digest'
)
ON CONFLICT (singleton) DO NOTHING;
SELECT concat_ws(E'\t', id, repository, pr_number, source_head_sha, merge_sha,
                 approved_by, approval_key_id, approval_digest)
  FROM kernel_release_bootstrap_runs
 WHERE singleton = TRUE;
SQL
) || deny "bootstrap run identity could not be persisted"

IFS=$'\t' read -r bootstrap_run_id stored_repository stored_pr stored_source \
  stored_merge stored_actor stored_key stored_digest <<< "$run_record"
[[ "$stored_repository" == "$repository"
  && "$stored_pr" == "$pr_number"
  && "$stored_source" == "$source_head_sha"
  && "$stored_merge" == "$merge_sha"
  && "$stored_actor" == "$actor"
  && "$stored_key" == "$approval_key_id"
  && "$stored_digest" == "$approval_digest" ]] \
  || deny "a different bootstrap cutover already exists"

latest_state() {
  psql_bootstrap -XqAtv ON_ERROR_STOP=1 \
    -v run_id="$bootstrap_run_id" -c \
    "SELECT state FROM kernel_release_bootstrap_transitions
      WHERE bootstrap_run_id = :'run_id'
      ORDER BY append_seq DESC LIMIT 1"
}

append_transition() {
  local state="$1" effect_receipt_id="" e2e_manifest_digest=""
  local artifact_intent_ids="[]" artifact_receipt_ids="[]"
  local receipt_artifact_versions="[]" receipt_evidence="{}"
  if [[ -n "${2:-}" ]]; then
    IFS=$'\t' read -r effect_receipt_id e2e_manifest_digest \
      artifact_intent_ids artifact_receipt_ids \
      receipt_artifact_versions receipt_evidence < <(
      env -i PATH="$PATH" HOME="${HOME:-}" node -e '
        const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write([
          value.receipt_id || "",
          value.manifest_digest || "",
          JSON.stringify(value.artifact_rollback_intent_ids || []),
          JSON.stringify(value.artifact_rollback_receipt_ids || []),
          JSON.stringify(value.artifact_versions || []),
          JSON.stringify(value.receipt_evidence || {}),
        ].join("\t") + "\n");
      ' "$2"
    )
  fi
  psql_bootstrap -Xqv ON_ERROR_STOP=1 \
    -v run_id="$bootstrap_run_id" -v state="$state" -v merge_sha="$merge_sha" \
    -v effect_receipt_id="$effect_receipt_id" \
    -v e2e_manifest_digest="$e2e_manifest_digest" \
    -v artifact_intent_ids="$artifact_intent_ids" \
    -v artifact_receipt_ids="$artifact_receipt_ids" \
    -v receipt_artifact_versions="$receipt_artifact_versions" \
    -v receipt_evidence="$receipt_evidence" <<'SQL' \
    >/dev/null
INSERT INTO kernel_release_bootstrap_transitions (
  bootstrap_run_id, state, evidence
)
VALUES (
  :'run_id', :'state',
  jsonb_strip_nulls(jsonb_build_object(
    'merge_sha', :'merge_sha',
    'recorded_by', 'bootstrap-controller',
    'effect_receipt_id', NULLIF(:'effect_receipt_id', ''),
    'e2e_manifest_digest', NULLIF(:'e2e_manifest_digest', ''),
    'artifact_versions',
      CASE WHEN :'receipt_artifact_versions' = '[]' THEN NULL
           ELSE :'receipt_artifact_versions'::jsonb END,
    'receipt_evidence',
      CASE WHEN :'receipt_evidence' = '{}' THEN NULL
           ELSE :'receipt_evidence'::jsonb END,
    'artifact_rollback_intent_ids',
      CASE WHEN :'artifact_intent_ids' = '[]' THEN NULL
           ELSE :'artifact_intent_ids'::jsonb END,
    'artifact_rollback_receipt_ids',
      CASE WHEN :'artifact_receipt_ids' = '[]' THEN NULL
           ELSE :'artifact_receipt_ids'::jsonb END
  ))
)
ON CONFLICT (bootstrap_run_id, state) DO NOTHING;
SQL
}

latest_attempt_id() {
  local effect_kind="$1"
  psql_bootstrap -XqAtv ON_ERROR_STOP=1 \
    -v run_id="$bootstrap_run_id" -v effect_kind="$effect_kind" -c \
    "SELECT id FROM kernel_release_bootstrap_effect_attempts
      WHERE bootstrap_run_id = :'run_id' AND effect_kind = :'effect_kind'
      ORDER BY generation DESC LIMIT 1"
}

record_receipt() {
  local attempt_id="$1" receipt_status="$2" detail="$3"
  [[ "$attempt_id" =~ ^[0-9]+$ ]] || deny "effect attempt receipt is missing"
  psql_bootstrap -Xqv ON_ERROR_STOP=1 \
    -v attempt_id="$attempt_id" -v status="$receipt_status" \
    -v detail="$detail" -v merge_sha="$merge_sha" <<'SQL' >/dev/null
INSERT INTO kernel_release_bootstrap_effect_receipts (
  effect_attempt_id, receipt_status, evidence
)
VALUES (
  :'attempt_id'::bigint, :'status',
  jsonb_build_object('merge_sha', :'merge_sha', 'detail', :'detail')
)
ON CONFLICT DO NOTHING;
SQL
}

manifest_file=$(mktemp "${TMPDIR:-/tmp}/kernel-bootstrap-manifest.XXXXXX")
chmod 600 "$manifest_file"
env -i PATH="$PATH" HOME="${HOME:-}" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" \
KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE="$private_config_file" \
KERNEL_RELEASE_BOOTSTRAP_RUN_ID="$bootstrap_run_id" \
KERNEL_RELEASE_REPOSITORY="$repository" \
KERNEL_RELEASE_SOURCE_HEAD_SHA="$source_head_sha" \
KERNEL_RELEASE_MERGE_SHA="$merge_sha" \
KERNEL_RELEASE_BOOTSTRAP_DEPLOY_ROOT="$deploy_root" \
KERNEL_RELEASE_BOOTSTRAP_E2E_OUTPUT_FILE="$manifest_file" \
  node "$deploy_root/scripts/lib/release-run-bootstrap-e2e.mjs" materialize \
  || deny "exact approved E2E manifest could not be materialized"
artifact_versions=$(env -i PATH="$PATH" HOME="${HOME:-}" node -e '
  const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(JSON.stringify(value.artifact_versions));
' "$manifest_file") || deny "materialized artifact versions could not be read"

attempt_is_live() {
  local attempt_id="$1"
  [[ "$attempt_id" =~ ^[0-9]+$ ]] || return 1
  [[ "$(psql_bootstrap -XqAtv ON_ERROR_STOP=1 \
    -v attempt_id="$attempt_id" -c \
    "SELECT GREATEST(
              attempt.lease_expires_at,
              COALESCE(MAX(renewal.lease_expires_at), attempt.lease_expires_at)
            ) > clock_timestamp()
       FROM kernel_release_bootstrap_effect_attempts attempt
       LEFT JOIN kernel_release_bootstrap_effect_attempt_renewals renewal
         ON renewal.effect_attempt_id = attempt.id
        AND renewal.generation = attempt.generation
      WHERE attempt.id = :'attempt_id'::bigint
      GROUP BY attempt.id, attempt.lease_expires_at")" == "t" ]]
}

renew_attempt_once() {
  local attempt_id="$1"
  psql_bootstrap -XqAtv ON_ERROR_STOP=1 \
    -v attempt_id="$attempt_id" <<'SQL'
INSERT INTO kernel_release_bootstrap_effect_attempt_renewals (
  effect_attempt_id, generation, lease_expires_at
)
SELECT attempt.id, attempt.generation,
       clock_timestamp() + interval '15 minutes'
  FROM kernel_release_bootstrap_effect_attempts attempt
 WHERE attempt.id = :'attempt_id'::bigint
   AND attempt.generation = (
     SELECT MAX(latest.generation)
       FROM kernel_release_bootstrap_effect_attempts latest
      WHERE latest.bootstrap_run_id = attempt.bootstrap_run_id
        AND latest.effect_kind = attempt.effect_kind
   )
   AND GREATEST(
     attempt.lease_expires_at,
     COALESCE((
       SELECT MAX(renewal.lease_expires_at)
         FROM kernel_release_bootstrap_effect_attempt_renewals renewal
        WHERE renewal.effect_attempt_id = attempt.id
          AND renewal.generation = attempt.generation
     ), attempt.lease_expires_at)
   ) > clock_timestamp()
   AND NOT EXISTS (
     SELECT 1
       FROM kernel_release_bootstrap_effect_receipts receipt
      WHERE receipt.effect_attempt_id = attempt.id
    )
RETURNING id;
SQL
}

start_attempt_renewal() {
  local attempt_id="$1" renewal_id
  [[ "$attempt_id" =~ ^[0-9]+$ ]] || deny "effect attempt renewal is missing"
  stop_attempt_renewal
  renewal_id=$(renew_attempt_once "$attempt_id") || return 1
  [[ "$renewal_id" =~ ^[0-9]+$ ]] || return 1
  (
    while sleep 60; do
      renewal_id=$(renew_attempt_once "$attempt_id") || exit 0
      [[ "$renewal_id" =~ ^[0-9]+$ ]] || exit 0
    done
  ) &
  attempt_renewal_pid=$!
}

run_bootstrap_effect() {
  local effect_kind="$1" effect_script="$2" effect_pid wait_round
  attempt_file=$(mktemp "${TMPDIR:-/tmp}/kernel-bootstrap-attempt.XXXXXX")
  chmod 600 "$attempt_file"
  env -i \
    PATH="$PATH" HOME="${HOME:-}" USER="${USER:-}" LOGNAME="${LOGNAME:-}" \
    TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" \
    TZ="${TZ:-}" SHELL="${SHELL:-}" ENV_REGION="${ENV_REGION:-us}" \
    DOCKER_HOST="${DOCKER_HOST:-}" DOCKER_CONFIG="${DOCKER_CONFIG:-}" \
    DEPLOY_STATUS_FILE="${DEPLOY_STATUS_FILE:-}" HOST_HOME="${HOST_HOME:-}" \
    BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" \
    BRAIN_STAGING_URL="${BRAIN_STAGING_URL:-http://localhost:5222}" \
    KERNEL_RELEASE_BOOTSTRAP=1 \
    KERNEL_RELEASE_BOOTSTRAP_RUN_ID="$bootstrap_run_id" \
    KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE="$private_config_file" \
    KERNEL_RELEASE_BOOTSTRAP_PG_SERVICE_FILE="$bootstrap_pg_service_file" \
    KERNEL_RELEASE_BOOTSTRAP_PGPASS_FILE="$bootstrap_pgpass_file" \
    KERNEL_RELEASE_BOOTSTRAP_DEPLOY_ROOT="$deploy_root" \
    KERNEL_RELEASE_BOOTSTRAP_ATTEMPT_FILE="$attempt_file" \
    KERNEL_RELEASE_RUN_ID="$bootstrap_run_id" \
    KERNEL_RELEASE_ARTIFACT_VERSIONS="$artifact_versions" \
    KERNEL_RELEASE_REPOSITORY="$repository" \
    KERNEL_RELEASE_PR_NUMBER="$pr_number" \
    KERNEL_RELEASE_SOURCE_HEAD_SHA="$source_head_sha" \
    KERNEL_RELEASE_MERGE_SHA="$merge_sha" \
    KERNEL_RELEASE_BOOTSTRAP_ACTOR="$actor" \
    KERNEL_RELEASE_BOOTSTRAP_APPROVAL_KEY_ID="$approval_key_id" \
    bash "$effect_script" &
  effect_pid=$!

  attempt_id=""
  for wait_round in $(seq 1 300); do
    attempt_id=$(grep -E '^[0-9]+$' "$attempt_file" | tail -1 || true)
    [[ -z "$attempt_id" ]] || break
    kill -0 "$effect_pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
  if [[ -n "$attempt_id" ]]; then
    if ! start_attempt_renewal "$attempt_id"; then
      kill "$effect_pid" >/dev/null 2>&1 || true
      wait "$effect_pid" >/dev/null 2>&1 || true
      effect_rc=78
      rm -f "$attempt_file"
      attempt_file=""
      return 0
    fi
  fi

  set +e
  wait "$effect_pid"
  effect_rc=$?
  set -e
  rm -f "$attempt_file"
  attempt_file=""
  if [[ -z "$attempt_id" && "$effect_rc" -eq 0 ]]; then
    effect_rc=78
  fi
}

execute_manifest() {
  local environment="$1" attempt_id="$2"
  receipt_file=$(mktemp "${TMPDIR:-/tmp}/kernel-bootstrap-receipt.XXXXXX")
  chmod 600 "$receipt_file"
  env -i PATH="$PATH" HOME="${HOME:-}" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" \
  KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE="$private_config_file" \
  KERNEL_RELEASE_BOOTSTRAP_RUN_ID="$bootstrap_run_id" \
  KERNEL_RELEASE_REPOSITORY="$repository" \
  KERNEL_RELEASE_MERGE_SHA="$merge_sha" \
  KERNEL_RELEASE_BOOTSTRAP_DEPLOY_ROOT="$deploy_root" \
  KERNEL_RELEASE_BOOTSTRAP_EFFECT_ATTEMPT_ID="$attempt_id" \
  KERNEL_RELEASE_BOOTSTRAP_E2E_ENVIRONMENT="$environment" \
  KERNEL_RELEASE_BOOTSTRAP_E2E_OUTPUT_FILE="$receipt_file" \
  BRAIN_STAGING_URL="${BRAIN_STAGING_URL:-http://localhost:5222}" \
  BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" \
    node "$deploy_root/scripts/lib/release-run-bootstrap-e2e.mjs" execute
}

state=$(latest_state)
[[ "$state" != "production_verified" ]] \
  || deny "the one-time bootstrap is terminal and permanently closed"
if [[ -z "$state" ]]; then
  append_transition approved
  state=approved
fi

if [[ "$state" == "approved" ]]; then
  append_transition staging_intent
  state=staging_intent
fi
if [[ "$state" == "staging_intent" ]]; then
  attempt_id=$(latest_attempt_id staging)
  recovered_staging=false
  if [[ -n "$attempt_id" ]]; then
    start_attempt_renewal "$attempt_id" || true
  fi
  if [[ -n "$attempt_id" ]] && execute_manifest staging "$attempt_id"; then
    stop_attempt_renewal
    append_transition staging_passed "$receipt_file"
    state=staging_passed
    recovered_staging=true
  fi
  if [[ "$recovered_staging" != "true" ]]; then
    stop_attempt_renewal
    if [[ -n "$attempt_id" ]] && attempt_is_live "$attempt_id"; then
      deny "staging effect outcome is ambiguous while its lease is live"
    fi
    run_bootstrap_effect staging "$deploy_root/scripts/staging-deploy.sh"
    if [[ "$effect_rc" -ne 0 ]]; then
      record_receipt "$attempt_id" failed "staging deploy exit ${effect_rc}"
      deny "staging deploy failed"
    fi
    execute_manifest staging "$attempt_id" \
      || { record_receipt "$attempt_id" observed_unconfirmed "staging manifest execution failed"; deny "staging E2E evidence failed"; }
    stop_attempt_renewal
    append_transition staging_passed "$receipt_file"
    state=staging_passed
  fi
fi

if [[ "$state" == "staging_passed" ]]; then
  [[ -n "$receipt_file" ]] || {
    receipt_file=$(mktemp "${TMPDIR:-/tmp}/kernel-bootstrap-receipt.XXXXXX")
    chmod 600 "$receipt_file"
  }
  env -i PATH="$PATH" HOME="${HOME:-}" LANG="${LANG:-}" LC_ALL="${LC_ALL:-}" \
  KERNEL_RELEASE_BOOTSTRAP_PRIVATE_CONFIG_FILE="$private_config_file" \
  KERNEL_RELEASE_BOOTSTRAP_RUN_ID="$bootstrap_run_id" \
  KERNEL_RELEASE_REPOSITORY="$repository" \
  KERNEL_RELEASE_MERGE_SHA="$merge_sha" \
  KERNEL_RELEASE_BOOTSTRAP_DEPLOY_ROOT="$deploy_root" \
  KERNEL_RELEASE_BOOTSTRAP_E2E_OUTPUT_FILE="$receipt_file" \
  BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" \
    node "$deploy_root/scripts/lib/release-run-bootstrap-e2e.mjs" prepare-rollback \
    || deny "bootstrap rollback intents could not be prepared"
  append_transition production_intent "$receipt_file"
  state=production_intent
fi
if [[ "$state" == "production_intent" ]]; then
  attempt_id=$(latest_attempt_id production)
  recovered_production=false
  if [[ -n "$attempt_id" ]]; then
    start_attempt_renewal "$attempt_id" || true
  fi
  if [[ -n "$attempt_id" ]] && execute_manifest production "$attempt_id"; then
    stop_attempt_renewal
    append_transition production_verified "$receipt_file"
    recovered_production=true
  fi
  if [[ "$recovered_production" != "true" ]]; then
    stop_attempt_renewal
    if [[ -n "$attempt_id" ]] && attempt_is_live "$attempt_id"; then
      deny "production effect outcome is ambiguous while its lease is live"
    fi
    run_bootstrap_effect production "$deploy_root/scripts/brain-deploy.sh"
    if [[ "$effect_rc" -ne 0 ]]; then
      record_receipt "$attempt_id" failed "production deploy exit ${effect_rc}"
      deny "production deploy failed"
    fi
    execute_manifest production "$attempt_id" \
      || { record_receipt "$attempt_id" observed_unconfirmed "production manifest execution failed"; deny "production evidence failed"; }
    stop_attempt_renewal
    append_transition production_verified "$receipt_file"
  fi
fi

echo "Kernel ReleaseRun bootstrap completed: ${bootstrap_run_id} ${merge_sha}"
