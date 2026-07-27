#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

credential_block="$(
  sed -n \
    '/^# codex-credential-envelope:start$/,/^# codex-credential-envelope:end$/p' \
    "$ENTRYPOINT"
)"

if [[ -z "$credential_block" ]]; then
  echo "missing codex credential envelope implementation" >&2
  exit 1
fi

eval "$credential_block"

file_mode() {
  local file="$1"
  if stat -f '%Lp' "$file" >/dev/null 2>&1; then
    stat -f '%Lp' "$file"
  else
    stat -c '%a' "$file"
  fi
}

credential_source="$TEST_ROOT/envelope-auth.json"
codex_home="$TEST_ROOT/codex-home"
printf '%s' \
  '{"tokens":{"access_token":"credential-secret","refresh_token":"refresh-secret"}}' \
  > "$credential_source"

export CECELIA_EXECUTOR=codex
export HARNESS_ATTEMPT_ID=22222222-2222-4222-8222-222222222222
export CECELIA_CREDENTIAL_REF=33333333-3333-4333-8333-333333333333
export CECELIA_CREDENTIAL_FIFO="$credential_source"

prepare_codex_credential "$codex_home"

test "$CODEX_HOME" = "$codex_home"
test "$(cat "$codex_home/auth.json")" = \
  '{"tokens":{"access_token":"credential-secret","refresh_token":"refresh-secret"}}'
test "$(file_mode "$codex_home/auth.json")" = "600"
test "$CREDENTIAL_COPY_MUTATED" = "false"
test "$(
  printf '%s\n' \
    'provider said credential-secret and refresh-secret' \
    | redact_codex_credential_text
)" = 'provider said ***REDACTED*** and ***REDACTED***'

provider_result="$codex_home/provider-result.json"
printf '%s\n' \
  '{"summary":"credential-secret refresh-secret","status":"completed"}' \
  > "$provider_result"
redact_codex_credential_file "$provider_result"
grep -q '\*\*\*REDACTED\*\*\*' "$provider_result"
if grep -qE 'credential-secret|refresh-secret' "$provider_result"; then
  echo "credential bytes survived result redaction" >&2
  exit 1
fi

printf '\n' >> "$codex_home/auth.json"
record_codex_credential_mutation
test "$CREDENTIAL_COPY_MUTATED" = "true"

test "$(grep -c 'credential_ref' "$ENTRYPOINT")" -ge 2
test "$(grep -c 'credential_copy_mutated' "$ENTRYPOINT")" -ge 2

invalid_source="$TEST_ROOT/invalid-auth.json"
printf '%s' '{"tokens":{}}' > "$invalid_source"
export CECELIA_CREDENTIAL_FIFO="$invalid_source"
if prepare_codex_credential "$TEST_ROOT/invalid-home" >/dev/null 2>&1; then
  echo "invalid Codex auth payload was accepted" >&2
  exit 1
fi

echo "entrypoint Codex CredentialEnvelope tests passed"
