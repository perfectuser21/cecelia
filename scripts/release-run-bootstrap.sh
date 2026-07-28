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
database_url="${KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL:-}"
repository="${KERNEL_RELEASE_REPOSITORY:-}"
pr_number="${KERNEL_RELEASE_PR_NUMBER:-}"
source_head_sha="${KERNEL_RELEASE_SOURCE_HEAD_SHA:-}"
merge_sha="${KERNEL_RELEASE_MERGE_SHA:-}"
actor="${KERNEL_RELEASE_BOOTSTRAP_ACTOR:-}"
approval_key_id="${KERNEL_RELEASE_BOOTSTRAP_APPROVAL_KEY_ID:-}"
approval_signature="${KERNEL_RELEASE_BOOTSTRAP_APPROVAL_SIGNATURE:-}"
trust_key="/etc/cecelia/kernel-release-bootstrap-owner-v1.pub"

[[ "$deploy_root" == /* ]] \
  || deny "a dedicated absolute deploy root is required"
[[ "$(git -C "$deploy_root" rev-parse --is-inside-work-tree 2>/dev/null || true)" == "true" ]] \
  || deny "dedicated deploy root is not a git worktree"
[[ "$database_url" =~ ^postgres(ql)?:// ]] \
  || deny "explicit production database URL is required"
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || deny "repository must be owner/name"
[[ "$pr_number" =~ ^[1-9][0-9]*$ ]] || deny "positive PR number required"
[[ "$source_head_sha" =~ ^[0-9a-f]{40}$ ]] || deny "exact source SHA required"
[[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]] || deny "exact merge SHA required"
[[ -n "$actor" ]] || deny "owner actor required"
[[ "$approval_key_id" == "owner-v1" && -n "$approval_signature" ]] \
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
# before migration 374 or any bootstrap ledger row can be created.
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
main_ref="refs/kernel-bootstrap/pr-${pr_number}-main"
cleanup_refs() {
  git -C "$deploy_root" update-ref -d "$source_ref" >/dev/null 2>&1 || true
  git -C "$deploy_root" update-ref -d "$main_ref" >/dev/null 2>&1 || true
}
trap cleanup_refs EXIT
git -C "$deploy_root" fetch --no-tags origin \
  "${source_head_sha}:${source_ref}" >/dev/null 2>&1 \
  || deny "exact source SHA could not be fetched"
git -C "$deploy_root" fetch --no-tags origin \
  "refs/heads/main:${main_ref}" >/dev/null 2>&1 \
  || deny "origin/main could not be fetched"
[[ "$(git -C "$deploy_root" rev-parse "$source_ref")" == "$source_head_sha" ]] \
  || deny "fetched source ref does not match approved source SHA"
git -C "$deploy_root" cat-file -e "${merge_sha}^{commit}" \
  || deny "approved merge SHA is not present in origin/main"
git -C "$deploy_root" merge-base --is-ancestor "$merge_sha" "$main_ref" \
  || deny "approved merge SHA is not reachable from origin/main"
git -C "$deploy_root" switch --detach "$merge_sha" >/dev/null
[[ "$(git -C "$deploy_root" rev-parse HEAD)" == "$merge_sha" ]] \
  || deny "dedicated deploy root checkout is not exact merge SHA"

production_database=$(psql "$database_url" -XqAtv ON_ERROR_STOP=1 \
  -c 'SELECT current_database()') || deny "production database unavailable"
[[ "$production_database" == "cecelia" ]] \
  || deny "bootstrap database must be the production cecelia database"

approval_digest=$(node "$bootstrap_root/scripts/lib/verify-bootstrap-approval.mjs" \
  "$trust_key" "$repository" "$pr_number" "$source_head_sha" "$merge_sha" \
  "$actor" "$approval_key_id" "$approval_signature") \
  || deny "owner approval signature invalid"

# The exact merge tree's canonical runner is the SSOT. Starting from the
# deployed N-1 schema, it applies every missing dependency in order (369..374);
# invoking migration 374 alone is forbidden because its merge-receipt FKs
# depend on migration 372.
pre_cutover_schema=$(psql "$database_url" -XqAtv ON_ERROR_STOP=1 \
  -c "SELECT COALESCE(max(version::integer), 0) FROM schema_version
       WHERE version ~ '^[0-9]+$'") \
  || deny "could not read production schema version"
[[ "$pre_cutover_schema" -ge 368 && "$pre_cutover_schema" -le 374 ]] \
  || deny "production schema is outside the supported N-1 cutover window"
(
  cd "$deploy_root/packages/brain"
  KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL="$database_url" \
    node --input-type=module - <<'NODE'
import pg from 'pg';
import { runMigrations } from './src/migrate.js';

const pool = new pg.Pool({
  connectionString: process.env.KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL,
  max: 1,
});
try {
  await runMigrations(pool);
} finally {
  await pool.end();
}
NODE
) || deny "canonical migration 369-374 sequence failed"

run_record=$(psql "$database_url" -XqAtv ON_ERROR_STOP=1 \
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
  psql "$database_url" -XqAtv ON_ERROR_STOP=1 \
    -v run_id="$bootstrap_run_id" -c \
    "SELECT state FROM kernel_release_bootstrap_transitions
      WHERE bootstrap_run_id = :'run_id'
      ORDER BY append_seq DESC LIMIT 1"
}

append_transition() {
  local state="$1"
  psql "$database_url" -Xqv ON_ERROR_STOP=1 \
    -v run_id="$bootstrap_run_id" -v state="$state" -v merge_sha="$merge_sha" <<'SQL' \
    >/dev/null
INSERT INTO kernel_release_bootstrap_transitions (
  bootstrap_run_id, state, evidence
)
VALUES (
  :'run_id', :'state',
  jsonb_build_object('merge_sha', :'merge_sha', 'recorded_by', 'bootstrap-controller')
)
ON CONFLICT (bootstrap_run_id, state) DO NOTHING;
SQL
}

latest_attempt_id() {
  local effect_kind="$1"
  psql "$database_url" -XqAtv ON_ERROR_STOP=1 \
    -v run_id="$bootstrap_run_id" -v effect_kind="$effect_kind" -c \
    "SELECT id FROM kernel_release_bootstrap_effect_attempts
      WHERE bootstrap_run_id = :'run_id' AND effect_kind = :'effect_kind'
      ORDER BY generation DESC LIMIT 1"
}

record_receipt() {
  local attempt_id="$1" receipt_status="$2" detail="$3"
  [[ "$attempt_id" =~ ^[0-9]+$ ]] || deny "effect attempt receipt is missing"
  psql "$database_url" -Xqv ON_ERROR_STOP=1 \
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

expected_version=$(node -e \
  "process.stdout.write(require('$deploy_root/packages/brain/package.json').version)")

observe_environment() {
  local base_url="$1" require_rollback="$2"
  local health_file full_file deploy_file
  health_file=$(mktemp "${TMPDIR:-/tmp}/kernel-bootstrap-health.XXXXXX")
  full_file=$(mktemp "${TMPDIR:-/tmp}/kernel-bootstrap-full.XXXXXX")
  deploy_file=$(mktemp "${TMPDIR:-/tmp}/kernel-bootstrap-deploy.XXXXXX")
  curl -fsS --connect-timeout 5 --max-time 20 \
    "${base_url}/api/brain/health" > "$health_file" || {
      rm -f "$health_file" "$full_file" "$deploy_file"; return 1;
    }
  curl -fsS --connect-timeout 5 --max-time 20 \
    "${base_url}/api/brain/status/full" > "$full_file" || {
      rm -f "$health_file" "$full_file" "$deploy_file"; return 1;
    }
  if [[ "$require_rollback" == "true" ]]; then
    curl -fsS --connect-timeout 5 --max-time 20 \
      "${base_url}/api/brain/deploy/status" > "$deploy_file" || {
        rm -f "$health_file" "$full_file" "$deploy_file"; return 1;
      }
  else
    printf '{}' > "$deploy_file"
  fi
  node - "$health_file" "$full_file" "$deploy_file" "$merge_sha" \
    "$expected_version" "$require_rollback" <<'NODE'
const fs = require('node:fs');
const [healthPath, fullPath, deployPath, mergeSha, version, requireRollback] = process.argv.slice(2);
const health = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
const full = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
const deploy = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
const digest = /^sha256:[0-9a-f]{64}$/;
if (health.status !== 'healthy' || health.git_sha !== mergeSha || health.version !== version) process.exit(1);
if (!full || full.error != null) process.exit(1);
if (requireRollback === 'true' && (
  deploy.status !== 'success'
  || deploy.merge_sha !== mergeSha
  || !digest.test(deploy.deployed_image_digest || '')
  || !digest.test(deploy.rollback_image_digest || '')
  || deploy.deployed_image_digest === deploy.rollback_image_digest
  || !/^cecelia-brain:rollback-[0-9a-f]{12}$/.test(deploy.rollback_image_tag || '')
  || deploy.rollback_image_exists !== true
  || deploy.rollback_probe !== 'pass'
  || typeof deploy.rollback_command !== 'string'
  || !deploy.rollback_command.includes(deploy.rollback_image_tag.replace('cecelia-brain:', ''))
)) process.exit(1);
NODE
  local result=$?
  rm -f "$health_file" "$full_file" "$deploy_file"
  return "$result"
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
  if [[ -z "$attempt_id" ]] \
    || ! observe_environment "${BRAIN_STAGING_URL:-http://localhost:5222}" false; then
    set +e
    KERNEL_RELEASE_BOOTSTRAP=1 \
      KERNEL_RELEASE_BOOTSTRAP_RUN_ID="$bootstrap_run_id" \
      KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL="$database_url" \
      KERNEL_RELEASE_REPOSITORY="$repository" \
      KERNEL_RELEASE_PR_NUMBER="$pr_number" \
      KERNEL_RELEASE_SOURCE_HEAD_SHA="$source_head_sha" \
      KERNEL_RELEASE_MERGE_SHA="$merge_sha" \
      KERNEL_RELEASE_BOOTSTRAP_ACTOR="$actor" \
      KERNEL_RELEASE_BOOTSTRAP_APPROVAL_KEY_ID="$approval_key_id" \
      KERNEL_RELEASE_BOOTSTRAP_APPROVAL_SIGNATURE="$approval_signature" \
      bash "$deploy_root/scripts/staging-deploy.sh"
    effect_rc=$?
    set -e
    attempt_id=$(latest_attempt_id staging)
    if [[ "$effect_rc" -ne 0 ]]; then
      record_receipt "$attempt_id" failed "staging deploy exit ${effect_rc}"
      deny "staging deploy failed"
    fi
    observe_environment "${BRAIN_STAGING_URL:-http://localhost:5222}" false \
      || { record_receipt "$attempt_id" observed_unconfirmed "staging observation failed"; deny "staging E2E evidence failed"; }
  fi
  record_receipt "$attempt_id" confirmed "staging exact-SHA health and E2E passed"
  append_transition staging_passed
  state=staging_passed
fi

if [[ "$state" == "staging_passed" ]]; then
  append_transition production_intent
  state=production_intent
fi
if [[ "$state" == "production_intent" ]]; then
  attempt_id=$(latest_attempt_id production)
  if [[ -z "$attempt_id" ]] \
    || ! observe_environment "${BRAIN_URL:-http://localhost:5221}" true; then
    set +e
    KERNEL_RELEASE_BOOTSTRAP=1 \
      KERNEL_RELEASE_BOOTSTRAP_RUN_ID="$bootstrap_run_id" \
      KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL="$database_url" \
      KERNEL_RELEASE_REPOSITORY="$repository" \
      KERNEL_RELEASE_PR_NUMBER="$pr_number" \
      KERNEL_RELEASE_SOURCE_HEAD_SHA="$source_head_sha" \
      KERNEL_RELEASE_MERGE_SHA="$merge_sha" \
      KERNEL_RELEASE_BOOTSTRAP_ACTOR="$actor" \
      KERNEL_RELEASE_BOOTSTRAP_APPROVAL_KEY_ID="$approval_key_id" \
      KERNEL_RELEASE_BOOTSTRAP_APPROVAL_SIGNATURE="$approval_signature" \
      bash "$deploy_root/scripts/brain-deploy.sh"
    effect_rc=$?
    set -e
    attempt_id=$(latest_attempt_id production)
    if [[ "$effect_rc" -ne 0 ]]; then
      record_receipt "$attempt_id" failed "production deploy exit ${effect_rc}"
      deny "production deploy failed"
    fi
    observe_environment "${BRAIN_URL:-http://localhost:5221}" true \
      || { record_receipt "$attempt_id" observed_unconfirmed "production observation failed"; deny "production evidence failed"; }
  fi
  record_receipt "$attempt_id" confirmed "production exact-SHA health, E2E, and rollback passed"
  append_transition production_verified
fi

echo "Kernel ReleaseRun bootstrap completed: ${bootstrap_run_id} ${merge_sha}"
