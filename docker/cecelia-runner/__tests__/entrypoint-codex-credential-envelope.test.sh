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
  '{"tokens":{"access_token":"credential-secret","refresh_token":"refresh-secret"},"api_key":"api-secret-value","password":"password-secret-value"}' \
  > "$credential_source"

export CECELIA_EXECUTOR=codex
export HARNESS_ATTEMPT_ID=22222222-2222-4222-8222-222222222222
export CECELIA_CREDENTIAL_REF=33333333-3333-4333-8333-333333333333
export CECELIA_CREDENTIAL_FIFO="$credential_source"

prepare_codex_credential "$codex_home"

test "$CODEX_HOME" = "$codex_home"
test "$(cat "$codex_home/auth.json")" = \
  '{"tokens":{"access_token":"credential-secret","refresh_token":"refresh-secret"},"api_key":"api-secret-value","password":"password-secret-value"}'
test "$(file_mode "$codex_home/auth.json")" = "600"
test "$CREDENTIAL_COPY_MUTATED" = "false"
test "$(
  printf '%s\n' \
    'provider said credential-secret refresh-secret api-secret-value password-secret-value' \
    | redact_codex_credential_text
)" = 'provider said ***REDACTED*** ***REDACTED*** ***REDACTED*** ***REDACTED***'

provider_result="$codex_home/provider-result.json"
printf '%s\n' \
  '{"summary":"credential-secret refresh-secret api-secret-value password-secret-value","status":"completed"}' \
  > "$provider_result"
redact_codex_credential_file "$provider_result"
grep -q '\*\*\*REDACTED\*\*\*' "$provider_result"
if grep -qE 'credential-secret|refresh-secret|api-secret-value|password-secret-value' \
  "$provider_result"; then
  echo "credential bytes survived result redaction" >&2
  exit 1
fi

chmod 644 "$codex_home/auth.json"
record_codex_credential_mutation
test "$CREDENTIAL_COPY_MUTATED" = "true"
chmod 600 "$codex_home/auth.json"
record_codex_credential_mutation
test "$CREDENTIAL_COPY_MUTATED" = "false"

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

oversized_source="$TEST_ROOT/oversized-auth.json"
{
  printf '%s' '{"tokens":{"access_token":"credential-secret"},"padding":"'
  head -c 196609 /dev/zero | tr '\0' x
  printf '%s' '"}'
} > "$oversized_source"
export CECELIA_CREDENTIAL_FIFO="$oversized_source"
if prepare_codex_credential "$TEST_ROOT/oversized-home" >/dev/null 2>&1; then
  echo "oversized Codex auth payload was accepted" >&2
  exit 1
fi
test ! -e "$TEST_ROOT/oversized-home/auth.json"

bootstrap_failure_block="$(
  sed -n \
    '/^# provider-bootstrap-failure:start$/,/^# provider-bootstrap-failure:end$/p' \
    "$ENTRYPOINT"
)"
if [[ -z "$bootstrap_failure_block" ]]; then
  echo "missing provider bootstrap failure normalizer" >&2
  exit 1
fi
eval "$bootstrap_failure_block"

bootstrap_failure="$TEST_ROOT/bootstrap-failure.json"
write_provider_bootstrap_failure \
  "$bootstrap_failure" \
  "$HARNESS_ATTEMPT_ID" \
  codex \
  'Frozen baseline guard rejected' \
  frozen_baseline_guard_unavailable \
  'runner could not arm the frozen baseline lineage guard' \
  "$CECELIA_CREDENTIAL_REF" \
  false
jq -e \
  --arg credential_ref "$CECELIA_CREDENTIAL_REF" \
  '.status == "failed"
   and .error.code == "frozen_baseline_guard_unavailable"
   and .provider_metadata.credential_ref == $credential_ref
   and .provider_metadata.credential_copy_mutated == false
   and (.provider_metadata | keys | sort)
     == ["credential_copy_mutated", "credential_ref", "provider", "session_id"]' \
  "$bootstrap_failure" >/dev/null

echo "entrypoint Codex CredentialEnvelope tests passed"
