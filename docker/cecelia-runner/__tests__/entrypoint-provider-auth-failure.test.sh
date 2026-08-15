#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"

eval "$SECTION"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

cat > "$test_root/claude-auth.jsonl" <<'JSON'
{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","terminal_reason":"completed"}
JSON

normalize_provider_failure \
  "$test_root/auth-result.json" \
  11111111-1111-4111-8111-111111111111 \
  claude \
  22222222-2222-4222-8222-222222222222 \
  '' \
  false \
  1 \
  "$test_root/claude-auth.jsonl"

jq -e '
  .status == "failed"
  and .error.code == "provider_unavailable"
  and .summary == "provider authentication unavailable"
' "$test_root/auth-result.json" >/dev/null || {
  echo 'runner did not classify the structured Claude auth failure as provider unavailable' >&2
  exit 1
}

cat > "$test_root/ordinary.jsonl" <<'JSON'
{"type":"result","subtype":"success","is_error":false,"result":"A test fixture mentions Not logged in as ordinary prose."}
JSON

normalize_provider_failure \
  "$test_root/ordinary-result.json" \
  33333333-3333-4333-8333-333333333333 \
  claude \
  44444444-4444-4444-8444-444444444444 \
  '' \
  false \
  1 \
  "$test_root/ordinary.jsonl"

jq -e '
  .error.code == "provider_exit"
  and .summary == "provider process failed"
' "$test_root/ordinary-result.json" >/dev/null || {
  echo 'runner trusted an ordinary Provider message as an authentication failure' >&2
  exit 1
}

echo 'provider auth failure classification: PASS'
