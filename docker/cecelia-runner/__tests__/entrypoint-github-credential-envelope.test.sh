#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

github_block="$(
  sed -n \
    '/^# github-credential-envelope:start$/,/^# github-credential-envelope:end$/p' \
    "$ENTRYPOINT"
)"
redaction_block="$(
  sed -n \
    '/^# provider-output-redaction:start$/,/^# provider-output-redaction:end$/p' \
    "$ENTRYPOINT"
)"

if [[ -z "$github_block" ]]; then
  echo "missing GitHub credential envelope implementation" >&2
  exit 1
fi
if [[ -z "$redaction_block" ]]; then
  echo "missing provider output redaction implementation" >&2
  exit 1
fi

eval "$github_block"
eval "$redaction_block"
type prepare_github_credential >/dev/null 2>&1 || {
  echo "missing prepare_github_credential function" >&2
  exit 1
}

file_mode() {
  local file="$1"
  if stat -f '%Lp' "$file" >/dev/null 2>&1; then
    stat -f '%Lp' "$file"
  else
    stat -c '%a' "$file"
  fi
}

GH_CALLS="$TEST_ROOT/gh-calls"
gh() {
  printf '%s\n' "$*" >> "$GH_CALLS"
  if [[ "$1 $2" == "auth login" ]]; then
    local token=""
    IFS= read -r token
    mkdir -p "$GH_CONFIG_DIR"
    printf '%s\n' \
      'github.com:' \
      "    oauth_token: $token" \
      '    git_protocol: https' \
      > "$GH_CONFIG_DIR/hosts.yml"
    return 0
  fi
  return 1
}

TOKEN='github_pat_attempt_scoped_test_token'
SOURCE="$TEST_ROOT/github-token.fifo"
GH_HOME="$TEST_ROOT/gh-config"
printf '%s\n' "$TOKEN" > "$SOURCE"
export CECELIA_GITHUB_CREDENTIAL_REF=44444444-4444-4444-8444-444444444444
export CECELIA_GITHUB_CREDENTIAL_FIFO="$SOURCE"

prepare_github_credential "$GH_HOME"

test "$GH_CONFIG_DIR" = "$GH_HOME"
test -f "$GH_HOME/hosts.yml"
test "$(file_mode "$GH_HOME/hosts.yml")" = "600"
grep -q "$TOKEN" "$GH_HOME/hosts.yml"
if grep -q "$TOKEN" "$GH_CALLS"; then
  echo "GitHub token leaked into gh argv" >&2
  exit 1
fi
test -z "${CECELIA_GITHUB_CREDENTIAL_FIFO:-}"

REDACTED_OUTPUT="$(
  unset CECELIA_EXECUTOR
  printf 'provider accidentally printed %s\n' "$TOKEN" \
    | redact_provider_credential_text
)"
if [[ "$REDACTED_OUTPUT" == *"$TOKEN"* ]]; then
  echo "GitHub token leaked through provider output redaction" >&2
  exit 1
fi
if [[ "$REDACTED_OUTPUT" != *'***REDACTED***'* ]]; then
  echo "provider output redaction did not preserve a redaction marker" >&2
  exit 1
fi

printf '%s\n' \
  'github.com:' \
  '    oauth_token: attacker_replaced_hosts_token' \
  '    git_protocol: https' \
  > "$GH_HOME/hosts.yml"
MUTATION_OUTPUT="$(
  unset CECELIA_EXECUTOR
  printf 'provider printed the original %s after mutating hosts\n' "$TOKEN" \
    | redact_provider_credential_text
)"
if [[ "$MUTATION_OUTPUT" == *"$TOKEN"* ]]; then
  echo "GitHub token redaction trusted provider-mutable hosts.yml" >&2
  exit 1
fi

provider_contract="$(
  sed -n '/^run_provider_contract() {$/,/^# provider-neutral:end$/p' "$ENTRYPOINT"
)"
if grep -Fq '| tee "$STDOUT_FILE"' <<< "$provider_contract"; then
  echo "provider contract still persists unredacted output" >&2
  exit 1
fi

LOGIN_LINE="$(grep -n 'if ! prepare_github_credential' "$ENTRYPOINT" | head -1 | cut -d: -f1)"
SETUP_LINE="$(grep -n 'gh auth setup-git' "$ENTRYPOINT" | head -1 | cut -d: -f1)"
if [[ -z "$LOGIN_LINE" || -z "$SETUP_LINE" || "$LOGIN_LINE" -ge "$SETUP_LINE" ]]; then
  echo "GitHub FIFO login does not precede gh auth setup-git" >&2
  exit 1
fi

export CECELIA_GITHUB_CREDENTIAL_REF=invalid-ref
export CECELIA_GITHUB_CREDENTIAL_FIFO="$SOURCE"
if prepare_github_credential "$TEST_ROOT/invalid-gh-config" >/dev/null 2>&1; then
  echo "invalid GitHub credential ref was accepted" >&2
  exit 1
fi

echo "entrypoint GitHub CredentialEnvelope tests passed"
