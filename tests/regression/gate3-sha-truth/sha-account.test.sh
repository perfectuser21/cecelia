#!/usr/bin/env bash
# sha-account.test.sh — Kernel ReleaseRun exact-SHA / receipt-authority L1 contract.
#
# Historical note: this stable test entrypoint used to inspect the deleted
# Gate3 PROD_SHA/HEAD_SHA text path. The production authority is now the
# durable Kernel merge receipt plus ReleaseRun, so this test proves the new
# authority instead of requiring the retired direct-deploy workflow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/brain-ci-deploy.yml"
DEPLOY_WORKFLOW="$ROOT_DIR/.github/workflows/deploy.yml"
ADAPTER="$ROOT_DIR/packages/brain/src/orchestrator/github-merge-adapter.js"
MERGE_STORE="$ROOT_DIR/packages/brain/src/orchestrator/merge-effect-store.js"
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

require_file() {
  local file="$1"
  local label="$2"
  if [[ -f "$file" ]]; then
    pass "$label"
  else
    fail "$label: missing $file"
  fi
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

reject_pattern() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if grep -Eq -- "$pattern" "$file"; then
    fail "$label"
  else
    pass "$label"
  fi
}

printf '=== Kernel ReleaseRun exact-SHA authority contract ===\n'

for item in \
  "$WORKFLOW:Brain ReleaseRun PR workflow exists" \
  "$DEPLOY_WORKFLOW:authorized production workflow exists" \
  "$ADAPTER:GitHub merge adapter exists" \
  "$MERGE_STORE:durable merge store exists" \
  "$RELEASE_STORE:durable ReleaseRun store exists" \
  "$RELEASE_EXECUTOR:ReleaseRun executor exists"
do
  require_file "${item%%:*}" "${item#*:}"
done

# CI must retain a mandatory PR job under the new authority name. It installs
# the exact Node dependency graph because the shell contract executes the real
# merge and ReleaseRun unit suites below.
require_pattern "$WORKFLOW" '^  sha-account-l1:$' \
  'PR workflow exposes the ReleaseRun authority L1 job'
require_pattern "$WORKFLOW" 'name: L1 Kernel ReleaseRun Authority Contract' \
  'L1 job name states the durable authority contract'
require_pattern "$WORKFLOW" 'uses: actions/setup-node@v4' \
  'L1 job provisions Node'
require_pattern "$WORKFLOW" 'run: npm ci --ignore-scripts' \
  'L1 job installs the lockfile exactly'
require_pattern "$WORKFLOW" \
  'bash tests/regression/gate3-sha-truth/sha-account\.test\.sh' \
  'L1 job executes this stable contract entrypoint'
require_pattern "$WORKFLOW" \
  'bash packages/engine/tests/integration/release-deploy-stage\.test\.sh' \
  'L1 job executes the durable stage-mapping contract'
require_pattern "$WORKFLOW" \
  "^[[:space:]]+- 'tests/regression/gate3-sha-truth/sha-account\\.test\\.sh'$" \
  'changes to this contract trigger the PR guard'
require_pattern "$WORKFLOW" \
  "^[[:space:]]+- 'packages/engine/tests/integration/release-deploy-stage\\.test\\.sh'$" \
  'changes to the stage contract trigger the PR guard'
require_pattern "$WORKFLOW" \
  "^[[:space:]]+- '\\.github/workflows/deploy\\.yml'$" \
  'changes to the authorized deploy workflow trigger the PR guard'

# The dispatch boundary accepts and forwards all three immutable axes. A
# mutable branch name, changed-path hint, or empty POST cannot authorize it.
for axis in release_run_id merge_sha release_authorization; do
  require_pattern "$WORKFLOW" "^      ${axis}:$" \
    "Brain workflow declares $axis"
  require_pattern "$WORKFLOW" "${axis}:.*inputs\\.${axis}" \
    "Brain workflow forwards $axis"
  require_pattern "$DEPLOY_WORKFLOW" "^      ${axis}:$" \
    "production workflow declares $axis"
done
reject_pattern "$WORKFLOW" '^  push:$|branches: *\[?main' \
  'Brain workflow has no direct main-push deploy authority'
reject_pattern "$DEPLOY_WORKFLOW" "-d ['\"]\\{\\}['\"]" \
  'production workflow cannot issue an empty deploy request'

require_pattern "$DEPLOY_WORKFLOW" \
  'RELEASE_RUN_ID:.*inputs\.release_run_id' \
  'production effect binds the ReleaseRun UUID'
require_pattern "$DEPLOY_WORKFLOW" \
  'MERGE_SHA:.*inputs\.merge_sha' \
  'production effect binds the exact merge SHA'
require_pattern "$DEPLOY_WORKFLOW" \
  'RELEASE_AUTHORIZATION:.*inputs\.release_authorization' \
  'production effect binds the persisted authorization'
require_pattern "$DEPLOY_WORKFLOW" \
  '/api/brain/deploy' \
  'production effect uses the authorized Brain endpoint'
require_pattern "$DEPLOY_WORKFLOW" \
  "test \"\\\$HTTP_CODE\" = \"202\"" \
  'production effect requires an accepted HTTP receipt'
require_pattern "$DEPLOY_WORKFLOW" \
  "jq -e '.status == \"accepted\"'" \
  'production effect requires the accepted response contract'

# Exact-SHA merge truth is rooted in GitHub observation and an immutable
# confirmed receipt; ReleaseRun may only materialize from that receipt.
require_pattern "$ADAPTER" "'--match-head-commit'" \
  'GitHub merge is fenced to the observed head SHA'
require_pattern "$MERGE_STORE" "receipt_status = 'confirmed'" \
  'merge store persists a confirmed effect receipt'
require_pattern "$RELEASE_STORE" "receipt\\.receipt_status = 'confirmed'" \
  'ReleaseRun roots in a confirmed merge receipt'
require_pattern "$RELEASE_STORE" 'receipt\.merged = TRUE' \
  'ReleaseRun requires GitHub merged truth'
require_pattern "$RELEASE_STORE" \
  'receipt\.observed_head_sha = intent\.requested_head_sha' \
  'ReleaseRun requires the exact requested head'
require_pattern "$RELEASE_EXECUTOR" "release\\.state === 'production_verified'" \
  'ReleaseRun only reports done at production_verified'

if [[ "$FAIL" -ne 0 ]]; then
  printf 'STATIC_CONTRACT_FAIL: %s passed / %s failed\n' "$PASS" "$FAIL"
  exit 1
fi

(
  cd "$ROOT_DIR/packages/brain"
  npx --no-install vitest run \
    src/orchestrator/__tests__/github-merge-adapter.test.js \
    src/orchestrator/__tests__/merge-effect-executor.test.js \
    src/orchestrator/__tests__/release-run-store.test.js \
    src/orchestrator/__tests__/release-run-executor.test.js \
    --reporter=dot
)

printf 'RELEASE_RUN_SHA_ACCOUNT_PASS: %s static assertions\n' "$PASS"
