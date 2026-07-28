#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$HERE/entrypoint.sh"
DOCKERFILE="$HERE/Dockerfile"

MANAGED_SECTION="$(
  sed -n '/managed-result-channel:start/,/managed-result-channel:end/p' "$ENTRYPOINT"
)"
[[ -n "$MANAGED_SECTION" ]] || {
  echo 'missing managed result channel section' >&2
  exit 1
}
eval "$MANAGED_SECTION"

# Presence, not truthiness, selects Fleet managed mode. Empty and unknown values
# still select managed and must then fail closed during validation.
unset BRAIN_RESULT_CHANNEL_VERSION
managed_result_channel_active && {
  echo 'unset channel version selected managed mode' >&2
  exit 1
}
BRAIN_RESULT_CHANNEL_VERSION=
managed_result_channel_active || {
  echo 'empty present channel version did not select managed mode' >&2
  exit 1
}
if validate_managed_result_channel; then
  echo 'empty managed channel version passed validation' >&2
  exit 1
fi

ATTEMPT_ID='22222222-2222-4222-8222-222222222222'
RUNTIME_DIR='/tmp/cecelia-prompts'
mkdir -p "$RUNTIME_DIR"
RESULT_FILE="$RUNTIME_DIR/$ATTEMPT_ID.result.json"
printf '%s' '{}' > "$RESULT_FILE"
chmod 600 "$RESULT_FILE"
BUNDLE_FILE="$(mktemp)"
printf '%s' '{"task_bundle":{}}' > "$BUNDLE_FILE"
BRAIN_RESULT_CHANNEL_VERSION='attempt-result-file/v1'
BRAIN_RESULT_FILE="$RESULT_FILE"
BRAIN_RESULT_MAX_BYTES='1048576'
HARNESS_ATTEMPT_ID="$ATTEMPT_ID"
HARNESS_TASK_BUNDLE_FILE="$BUNDLE_FILE"
validate_managed_result_channel

# The production seam must invoke only the fixed, image-owned driver with the
# fixed attempt-owned normalized provider path. No callback credential exists.
FAKE_BIN="$(mktemp -d)"
TRACE_FILE="$FAKE_BIN/node.args"
cat > "$FAKE_BIN/node" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$TRACE_FILE"
SH
chmod +x "$FAKE_BIN/node"
export TRACE_FILE
unset HARNESS_CALLBACK_TOKEN HARNESS_CALLBACK_URL
NORMALIZED_RESULT_FILE="/tmp/harness-result-$ATTEMPT_ID.normalized.json"
PATH="$FAKE_BIN:$PATH" finalize_managed_result "$NORMALIZED_RESULT_FILE"
[[ "$(sed -n '1p' "$TRACE_FILE")" == '/usr/local/bin/result-channel-driver.cjs' ]]
[[ "$(sed -n '2p' "$TRACE_FILE")" == '--provider-result' ]]
[[ "$(sed -n '3p' "$TRACE_FILE")" == "$NORMALIZED_RESULT_FILE" ]]

PROVIDER_SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"
grep -q 'validate_managed_result_channel' <<<"$PROVIDER_SECTION"
grep -q 'finalize_managed_result "\$NORMALIZED_RESULT_FILE"' <<<"$PROVIDER_SECTION"
grep -q '! managed_result_channel_active.*HARNESS_LEASE_OWNER' <<<"$PROVIDER_SECTION"
grep -q '! managed_result_channel_active.*persist_provider_session' <<<"$PROVIDER_SECTION"
grep -q 'write_managed_provider_session "\$provider_session_id"' <<<"$PROVIDER_SECTION"
grep -q 'write_managed_provider_session "\$live_session"' <<<"$PROVIDER_SECTION"

# Once provider execution returns, managed mode exits before callback body/URL,
# callback token, retry loop, or any legacy callback HTTP can be evaluated.
MANAGED_EXIT_LINE="$(
  grep -n 'managed-result-channel:terminal-exit' "$ENTRYPOINT" | cut -d: -f1
)"
CALLBACK_TOKEN_LINE="$(
  grep -n 'Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}' "$ENTRYPOINT" \
    | tail -n 1 \
    | cut -d: -f1
)"
[[ -n "$MANAGED_EXIT_LINE" && -n "$CALLBACK_TOKEN_LINE" ]]
(( MANAGED_EXIT_LINE < CALLBACK_TOKEN_LINE ))
sed -n "${MANAGED_EXIT_LINE},${CALLBACK_TOKEN_LINE}p" "$ENTRYPOINT" \
  | grep -q 'exit "\$EXIT_CODE"'

grep -q 'COPY result-channel-finalizer.cjs /usr/local/bin/result-channel-finalizer.cjs' \
  "$DOCKERFILE"
grep -q 'COPY result-channel-driver.cjs /usr/local/bin/result-channel-driver.cjs' \
  "$DOCKERFILE"
grep -q 'chmod 0755 /usr/local/bin/result-channel-finalizer.cjs' "$DOCKERFILE"
grep -q 'chmod 0755 /usr/local/bin/result-channel-driver.cjs' "$DOCKERFILE"

rm -f "$RESULT_FILE" "$BUNDLE_FILE"
rm -rf "$FAKE_BIN"
echo 'managed result channel entrypoint: PASS'
