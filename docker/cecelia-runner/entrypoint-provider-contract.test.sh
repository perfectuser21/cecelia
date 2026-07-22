#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/entrypoint.sh"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"

[[ -n "$SECTION" ]] || { echo 'missing provider-neutral runner section' >&2; exit 1; }

grep -q 'HARNESS_TASK_BUNDLE_FILE:-\$PROMPT_FILE' <<<"$SECTION"
grep -q -- '--json' <<<"$SECTION"
grep -q -- '--output-schema' <<<"$SECTION"
grep -q -- '--output-last-message' <<<"$SECTION"
grep -q 'thread.started' <<<"$SECTION"
grep -q 'HARNESS_RESUME_SESSION_ID' <<<"$SECTION"
grep -q -- '--json-schema' <<<"$SECTION"
grep -q 'HARNESS_MODEL' <<<"$SECTION"
grep -q 'NORMALIZED_RESULT_FILE' <<<"$SECTION"
# The runner's provider-facing schema must emit decisions accepted by the Brain
# callback parser. A permissive object here caused real planner callbacks to 400.
grep -q '"required":\["outcome","reason"\]' <<<"$SECTION"
grep -q '/heartbeat' <<<"$SECTION"
grep -q 'HARNESS_LEASE_OWNER' <<<"$SECTION"
grep -q 'HARNESS_CALLBACK_TOKEN' <<<"$SECTION"
grep -q 'Authorization: Bearer' <<<"$SECTION"
grep -q 'provider_session_id:\$session' <<<"$SECTION"
grep -q -- '--session-id' <<<"$SECTION"
grep -q 'HARNESS_READ_ONLY' <<<"$SECTION"
grep -q -- '--sandbox read-only' <<<"$SECTION"
grep -q -- '--permission-mode plan' <<<"$SECTION"
grep -q 'provider" == "grok' <<<"$SECTION"
grep -q 'grok_args' <<<"$SECTION"
grep -q -- '--always-approve' <<<"$SECTION"
grep -q '@xai-official/grok' "$DOCKERFILE"

# The Kernel path may pass --model only under an explicit HARNESS_MODEL guard.
if grep -Eq -- '--model[[:space:]]+(sonnet|opus|haiku|gpt-|o[0-9])' <<<"$SECTION"; then
  echo 'provider-neutral runner hardcodes a model' >&2
  exit 1
fi

echo 'provider-neutral runner contract: PASS'
