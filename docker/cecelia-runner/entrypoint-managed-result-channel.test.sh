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
printf '%s' \
  '{"task_bundle":{"role":"reporter","skill":null,"expected_output":"harness-result/canary-v1","inputs":{"sprint_dir":"sprints/canary"}}}' \
  > "$BUNDLE_FILE"
BRAIN_RESULT_CHANNEL_VERSION='attempt-result-file/v1'
BRAIN_RESULT_FILE="$RESULT_FILE"
BRAIN_RESULT_MAX_BYTES='1048576'
HARNESS_ATTEMPT_ID="$ATTEMPT_ID"
HARNESS_TASK_BUNDLE_FILE="$BUNDLE_FILE"
validate_managed_result_channel
configure_managed_bundle_runtime
[[ "$HARNESS_CANARY" == 'true' ]] || {
  echo 'canary isolation was not derived from the frozen TaskBundle' >&2
  exit 1
}
[[ "$SPRINT_DIR" == 'sprints/canary' && "$WORKSPACE_PATH" == '/workspace' ]] || {
  echo 'shared role runtime was not derived from the frozen TaskBundle' >&2
  exit 1
}

# Fleet does not inject legacy/local role convenience variables. Managed mode
# must derive their exact equivalents from the immutable TaskBundle so Skills
# behave identically on local and Fleet transports.
printf '%s' \
  '{"task_bundle":{"role":"proposer","skill":{"name":"harness-proposer"},"expected_output":"harness-result/proposer-v1","inputs":{"sprint_dir":"sprints/r7","contract_round":7,"propose_branch":"cp-harness-propose-r7-22222222-a9","contract_branch":"cp-harness-propose-r6-22222222-a8"}}}' \
  > "$BUNDLE_FILE"
configure_managed_bundle_runtime
[[ "$HARNESS_CANARY" == 'false' ]]
[[ "$SPRINT_DIR" == 'sprints/r7' ]]
[[ "$PROPOSE_ROUND" == '7' ]]
[[ "$PROPOSE_BRANCH" == 'cp-harness-propose-r7-22222222-a9' ]]
[[ "$CONTRACT_BRANCH" == 'cp-harness-propose-r6-22222222-a8' ]]

printf '%s' \
  '{"task_bundle":{"role":"evaluator","skill":{"name":"harness-evaluator"},"expected_output":"harness-result/evaluator-v1","inputs":{"sprint_dir":"sprints/r7","pr_branch":"cp-result-channel","pr_head_sha":"0123456789abcdef0123456789abcdef01234567"}}}' \
  > "$BUNDLE_FILE"
configure_managed_bundle_runtime
[[ "$PR_BRANCH" == 'cp-result-channel' ]]
[[ "$PR_HEAD_SHA" == '0123456789abcdef0123456789abcdef01234567' ]]

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
PATH="$FAKE_BIN:$PATH" write_managed_provider_session 'live-session-id'
[[ "$(sed -n '1p' "$TRACE_FILE")" == '/usr/local/bin/result-channel-driver.cjs' ]]
[[ "$(sed -n '2p' "$TRACE_FILE")" == '--provider-session' ]]
[[ "$(sed -n '3p' "$TRACE_FILE")" == 'live-session-id' ]]

PROVIDER_SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"
grep -q 'validate_managed_result_channel' <<<"$PROVIDER_SECTION"
grep -q 'finalize_managed_result "\$NORMALIZED_RESULT_FILE"' <<<"$PROVIDER_SECTION"
grep -q '! managed_result_channel_active.*HARNESS_LEASE_OWNER' <<<"$PROVIDER_SECTION"
grep -q 'write_managed_provider_session "\$provider_session_id"' <<<"$PROVIDER_SECTION"
grep -q 'write_managed_provider_session "\$live_session"' <<<"$PROVIDER_SECTION"
grep -q 'configure_managed_bundle_runtime' <<<"$PROVIDER_SECTION"
grep -q 'unset HARNESS_CALLBACK_TOKEN HARNESS_CALLBACK_URL' <<<"$MANAGED_SECTION"
grep -q 'export BRAIN_TASK_BUNDLE_SHA256=' <<<"$MANAGED_SECTION"

# The legacy proposer transport effect writes /workspace/.brain-result.json.
# Managed mode must skip that function completely.
grep -A6 'if ! managed_result_channel_active; then' <<<"$PROVIDER_SECTION" \
  | grep -q 'finalize_proposer_output'

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
