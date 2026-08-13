#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
SOURCE="$ROOT/docker/cecelia-runner/entrypoint.sh"
DOCKER_EXECUTOR="$ROOT/packages/brain/src/docker-executor.js"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

detectors="$(sed -n '/^is_evaluator_task_bundle()/,/^prepare_evaluator_evidence_capsule()/p' "$SOURCE" | sed '$d')"
[[ -n "$detectors" ]] || { echo 'missing task bundle detectors' >&2; exit 1; }
eval "$detectors" || { echo 'task bundle detector extraction failed' >&2; exit 1; }

printf '%s\n' '{"task_bundle":{"role":"generator"}}' > "$TEST_ROOT/generator.json"
export HARNESS_TASK_BUNDLE_FILE="$TEST_ROOT/generator.json"
is_generator_task_bundle || {
  echo 'real prompt envelope did not activate generator trust boundary' >&2
  exit 1
}
is_untrusted_provider_task_bundle || {
  echo 'generator was not classified as untrusted provider' >&2
  exit 1
}

grep -q 'remote.origin.pushurl' "$SOURCE"
grep -q 'setpriv' "$SOURCE"
for key in BRAIN_URL HARNESS_CALLBACK_URL HARNESS_CALLBACK_TOKEN HARNESS_LEASE_OWNER HARNESS_LEASE_GENERATION GH_TOKEN GITHUB_TOKEN CECELIA_GITHUB_CREDENTIAL_REF CECELIA_GITHUB_CREDENTIAL_FIFO; do
  grep -q -- "-u $key" "$SOURCE"
done

NODE_ENV=test DB_NAME=cecelia_test node --input-type=module - "$DOCKER_EXECUTOR" <<'NODE'
const modulePath = process.argv[2];
const { buildDockerArgs } = await import(`file://${modulePath}`);
const { args } = buildDockerArgs({
  task: { id: 'generator-trust-test', task_type: 'harness_generator' },
  worktreePath: '/tmp/generator-trust-test',
  image: 'test-image',
  minimalHostMounts: true,
}, { homedir: '/tmp/empty-home', existsSyncFn: () => false });
const userIndex = args.indexOf('--user');
if (userIndex < 0 || args[userIndex + 1] !== 'root') {
  console.error('generator container does not start in trusted root stage before setpriv');
  process.exit(1);
}
process.exit(0);
NODE

publisher_block="$(
  sed -n '/^# generator-trusted-publisher:start$/,/^# generator-trusted-publisher:end$/p' "$SOURCE"
)"
[[ -n "$publisher_block" ]] || { echo 'missing generator trusted publisher' >&2; exit 1; }
eval "$publisher_block"
type finalize_generator_candidate >/dev/null
type publish_approved_generator_candidate >/dev/null

git init --bare "$TEST_ROOT/remote.git" >/dev/null
git init -b main "$TEST_ROOT/workspace" >/dev/null
git -C "$TEST_ROOT/workspace" config user.name 'Trusted Publisher Test'
git -C "$TEST_ROOT/workspace" config user.email publisher@example.invalid
git -C "$TEST_ROOT/workspace" config core.hooksPath /dev/null
printf 'base\n' > "$TEST_ROOT/workspace/base.txt"
git -C "$TEST_ROOT/workspace" add base.txt
git -C "$TEST_ROOT/workspace" commit -m base >/dev/null
BASE_SHA=$(git -C "$TEST_ROOT/workspace" rev-parse HEAD)
git -C "$TEST_ROOT/workspace" checkout -b cp-trusted-publisher >/dev/null
git -C "$TEST_ROOT/workspace" remote add origin "$TEST_ROOT/remote.git"
git -C "$TEST_ROOT/workspace" config remote.origin.pushurl \
  file:///nonexistent/harness-provider-push-disabled
printf 'change\n' > "$TEST_ROOT/workspace/change.txt"
git -C "$TEST_ROOT/workspace" add change.txt
git -C "$TEST_ROOT/workspace" commit -m 'feat: trusted publisher fixture' >/dev/null
HEAD_SHA=$(git -C "$TEST_ROOT/workspace" rev-parse HEAD)

cat > "$TEST_ROOT/generator.json" <<JSON
{"task_bundle":{"role":"generator","run_id":"11111111-1111-4111-8111-111111111111","attempt_id":"22222222-2222-4222-8222-222222222222","inputs":{"task_id":"33333333-3333-4333-8333-333333333333","workspace_spec":{"repo":"perfectuser21/cecelia","branch":"cp-trusted-publisher","base_sha":"$BASE_SHA"}}}}
JSON
printf '%s\n' '{"status":"completed","summary":"done","artifacts":[],"checks":[],"decision":null,"error":null,"case_file":null}' > "$TEST_ROOT/result.json"
mkdir -p "$TEST_ROOT/trusted-gh"
printf 'credential\n' > "$TEST_ROOT/trusted-gh/hosts.yml"
export HARNESS_TASK_BUNDLE_FILE="$TEST_ROOT/generator.json"
export WORKTREE_PATH="$TEST_ROOT/workspace"
TRUSTED_GITHUB_CONFIG_DIR="$TEST_ROOT/trusted-gh"
TRUSTED_PUBLISH_REMOTE_URL="$TEST_ROOT/remote.git"

if git -C "$TEST_ROOT/workspace" push origin HEAD:refs/heads/provider-must-not-publish \
    >/dev/null 2>&1; then
  echo 'untrusted Provider push unexpectedly succeeded' >&2
  exit 1
fi

gh() {
  if [[ "$1 $2" == 'auth setup-git' ]]; then return 0; fi
  if [[ "$1 $2" == 'pr view' ]]; then
    printf 'https://github.com/perfectuser21/cecelia/pull/999|%s\n' "$HEAD_SHA"
    return 0
  fi
  return 1
}

finalize_generator_candidate "$TEST_ROOT/result.json"
if git --git-dir "$TEST_ROOT/remote.git" rev-parse refs/heads/cp-trusted-publisher \
    >/dev/null 2>&1; then
  echo 'Generator finalized a remote ref before Judge' >&2
  exit 1
fi
jq -e --arg sha "$HEAD_SHA" '
  [.artifacts[] | select(.type == "git_candidate" and .verification_status == "verified"
    and .source_attempt_id == "22222222-2222-4222-8222-222222222222"
    and .head_sha == $sha)] | length == 1
' "$TEST_ROOT/result.json" >/dev/null

cat > "$TEST_ROOT/publisher.json" <<JSON
{"task_bundle":{"role":"publisher","run_id":"11111111-1111-4111-8111-111111111111","attempt_id":"44444444-4444-4444-8444-444444444444","inputs":{"task_id":"33333333-3333-4333-8333-333333333333","candidate":{"source_attempt_id":"22222222-2222-4222-8222-222222222222","repo":"perfectuser21/cecelia","branch":"cp-trusted-publisher","base_sha":"$BASE_SHA","head_sha":"$HEAD_SHA"},"judge_verdict":{"verdict":"PASS","pr_head_sha":"$HEAD_SHA"},"merge_fence":{"allowed":true,"head_sha":"$HEAD_SHA"},"workspace_spec":{"repo":"perfectuser21/cecelia","branch":"cp-trusted-publisher","base_sha":"$HEAD_SHA","expected_head_sha":"$HEAD_SHA"}}}}
JSON
printf '%s\n' '{"status":"completed","summary":"published","artifacts":[],"checks":[],"decision":null,"error":null,"case_file":null}' > "$TEST_ROOT/publisher-result.json"
export HARNESS_TASK_BUNDLE_FILE="$TEST_ROOT/publisher.json"
publish_approved_generator_candidate "$TEST_ROOT/publisher-result.json"
test "$(git --git-dir "$TEST_ROOT/remote.git" rev-parse refs/heads/cp-trusted-publisher)" = "$HEAD_SHA"
jq -e --arg sha "$HEAD_SHA" '
  [.artifacts[] | select(.type == "pull_request" and .verification_status == "verified"
    and .url == "https://github.com/perfectuser21/cecelia/pull/999" and .head_sha == $sha)] | length == 1
' "$TEST_ROOT/publisher-result.json" >/dev/null

# A Judge-approved Generator fix may advance an existing task branch. The
# trusted publisher must allow that exact fast-forward while still rejecting
# non-fast-forward replacement.
PREVIOUS_HEAD_SHA="$HEAD_SHA"
printf 'follow-up\n' > "$TEST_ROOT/workspace/follow-up.txt"
git -C "$TEST_ROOT/workspace" add follow-up.txt
git -C "$TEST_ROOT/workspace" commit -m 'fix: trusted publisher follow-up' >/dev/null
HEAD_SHA=$(git -C "$TEST_ROOT/workspace" rev-parse HEAD)
cat > "$TEST_ROOT/publisher.json" <<JSON
{"task_bundle":{"role":"publisher","run_id":"11111111-1111-4111-8111-111111111111","attempt_id":"55555555-5555-4555-8555-555555555555","inputs":{"task_id":"33333333-3333-4333-8333-333333333333","candidate":{"source_attempt_id":"22222222-2222-4222-8222-222222222222","repo":"perfectuser21/cecelia","branch":"cp-trusted-publisher","base_sha":"$PREVIOUS_HEAD_SHA","head_sha":"$HEAD_SHA"},"judge_verdict":{"verdict":"PASS","pr_head_sha":"$HEAD_SHA"},"merge_fence":{"allowed":true,"head_sha":"$HEAD_SHA"},"workspace_spec":{"repo":"perfectuser21/cecelia","branch":"cp-trusted-publisher","base_sha":"$HEAD_SHA","expected_head_sha":"$HEAD_SHA"}}}}
JSON
printf '%s\n' '{"status":"completed","summary":"published follow-up","artifacts":[],"checks":[],"decision":null,"error":null,"case_file":null}' > "$TEST_ROOT/publisher-result.json"
publish_approved_generator_candidate "$TEST_ROOT/publisher-result.json"
test "$(git --git-dir "$TEST_ROOT/remote.git" rev-parse refs/heads/cp-trusted-publisher)" = "$HEAD_SHA"

echo 'generator trust boundary PASS'
