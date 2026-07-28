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
  echo "missing provider credential envelope implementation" >&2
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

assert_provider_credential() {
  local provider="$1"
  local payload="$2"
  local relative_file="$3"
  local home="$TEST_ROOT/$provider-home"
  local source="$TEST_ROOT/$provider-envelope.json"

  printf '%s' "$payload" > "$source"
  export CECELIA_CREDENTIAL_FIFO="$source"
  export CECELIA_CREDENTIAL_REF=33333333-3333-4333-8333-333333333333

  prepare_provider_credential "$provider" "$home"

  local credential_file="$home/$relative_file"
  test "$CREDENTIAL_FILE" = "$credential_file"
  test "$(cat "$credential_file")" = "$payload"
  test "$(file_mode "$credential_file")" = "600"
  test "$CREDENTIAL_COPY_MUTATED" = "false"
  if [[ -n "${CECELIA_CREDENTIAL_FIFO:-}" ]]; then
    echo "credential FIFO remained in the provider environment" >&2
    exit 1
  fi

  local secret
  secret="$(jq -r '.. | strings | select(length >= 8)' "$credential_file" | head -n 1)"
  test "$(
    printf 'provider emitted %s\n' "$secret" | redact_provider_credential_text
  )" = 'provider emitted ***REDACTED***'

  chmod 644 "$credential_file"
  record_provider_credential_mutation
  test "$CREDENTIAL_COPY_MUTATED" = "true"
}

assert_provider_credential \
  codex \
  '{"tokens":{"access_token":"codex-access-secret","refresh_token":"codex-refresh-secret"}}' \
  auth.json
test "$CODEX_HOME" = "$TEST_ROOT/codex-home"

assert_provider_credential \
  claude \
  '{"claudeAiOauth":{"accessToken":"claude-access-secret","refreshToken":"claude-refresh-secret"}}' \
  .credentials.json
test "$CLAUDE_CONFIG_DIR" = "$TEST_ROOT/claude-home"

assert_provider_credential \
  grok \
  '{"https://auth.x.ai::principal":{"key":"grok-access-secret","refresh_token":"grok-refresh-secret"}}' \
  auth.json
test "$GROK_HOME" = "$TEST_ROOT/grok-home"

invalid_source="$TEST_ROOT/invalid-grok.json"
printf '%s' '{"https://auth.x.ai::principal":{"key":"missing-refresh"}}' > "$invalid_source"
export CECELIA_CREDENTIAL_FIFO="$invalid_source"
if prepare_provider_credential grok "$TEST_ROOT/invalid-grok-home" >/dev/null 2>&1; then
  echo "invalid Grok auth payload was accepted" >&2
  exit 1
fi

echo "entrypoint provider CredentialEnvelope tests passed"
