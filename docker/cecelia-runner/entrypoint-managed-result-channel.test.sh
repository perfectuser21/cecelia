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

# Managed evidence is not authoritative until every provider descendant is
# frozen and reaped. This test launches a real background process and requires
# the production helper (in bounded test mode) to kill it before returning.
sleep 30 &
ROGUE_PROVIDER_PID=$!
CECELIA_DRAIN_TEST_MODE=1 managed_drain_provider_descendants
if kill -0 "$ROGUE_PROVIDER_PID" 2>/dev/null; then
  echo 'managed descendant drain left a provider background process alive' >&2
  kill -KILL "$ROGUE_PROVIDER_PID" 2>/dev/null || true
  exit 1
fi
wait "$ROGUE_PROVIDER_PID" 2>/dev/null || true

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
AUTHORITY_FILE="$RUNTIME_DIR/github-read-authority.json"
printf '%s' '{"schema_version":"github-read-authority/v1"}' > "$AUTHORITY_FILE"
chmod 600 "$AUTHORITY_FILE"
HARNESS_GITHUB_READ_AUTHORITY_FILE="$AUTHORITY_FILE"
configure_managed_bundle_runtime
[[ "$PR_BRANCH" == 'cp-result-channel' ]]
[[ "$PR_HEAD_SHA" == '0123456789abcdef0123456789abcdef01234567' ]]
[[ "$HARNESS_GITHUB_READ_AUTHORITY_FILE" == "$AUTHORITY_FILE" ]]
rm -f "$AUTHORITY_FILE"
if configure_managed_bundle_runtime; then
  echo 'evaluator accepted a missing Worker GitHub authority file' >&2
  exit 1
fi

printf '%s' \
  '{"task_bundle":{"role":"generator","skill":{"name":"harness-generator"},"expected_output":"harness-result/generator-v1","inputs":{"sprint_dir":"sprints/r7","attempt_kind":"initial","github_mutation_policy":{"version":"github-mutation/v1","repo":"perfectuser21/cecelia","branch":"cp-result-channel","base_sha":"0123456789abcdef0123456789abcdef01234567","expected_remote_sha":null,"operation":"push-and-create-draft","pr_base":"main","pr_title":"bounded title","pr_body":"bounded body","allowed_paths":["packages/"]}}}}' \
  > "$BUNDLE_FILE"
configure_managed_bundle_runtime
[[ "$HARNESS_ATTEMPT_KIND" == 'initial' ]]
[[ "$HARNESS_GITHUB_MUTATION_OPERATION" == 'push-and-create-draft' ]]
[[ "$HARNESS_GITHUB_MUTATION_BRANCH" == 'cp-result-channel' ]]

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

PROVIDER_RESULT="$RUNTIME_DIR/$ATTEMPT_ID.provider.json"
printf '%s' '{"status":"completed"}' > "$NORMALIZED_RESULT_FILE"
HARNESS_NODE=generator
stage_managed_github_mutation_provider_result "$NORMALIZED_RESULT_FILE"
[[ "$(cat "$PROVIDER_RESULT")" == '{"status":"completed"}' ]]
PROVIDER_RESULT_MODE="$(
  stat -f '%Lp' "$PROVIDER_RESULT" 2>/dev/null \
    || stat -c '%a' "$PROVIDER_RESULT"
)"
[[ "$PROVIDER_RESULT_MODE" == '600' ]]
if stage_managed_github_mutation_provider_result "$NORMALIZED_RESULT_FILE"; then
  echo 'managed mutation provider evidence overwrote an existing target' >&2
  exit 1
fi

PROVIDER_SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"
grep -q 'validate_managed_result_channel' <<<"$PROVIDER_SECTION"
grep -q 'finalize_managed_result "\$NORMALIZED_RESULT_FILE"' <<<"$PROVIDER_SECTION"
grep -q 'stage_managed_github_mutation_provider_result "\$NORMALIZED_RESULT_FILE"' <<<"$PROVIDER_SECTION"
grep -q '! managed_result_channel_active.*HARNESS_LEASE_OWNER' <<<"$PROVIDER_SECTION"
grep -q 'write_managed_provider_session "\$provider_session_id"' <<<"$PROVIDER_SECTION"
grep -q 'write_managed_provider_session "\$live_session"' <<<"$PROVIDER_SECTION"
grep -q 'configure_managed_bundle_runtime' <<<"$PROVIDER_SECTION"
grep -q 'unset HARNESS_CALLBACK_TOKEN HARNESS_CALLBACK_URL' <<<"$MANAGED_SECTION"
grep -q 'export BRAIN_TASK_BUNDLE_SHA256=' <<<"$MANAGED_SECTION"
grep -q 'write_managed_canary_result' <<<"$MANAGED_SECTION"
grep -B2 'gh auth setup-git' "$ENTRYPOINT" \
  | grep -q 'BRAIN_RESULT_CHANNEL_VERSION+x.*!=.*x'

# The legacy proposer transport effect writes /workspace/.brain-result.json.
# Managed mode must skip that function completely.
grep -A6 'if ! managed_result_channel_active; then' <<<"$PROVIDER_SECTION" \
  | grep -q 'finalize_proposer_output'

# Direct canary must terminate before every provider command branch, and the
# same exact result is independent of the selected provider name.
CANARY_LINE="$(grep -n 'write_managed_canary_result' <<<"$PROVIDER_SECTION" | head -n1 | cut -d: -f1)"
CODEX_LINE="$(grep -n 'if \[\[ "\$provider" == "codex" \]\]' <<<"$PROVIDER_SECTION" | head -n1 | cut -d: -f1)"
CLAUDE_LINE="$(grep -n 'elif \[\[ "\$provider" == "claude" \]\]' <<<"$PROVIDER_SECTION" | head -n1 | cut -d: -f1)"
GROK_LINE="$(grep -n 'elif \[\[ "\$provider" == "grok" \]\]' <<<"$PROVIDER_SECTION" | head -n1 | cut -d: -f1)"
(( CANARY_LINE < CODEX_LINE && CANARY_LINE < CLAUDE_LINE && CANARY_LINE < GROK_LINE ))
grep -q 'managed_drain_provider_descendants' <<<"$PROVIDER_SECTION"

# Execute the real provider-contract function with managed canary seams. All
# three requested provider targets must take the runner-owned canary exit before
# any provider binary is invoked.
eval "$PROVIDER_SECTION"
CANARY_TRACE="$(mktemp)"
managed_result_channel_active() { return 0; }
validate_managed_result_channel() { return 0; }
configure_managed_bundle_runtime() { export HARNESS_CANARY=true; }
write_managed_canary_result() {
  printf '%s\n' "$CECELIA_EXECUTOR" >> "$CANARY_TRACE"
}
codex() { printf 'provider-called:codex\n' >> "$CANARY_TRACE"; return 97; }
claude() { printf 'provider-called:claude\n' >> "$CANARY_TRACE"; return 97; }
grok() { printf 'provider-called:grok\n' >> "$CANARY_TRACE"; return 97; }
HARNESS_ATTEMPT_ID="$ATTEMPT_ID"
HARNESS_NODE=reporter
for CECELIA_EXECUTOR in codex claude grok; do
  run_provider_contract
done
[[ "$(cat "$CANARY_TRACE")" == $'codex\nclaude\ngrok' ]] || {
  echo 'managed canary invoked a provider or diverged across targets' >&2
  exit 1
}
rm -f "$CANARY_TRACE"

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

rm -f "$RESULT_FILE" "$PROVIDER_RESULT" "$NORMALIZED_RESULT_FILE" "$BUNDLE_FILE" "$AUTHORITY_FILE"
rm -rf "$FAKE_BIN"
echo 'managed result channel entrypoint: PASS'
