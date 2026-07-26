#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/entrypoint.sh"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
EVALUATOR_SKILL="$SCRIPT_DIR/../../packages/workflows/skills/harness-evaluator/SKILL.md"
SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"
GROK_SECTION="$(sed -n '/elif \[\[ "$provider" == "grok" \]\]/,/^  else$/p' <<<"$SECTION")"
GIT_AUTH_SECTION="$(sed -n '/git-auth-setup:start/,/git-auth-setup:end/p' "$ENTRYPOINT")"
PROPOSER_FINALIZER_SECTION="$(sed -n '/proposer-finalizer:start/,/proposer-finalizer:end/p' "$ENTRYPOINT")"

[[ -n "$SECTION" ]] || { echo 'missing provider-neutral runner section' >&2; exit 1; }
[[ -n "$GIT_AUTH_SECTION" ]] || {
  echo 'missing runner git credential setup section' >&2
  exit 1
}
[[ -n "$PROPOSER_FINALIZER_SECTION" ]] || {
  echo 'missing proposer finalizer' >&2
  exit 1
}

# A host-only credential helper copied into the Linux runner must be replaced
# with the gh binary that actually exists inside the runner.
GIT_AUTH_TMP="$(mktemp -d)"
printf '%s\n' \
  '[credential "https://github.com"]' \
  '  helper = /usr/local/bin/git-credential-gh-token' \
  > "$GIT_AUTH_TMP/gitconfig"
GIT_CONFIG_GLOBAL="$GIT_AUTH_TMP/gitconfig" GH_TOKEN=ghp_runner_contract_test \
  eval "$GIT_AUTH_SECTION"
if git config --file "$GIT_AUTH_TMP/gitconfig" --get-all credential.https://github.com.helper \
  | grep -q '/usr/local/bin/git-credential-gh-token'; then
  echo 'runner retained the host-only GitHub credential helper' >&2
  exit 1
fi
git config --file "$GIT_AUTH_TMP/gitconfig" --get-all credential.https://github.com.helper \
  | grep -q 'gh auth git-credential' || {
  echo 'runner did not install the in-container gh credential helper' >&2
  exit 1
}
rm -rf "$GIT_AUTH_TMP"

# A successful Proposer may finish the reasoning work before the mandatory Git
# transport step. The Runner must finalize only complete, server-addressed
# artifacts and must not trust a stale branch reported by the provider.
eval "$PROPOSER_FINALIZER_SECTION"
type finalize_proposer_output >/dev/null 2>&1 || {
  echo 'missing finalize_proposer_output function' >&2
  exit 1
}
FINALIZER_TMP="$(mktemp -d)"
FINALIZER_REMOTE="$FINALIZER_TMP/remote.git"
FINALIZER_REPO="$FINALIZER_TMP/workspace"
git init --bare "$FINALIZER_REMOTE" >/dev/null
git init -b main "$FINALIZER_REPO" >/dev/null
git -C "$FINALIZER_REPO" config user.name 'Runner Contract Test'
git -C "$FINALIZER_REPO" config user.email 'runner-contract@example.invalid'
git -C "$FINALIZER_REPO" config core.hooksPath /dev/null
git -C "$FINALIZER_REPO" remote add origin "$FINALIZER_REMOTE"
printf '%s\n' 'base' > "$FINALIZER_REPO/README.md"
git -C "$FINALIZER_REPO" add README.md
git -C "$FINALIZER_REPO" commit -m 'base' >/dev/null

FINALIZER_SPRINT='sprints/07251915-kernel-a1fa8636'
mkdir -p "$FINALIZER_REPO/$FINALIZER_SPRINT/tests"
printf '%s\n' '# contract' > "$FINALIZER_REPO/$FINALIZER_SPRINT/contract-draft.md"
printf '%s\n' '# dod' > "$FINALIZER_REPO/$FINALIZER_SPRINT/contract-dod.md"
printf '%s\n' '{"tasks":[]}' > "$FINALIZER_REPO/$FINALIZER_SPRINT/task-plan.json"
printf '%s\n' 'test("red", () => {});' > "$FINALIZER_REPO/$FINALIZER_SPRINT/tests/kernel-telemetry.contract.test.ts"
printf '%s\n' '{"propose_branch":"stale-provider-branch"}' > "$FINALIZER_REPO/.brain-result.json"

HARNESS_NODE=proposer \
CECELIA_TASK_ID=a1fa8636-2ad4-41b4-8de3-8609af83daec \
PROPOSE_BRANCH=cp-harness-propose-r1-a1fa8636-a4 \
PROPOSE_ROUND=1 \
SPRINT_DIR="$FINALIZER_SPRINT" \
WORKTREE_PATH="$FINALIZER_REPO" \
  finalize_proposer_output

git --git-dir="$FINALIZER_REMOTE" rev-parse --verify \
  refs/heads/cp-harness-propose-r1-a1fa8636-a4 >/dev/null
for artifact in contract-draft.md contract-dod.md task-plan.json tests/kernel-telemetry.contract.test.ts; do
  git --git-dir="$FINALIZER_REMOTE" show \
    "refs/heads/cp-harness-propose-r1-a1fa8636-a4:$FINALIZER_SPRINT/$artifact" >/dev/null
done
jq -e \
  '.propose_branch == "cp-harness-propose-r1-a1fa8636-a4"
   and .workstream_count == 1
   and .task_plan_path == "sprints/07251915-kernel-a1fa8636/task-plan.json"' \
  "$FINALIZER_REPO/.brain-result.json" >/dev/null

if HARNESS_NODE=proposer \
  CECELIA_TASK_ID=a1fa8636-2ad4-41b4-8de3-8609af83daec \
  PROPOSE_BRANCH=cp-harness-propose-r2-wrongid0-a5 \
  SPRINT_DIR="$FINALIZER_SPRINT" \
  WORKTREE_PATH="$FINALIZER_REPO" \
    finalize_proposer_output; then
  echo 'proposer finalizer accepted a branch for another task' >&2
  exit 1
fi
if git --git-dir="$FINALIZER_REMOTE" show-ref --verify --quiet \
  refs/heads/cp-harness-propose-r2-wrongid0-a5; then
  echo 'proposer finalizer pushed an invalid branch' >&2
  exit 1
fi

rm "$FINALIZER_REPO/$FINALIZER_SPRINT/contract-dod.md"
if HARNESS_NODE=proposer \
  CECELIA_TASK_ID=a1fa8636-2ad4-41b4-8de3-8609af83daec \
  PROPOSE_BRANCH=cp-harness-propose-r2-a1fa8636-a6 \
  SPRINT_DIR="$FINALIZER_SPRINT" \
  WORKTREE_PATH="$FINALIZER_REPO" \
    finalize_proposer_output; then
  echo 'proposer finalizer accepted incomplete contract artifacts' >&2
  exit 1
fi
if git --git-dir="$FINALIZER_REMOTE" show-ref --verify --quiet \
  refs/heads/cp-harness-propose-r2-a1fa8636-a6; then
  echo 'proposer finalizer pushed incomplete contract artifacts' >&2
  exit 1
fi
rm -rf "$FINALIZER_TMP"

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

grep -q '^version: 1\.32\.2$' "$EVALUATOR_SKILL" || {
  echo 'harness-evaluator skill version was not bumped for attempt-bound evidence' >&2
  exit 1
}
grep -q 'HARNESS_ATTEMPT_ID' "$EVALUATOR_SKILL" || {
  echo 'harness-evaluator skill does not emit attempt-bound evidence' >&2
  exit 1
}

# Execute the Skill's real PASS writer, then carry its output through the same
# bridge. This prevents prose/examples from drifting away from the runnable exit.
RESULT_WRITER="$(sed -n '/evaluator-result-writer:start/,/evaluator-result-writer:end/p' "$EVALUATOR_SKILL")"
[[ -n "$RESULT_WRITER" ]] || {
  echo 'harness-evaluator skill is missing its executable PASS result writer' >&2
  exit 1
}
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["provider summary"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
printf '%s\n' '12 tests passed' > "$EVIDENCE_TMP/e2e-result.log"
printf '%s\n' \
  '{"task_id":"task-current","attempt_id":"attempt-skill","command":"timeout 120 bash /tmp/e2e-verify.sh","exit_code":0}' \
  > "$EVIDENCE_TMP/evaluator-execution.json"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-skill CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" prepare_evaluator_evidence
WORKSPACE="$EVIDENCE_TMP" TASK_ID=task-current HARNESS_ATTEMPT_ID=attempt-skill \
  TARGET_ENV=local_api E2E_EXECUTION_FILE="$EVIDENCE_TMP/evaluator-execution.json" \
  E2E_RESULT_LOG="$EVIDENCE_TMP/e2e-result.log" SCREENSHOTS_JSON='[]' CASCADE_ASSERTIONS='[]' \
  eval "$RESULT_WRITER"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-skill CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == [{"command":"timeout 120 bash /tmp/e2e-verify.sh","exit_code":0,"log_tail":"12 tests passed"}]' \
  "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'harness-evaluator executable PASS writer did not survive the callback bridge' >&2
  exit 1
}

# A shared/stale metadata file from another attempt cannot be repackaged under
# the current attempt's identity by the PASS writer.
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["provider summary"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
printf '%s\n' \
  '{"task_id":"old-task","attempt_id":"old-attempt","command":"prior-attempt-command","exit_code":0}' \
  > "$EVIDENCE_TMP/evaluator-execution.json"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-skill CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" prepare_evaluator_evidence
WORKSPACE="$EVIDENCE_TMP" TASK_ID=task-current HARNESS_ATTEMPT_ID=attempt-skill \
  TARGET_ENV=local_api E2E_EXECUTION_FILE="$EVIDENCE_TMP/evaluator-execution.json" \
  E2E_RESULT_LOG="$EVIDENCE_TMP/e2e-result.log" SCREENSHOTS_JSON='[]' CASCADE_ASSERTIONS='[]' \
  eval "$RESULT_WRITER"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-skill CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == ["provider summary"]' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'harness-evaluator PASS writer accepted foreign execution metadata' >&2
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
# The Runner container is already the external sandbox. Asking Codex to add its
# own read-only bubblewrap sandbox fails inside Docker because unprivileged user
# namespaces are unavailable. Read-only roles are enforced by the /workspace:ro
# bind mount, so Codex must bypass its nested sandbox for every Kernel attempt.
grep -q -- '--dangerously-bypass-approvals-and-sandbox' <<<"$SECTION"
if grep -q -- '--sandbox read-only' <<<"$SECTION"; then
  echo 'Codex reviewer must rely on the read-only worktree mount, not nested bwrap' >&2
  exit 1
fi
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
