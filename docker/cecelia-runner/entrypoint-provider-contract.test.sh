#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/entrypoint.sh"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
EVALUATOR_SKILL="$SCRIPT_DIR/../../packages/workflows/skills/harness-evaluator/SKILL.md"
SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"
GROK_SECTION="$(sed -n '/elif \[\[ "$provider" == "grok" \]\]/,/^  else$/p' <<<"$SECTION")"

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

# Evaluator writes the authoritative mechanical evidence to .brain-result.json.
# The provider-facing summary may reduce checks to strings, so the runner must
# bridge the structured behavior_tests into the callback envelope before POST.
EVIDENCE_BRIDGE="$(sed -n '/evaluator-evidence-bridge:start/,/evaluator-evidence-bridge:end/p' "$ENTRYPOINT")"
[[ -n "$EVIDENCE_BRIDGE" ]] || { echo 'missing evaluator evidence bridge' >&2; exit 1; }
eval "$EVIDENCE_BRIDGE"
type prepare_evaluator_evidence >/dev/null 2>&1 || {
  echo 'missing evaluator evidence freshness snapshot' >&2
  exit 1
}
EVIDENCE_TMP="$(mktemp -d)"
trap 'rm -rf "$EVIDENCE_TMP"' EXIT
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["npm test passed"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-current CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" prepare_evaluator_evidence
cat > "$EVIDENCE_TMP/.brain-result.json" <<'JSON'
{"verdict":"PASS","task_id":"task-current","attempt_id":"attempt-current","behavior_tests":[{"command":"npm test","exit_code":0,"log_tail":"12 tests passed"}]}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-current CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == [{"command":"npm test","exit_code":0,"log_tail":"12 tests passed"}]' \
  "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'evaluator evidence bridge did not preserve structured behavior_tests' >&2
  exit 1
}

# A same-task result left by a previous evaluator attempt is not current evidence.
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["current provider summary"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
cat > "$EVIDENCE_TMP/.brain-result.json" <<'JSON'
{"verdict":"PASS","task_id":"task-current","attempt_id":"attempt-old","behavior_tests":[{"command":"stale test","exit_code":0,"log_tail":"old pass"}]}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-retry CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" prepare_evaluator_evidence
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-retry CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == ["current provider summary"]' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'evaluator evidence bridge reused stale same-task evidence' >&2
  exit 1
}

# Re-running the current evaluator may legitimately reproduce byte-identical
# evidence. A real rewrite must be distinguished from an untouched stale file.
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["current provider summary"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
cat > "$EVIDENCE_TMP/.brain-result.json" <<'JSON'
{"verdict":"PASS","task_id":"task-current","attempt_id":"attempt-identical","behavior_tests":[{"command":"same test","exit_code":0,"log_tail":"same pass"}]}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-identical CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" prepare_evaluator_evidence
cat > "$EVIDENCE_TMP/.brain-result.json" <<'JSON'
{"verdict":"PASS","task_id":"task-current","attempt_id":"attempt-identical","behavior_tests":[{"command":"same test","exit_code":0,"log_tail":"same pass"}]}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-identical CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == [{"command":"same test","exit_code":0,"log_tail":"same pass"}]' \
  "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'evaluator evidence bridge rejected a fresh byte-identical rewrite' >&2
  exit 1
}

# A newly written result for another task must not cross the task boundary.
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["current provider summary"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
cat > "$EVIDENCE_TMP/.brain-result.json" <<'JSON'
{"verdict":"PASS","task_id":"old-task","attempt_id":"attempt-foreign","behavior_tests":[{"command":"foreign test","exit_code":0,"log_tail":"old pass"}]}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-foreign CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" prepare_evaluator_evidence
printf '\n' >> "$EVIDENCE_TMP/.brain-result.json"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-foreign CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == ["current provider summary"]' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'evaluator evidence bridge accepted evidence for another task' >&2
  exit 1
}

# Metadata changes (for example git checkout/reset touching a tracked file) do
# not transfer old evidence to the current attempt.
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["current provider summary"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
cat > "$EVIDENCE_TMP/.brain-result.json" <<'JSON'
{"verdict":"PASS","task_id":"task-current","attempt_id":"attempt-old","behavior_tests":[{"command":"stale test","exit_code":0,"log_tail":"old pass"}]}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-metadata CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" prepare_evaluator_evidence
node -e 'const fs=require("node:fs"); const p=process.argv[1]; const now=new Date(); fs.utimesSync(p, now, now)' \
  "$EVIDENCE_TMP/.brain-result.json"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-metadata CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == ["current provider summary"]' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'evaluator evidence bridge accepted metadata-only stale evidence' >&2
  exit 1
}

grep -q '^version: 1\.31\.0$' "$EVALUATOR_SKILL" || {
  echo 'harness-evaluator skill version was not bumped for attempt-bound evidence' >&2
  exit 1
}
grep -q 'HARNESS_ATTEMPT_ID' "$EVALUATOR_SKILL" || {
  echo 'harness-evaluator skill does not emit attempt-bound evidence' >&2
  exit 1
}
# The runner's provider-facing schema must emit decisions accepted by the Brain
# callback parser. A permissive object here caused real planner callbacks to 400.
grep -q '"required":\["outcome","reason"\]' <<<"$SECTION"
# Codex structured output uses OpenAI strict JSON Schema. Every object must be
# closed and must require each declared property; arrays must declare items.
RESULT_SCHEMA_JSON=$(sed -n "s/^  result_schema_json='\(.*\)'$/\1/p" <<<"$SECTION")
[[ -n "$RESULT_SCHEMA_JSON" ]] || { echo 'missing runner result schema' >&2; exit 1; }
jq -e '
  all(.. | objects | select(.type? == "object");
    .additionalProperties == false
    and (((.properties // {}) | keys) - (.required // []) | length == 0)
  )
  and all(.. | objects | select(.type? == "array"); has("items"))
' <<<"$RESULT_SCHEMA_JSON" >/dev/null || {
  echo 'runner result schema is not Codex strict-output compatible' >&2
  exit 1
}
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
grep -q -- '--always-approve' <<<"$GROK_SECTION"
grep -q 'structuredOutput' <<<"$GROK_SECTION"
if grep -q -- '--permission-mode plan' <<<"$GROK_SECTION"; then
  echo 'Grok reviewer must rely on the read-only worktree mount, not CLI plan mode' >&2
  exit 1
fi
grep -q '@xai-official/grok' "$DOCKERFILE"

# The Kernel path may pass --model only under an explicit HARNESS_MODEL guard.
if grep -Eq -- '--model[[:space:]]+(sonnet|opus|haiku|gpt-|o[0-9])' <<<"$SECTION"; then
  echo 'provider-neutral runner hardcodes a model' >&2
  exit 1
fi

echo 'provider-neutral runner contract: PASS'
