#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

evidence_block="$(
  sed -n \
    '/^# evaluator-evidence-boundary:start$/,/^# evaluator-evidence-boundary:end$/p' \
    "$ENTRYPOINT"
)"
[[ -n "$evidence_block" ]] || {
  echo "missing evaluator evidence boundary implementation" >&2
  exit 1
}

eval "$evidence_block"
type prepare_evaluator_evidence_capsule >/dev/null 2>&1
type destroy_untrusted_provider_github_credential >/dev/null 2>&1
type verify_evaluator_evidence_capsule >/dev/null 2>&1
type seal_evaluator_evidence_capsule >/dev/null 2>&1
type prepare_evaluator_provider_identity >/dev/null 2>&1

GH_HOME="$TEST_ROOT/gh"
mkdir -p "$GH_HOME"
printf 'github.com:\n  oauth_token: never-provider-visible\n' > "$GH_HOME/hosts.yml"
export GH_CONFIG_DIR="$GH_HOME"
export CECELIA_GITHUB_CREDENTIAL_REF=44444444-4444-4444-8444-444444444444
export CECELIA_GITHUB_CREDENTIAL_FIFO="$TEST_ROOT/token.fifo"
export GITHUB_CREDENTIAL_SECRET=never-provider-visible

TASK_BUNDLE="$TEST_ROOT/task-bundle.json"
printf '%s\n' '{"task_bundle":{"role":"evaluator","inputs":{"github_evidence_request":{"contract_version":"github-evidence-request/v1"}}}}' > "$TASK_BUNDLE"
export HARNESS_TASK_BUNDLE_FILE="$TASK_BUNDLE"
export HARNESS_ATTEMPT_ID=22222222-2222-4222-8222-222222222222

FAKE_PREFLIGHT="$TEST_ROOT/preflight"
cat > "$FAKE_PREFLIGHT" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "collect" ]]; then
  test "$2" = "--bundle"
  test "$4" = "--capsule"
  mkdir -p "$5"
  printf '{}\n' > "$5/manifest.json"
  printf '%064d\n' 0
elif [[ "$1" == "verify" ]]; then
  test -f "$3/manifest.json"
  test "$5" = "$(printf '%064d' 0)"
fi
SCRIPT
chmod +x "$FAKE_PREFLIGHT"
export CECELIA_EVIDENCE_PREFLIGHT_BIN="$FAKE_PREFLIGHT"

prepare_evaluator_evidence_capsule
test "$EVALUATOR_EVIDENCE_MANIFEST_DIGEST" = "$(printf '%064d' 0)"
test -f "$HARNESS_EVIDENCE_CAPSULE_DIR/manifest.json"

destroy_untrusted_provider_github_credential
test ! -e "$GH_HOME/hosts.yml"
test -z "${CECELIA_GITHUB_CREDENTIAL_FIFO:-}"
test -z "${GITHUB_CREDENTIAL_SECRET:-}"
test "${GITHUB_CREDENTIAL_DESTROYED:-}" = true
verify_evaluator_evidence_capsule

grep -q 'chown -R root:root -- "$HARNESS_EVIDENCE_CAPSULE_DIR"' <<< "$evidence_block"
grep -q 'chmod 0555' <<< "$evidence_block"
grep -q 'chmod 0444' <<< "$evidence_block"
grep -q 'chmod 0711 -- "$capsule_parent"' <<< "$evidence_block"
grep -q -- '--no-new-privs' <<< "$evidence_block"
grep -q -- '--bounding-set=-all' <<< "$evidence_block"

# Playwright 的系统依赖会改变 Debian 动态分配的 system UID。Evaluator 只需确认
# Provider 用户真实存在且不是 root，不能把某次镜像里的 UID（历史上是 999）写死。
grep -q 'provider_uid="$(id -u cecelia 2>/dev/null)"' <<< "$evidence_block"
if grep -Eq 'UID 999|!= "999"' <<< "$evidence_block"; then
  echo "Evaluator Provider identity still hard-codes UID 999" >&2
  exit 1
fi

if ! grep -q '"${PROVIDER_IDENTITY_PREFIX\[@\]}"' "$ENTRYPOINT"; then
  echo "Provider commands do not cross the evaluator UID boundary" >&2
  exit 1
fi

PREPARE_LINE="$(grep -n '^  prepare_evaluator_evidence_capsule$' "$ENTRYPOINT" | head -1 | cut -d: -f1)"
DESTROY_LINE="$(grep -n '^destroy_untrusted_provider_github_credential$' "$ENTRYPOINT" | head -1 | cut -d: -f1)"
PROVIDER_LINE="$(grep -n '^run_provider_contract() {' "$ENTRYPOINT" | head -1 | cut -d: -f1)"
if [[ -z "$PREPARE_LINE" || -z "$DESTROY_LINE" || -z "$PROVIDER_LINE" \
    || "$PREPARE_LINE" -ge "$PROVIDER_LINE" || "$DESTROY_LINE" -ge "$PROVIDER_LINE" ]]; then
  echo "Evaluator credentials are not destroyed before Provider contract" >&2
  exit 1
fi

echo "entrypoint evaluator evidence boundary tests passed"
