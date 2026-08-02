#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

planner_block="$(
  sed -n \
    '/^# planner-finalizer:start$/,/^# planner-finalizer:end$/p' \
    "$ENTRYPOINT"
)"

if [[ -z "$planner_block" ]]; then
  echo "missing planner finalizer implementation" >&2
  exit 1
fi

eval "$planner_block"
type finalize_planner_output >/dev/null 2>&1 || {
  echo "missing finalize_planner_output function" >&2
  exit 1
}
grep -Fq 'if ! finalize_planner_output "$result_file"; then' "$ENTRYPOINT" || {
  echo "provider success path does not require the planner finalizer" >&2
  exit 1
}

REMOTE="$TEST_ROOT/remote.git"
WORKSPACE="$TEST_ROOT/workspace"
SPRINT_DIR='sprints/provider-neutral'
TASK_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
RUN_ID='11111111-1111-4111-8111-111111111111'
PLANNER_BRANCH='cp-harness-prd-aaaaaaaa-r11111111-a2'
TASK_BUNDLE="$TEST_ROOT/task-bundle.json"
WRONG_RUN_BUNDLE="$TEST_ROOT/wrong-run-task-bundle.json"
PROVIDER_RESULT="$TEST_ROOT/provider-result.json"

git init --bare "$REMOTE" >/dev/null
git init -b main "$WORKSPACE" >/dev/null
git -C "$WORKSPACE" config user.name 'Planner Finalizer Test'
git -C "$WORKSPACE" config user.email 'planner-finalizer@example.invalid'
git -C "$WORKSPACE" config core.hooksPath /dev/null
git -C "$WORKSPACE" remote add origin "$REMOTE"
printf '%s\n' 'base' > "$WORKSPACE/README.md"
git -C "$WORKSPACE" add README.md
git -C "$WORKSPACE" commit -m 'chore: initialize planner fixture' >/dev/null

mkdir -p "$WORKSPACE/$SPRINT_DIR"
printf '%s\n' '# Provider-neutral planner PRD' > "$WORKSPACE/$SPRINT_DIR/sprint-prd.md"
cat > "$TASK_BUNDLE" <<JSON
{"task_bundle":{"run_id":"$RUN_ID","attempt_id":"22222222-2222-4222-8222-222222222222","role":"planner","inputs":{"task_id":"$TASK_ID","sprint_dir":"$SPRINT_DIR","planner_branch":"$PLANNER_BRANCH","workspace_spec":{"repo":"perfectuser21/zenithjoy-workspace"}}}}
JSON
cat > "$WRONG_RUN_BUNDLE" <<JSON
{"task_bundle":{"run_id":"$RUN_ID","attempt_id":"22222222-2222-4222-8222-222222222222","role":"planner","inputs":{"task_id":"$TASK_ID","sprint_dir":"$SPRINT_DIR","planner_branch":"cp-harness-prd-aaaaaaaa-r33333333-a2","workspace_spec":{"repo":"perfectuser21/zenithjoy-workspace"}}}}
JSON
printf '%s\n' \
  '{"status":"completed","summary":"provider done","artifacts":["provider-branch-claim"],"checks":[],"decision":null,"error":null}' \
  > "$PROVIDER_RESULT"

HARNESS_NODE=planner \
CECELIA_TASK_ID="$TASK_ID" \
SPRINT_DIR="$SPRINT_DIR" \
PLANNER_BRANCH="$PLANNER_BRANCH" \
WORKTREE_PATH="$WORKSPACE" \
HARNESS_TASK_BUNDLE_FILE="$TASK_BUNDLE" \
  finalize_planner_output "$PROVIDER_RESULT"

REMOTE_SHA="$(git --git-dir="$REMOTE" rev-parse "refs/heads/$PLANNER_BRANCH")"
test "$REMOTE_SHA" = "$(git -C "$WORKSPACE" rev-parse HEAD)"
git --git-dir="$REMOTE" show \
  "$PLANNER_BRANCH:$SPRINT_DIR/sprint-prd.md" >/dev/null

for result in "$PROVIDER_RESULT" "$WORKSPACE/.brain-result.json"; do
  jq -e \
    --arg sha "$REMOTE_SHA" \
    --arg branch "$PLANNER_BRANCH" \
    --arg path "$SPRINT_DIR/sprint-prd.md" \
    '.artifacts
     | map(objects | select(
         .type == "git_artifact"
         and .kind == "planner_prd"
         and .verification_status == "verified"
         and .repo == "perfectuser21/zenithjoy-workspace"
         and .branch == $branch
         and .head_sha == $sha
         and .path == $path
       ))
     | length == 1' \
    "$result" >/dev/null
done

if HARNESS_NODE=planner \
  CECELIA_TASK_ID="$TASK_ID" \
  SPRINT_DIR="$SPRINT_DIR" \
  PLANNER_BRANCH='cp-harness-prd-wrongid0-a3' \
  WORKTREE_PATH="$WORKSPACE" \
  HARNESS_TASK_BUNDLE_FILE="$TASK_BUNDLE" \
    finalize_planner_output "$PROVIDER_RESULT" >/dev/null 2>&1; then
  echo "planner finalizer accepted a branch for another task" >&2
  exit 1
fi

if HARNESS_NODE=planner \
  CECELIA_TASK_ID="$TASK_ID" \
  SPRINT_DIR="$SPRINT_DIR" \
  PLANNER_BRANCH='cp-harness-prd-aaaaaaaa-r33333333-a2' \
  WORKTREE_PATH="$WORKSPACE" \
  HARNESS_TASK_BUNDLE_FILE="$WRONG_RUN_BUNDLE" \
    finalize_planner_output "$PROVIDER_RESULT" >/dev/null 2>&1; then
  echo "planner finalizer accepted a branch for another run" >&2
  exit 1
fi

rm "$WORKSPACE/$SPRINT_DIR/sprint-prd.md"
if HARNESS_NODE=planner \
  CECELIA_TASK_ID="$TASK_ID" \
  SPRINT_DIR="$SPRINT_DIR" \
  PLANNER_BRANCH='cp-harness-prd-aaaaaaaa-r11111111-a3' \
  WORKTREE_PATH="$WORKSPACE" \
  HARNESS_TASK_BUNDLE_FILE="$TASK_BUNDLE" \
    finalize_planner_output "$PROVIDER_RESULT" >/dev/null 2>&1; then
  echo "planner finalizer accepted a missing sprint-prd.md" >&2
  exit 1
fi

echo "entrypoint planner finalizer tests passed"
