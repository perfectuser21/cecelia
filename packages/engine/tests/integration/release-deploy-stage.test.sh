#!/usr/bin/env bash
# release-deploy-stage.test.sh — durable Kernel ReleaseRun stage contract.
#
# The former contract drove promote-dashboard.sh through --release-only and
# --deploy <tag>, then inspected mutable tag/live/current files. ReleaseRun
# replaces those axes with an immutable merge receipt, staging and production
# effect receipts, an exact state ledger, and durable rollback authority.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/brain-ci-deploy.yml"
MIGRATION_374="$ROOT_DIR/packages/brain/migrations/374_kernel_release_runs.sql"
MIGRATION_375="$ROOT_DIR/packages/brain/migrations/375_kernel_release_run_closure.sql"
MIGRATION_380="$ROOT_DIR/packages/brain/migrations/380_kernel_release_rollback_execution.sql"
RELEASE_STORE="$ROOT_DIR/packages/brain/src/orchestrator/release-run-store.js"
RELEASE_EXECUTOR="$ROOT_DIR/packages/brain/src/orchestrator/release-run-executor.js"

PASS=0
FAIL=0

pass() {
  printf '[PASS] %s\n' "$1"
  PASS=$((PASS + 1))
}

fail() {
  printf '[FAIL] %s\n' "$1"
  FAIL=$((FAIL + 1))
}

require_pattern() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if grep -Eq -- "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label"
  fi
}

printf '=== Durable Kernel ReleaseRun stage mapping ===\n'

# Old release-only => immutable release identity and staging intent/receipt.
require_pattern "$MIGRATION_374" \
  'CREATE TABLE IF NOT EXISTS kernel_release_runs' \
  'release identity is durable'
require_pattern "$MIGRATION_374" \
  'CREATE TABLE IF NOT EXISTS kernel_release_effect_intents' \
  'staging intent exists before the staging effect'
require_pattern "$RELEASE_EXECUTOR" "effectKind: 'staging'" \
  'executor uses the staging effect ledger'
require_pattern "$RELEASE_EXECUTOR" "'staging_passed'" \
  'staging success is an explicit state transition'

# Old deploy <tag> => exact production intent/receipt, never a mutable tag.
require_pattern "$RELEASE_EXECUTOR" "effectKind: 'production'" \
  'executor uses the production effect ledger'
require_pattern "$MIGRATION_375" \
  'kernel_release_effect_receipt_guard' \
  'production receipt is database-fenced'
require_pattern "$MIGRATION_375" \
  'observed_merge_sha.*expected_merge_sha' \
  'receipt is bound to the exact merge SHA'
require_pattern "$MIGRATION_375" \
  'observed_artifact_versions.*expected_artifact_versions' \
  'receipt is bound to exact artifact versions'

# Old missing-tag denial => missing or conflicting durable authority blocks.
require_pattern "$RELEASE_STORE" "deny\\('release_merge_receipt_missing'\\)" \
  'missing merge authority fails closed'
require_pattern "$RELEASE_STORE" "deny\\('release_identity_conflict'\\)" \
  'conflicting release identity fails closed'
require_pattern "$RELEASE_EXECUTOR" 'release_merge_authority_conflict' \
  'executor blocks cross-paired authority'

# Old two-step/full final-state equality => one production_verified root with
# durable rollback evidence, independent of invocation history.
require_pattern "$RELEASE_EXECUTOR" "'production_verified'" \
  'production verification is the only successful terminal state'
require_pattern "$MIGRATION_375" \
  'CREATE TABLE IF NOT EXISTS kernel_release_rollback_receipts' \
  'rollback receipt exists before success'
require_pattern "$MIGRATION_380" \
  'CREATE TABLE IF NOT EXISTS kernel_release_rollback_execution_authorities' \
  'post-production rollback execution has durable authority'

# The migrated Engine contract is also a mandatory PR guard; it must not live
# only as a manually invoked historical script.
require_pattern "$WORKFLOW" '^  sha-account-l1:$' \
  'ReleaseRun contract is wired into PR CI'
require_pattern "$WORKFLOW" \
  'bash tests/regression/gate3-sha-truth/sha-account\.test\.sh' \
  'PR CI runs the exact-SHA receipt contract'
require_pattern "$WORKFLOW" \
  'bash packages/engine/tests/integration/release-deploy-stage\.test\.sh' \
  'PR CI runs this durable stage-mapping contract'
require_pattern "$WORKFLOW" \
  "^[[:space:]]+- 'packages/engine/tests/integration/release-deploy-stage\\.test\\.sh'$" \
  'changes to this stage contract trigger the PR guard'

if [[ "$FAIL" -ne 0 ]]; then
  printf 'RELEASE_RUN_STAGE_STATIC_FAIL: %s passed / %s failed\n' "$PASS" "$FAIL"
  exit 1
fi

(
  cd "$ROOT_DIR/packages/brain"
  npx --no-install vitest run \
    src/orchestrator/__tests__/release-run-contract.test.js \
    src/orchestrator/__tests__/release-run-store.test.js \
    src/orchestrator/__tests__/release-run-executor.test.js \
    src/orchestrator/__tests__/release-run-migration.test.js \
    src/orchestrator/__tests__/release-run-workflow-deploy.test.js \
    --reporter=dot
)

printf 'RELEASE_RUN_STAGE_CONTRACT_PASS: %s static assertions\n' "$PASS"
