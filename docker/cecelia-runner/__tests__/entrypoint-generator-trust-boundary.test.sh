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

echo 'generator trust boundary PASS'
