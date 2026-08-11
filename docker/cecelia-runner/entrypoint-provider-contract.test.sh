#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/entrypoint.sh"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
EVALUATOR_SKILL="$SCRIPT_DIR/../../packages/workflows/skills/harness-evaluator/SKILL.md"
SECTION="$(sed -n '/provider-neutral:start/,/provider-neutral:end/p' "$ENTRYPOINT")"
HEARTBEAT_SECTION="$(sed -n '/^post_attempt_heartbeat()/,/^}/p' "$ENTRYPOINT")"
EVIDENCE_BOUNDARY_SECTION="$(sed -n '/evaluator-evidence-boundary:start/,/evaluator-evidence-boundary:end/p' "$ENTRYPOINT")"
PROVIDER_SESSION_SECTION="$(sed -n '/^persist_provider_session()/,/^}/p' "$ENTRYPOINT")"
CALLBACK_SECTION="$(sed -n '/# Harness 任务路径：/,$p' "$ENTRYPOINT")"
CODEX_SECTION="$(sed -n '/if \[\[ "$provider" == "codex" \]\]/,/elif \[\[ "$provider" == "claude" \]\]/p' <<<"$SECTION")"
CLAUDE_SECTION="$(sed -n '/elif \[\[ "$provider" == "claude" \]\]/,/elif \[\[ "$provider" == "grok" \]\]/p' <<<"$SECTION")"
GROK_SECTION="$(sed -n '/elif \[\[ "$provider" == "grok" \]\]/,/^  else$/p' <<<"$SECTION")"
GIT_AUTH_SECTION="$(sed -n '/git-auth-setup:start/,/git-auth-setup:end/p' "$ENTRYPOINT")"
PROPOSER_FINALIZER_SECTION="$(sed -n '/proposer-finalizer:start/,/proposer-finalizer:end/p' "$ENTRYPOINT")"

[[ -n "$SECTION" ]] || { echo 'missing provider-neutral runner section' >&2; exit 1; }
[[ -n "$HEARTBEAT_SECTION" ]] || { echo 'missing centralized heartbeat transport' >&2; exit 1; }
[[ -n "$EVIDENCE_BOUNDARY_SECTION" && -n "$PROVIDER_SESSION_SECTION" && -n "$CALLBACK_SECTION" ]] || {
  echo 'missing heartbeat caller boundary' >&2
  exit 1
}
[[ -n "$GIT_AUTH_SECTION" ]] || {
  echo 'missing runner git credential setup section' >&2
  exit 1
}
[[ -n "$PROPOSER_FINALIZER_SECTION" ]] || {
  echo 'missing proposer finalizer' >&2
  exit 1
}
grep -Fq 'ci --ignore-scripts --no-audit --no-fund' "$ENTRYPOINT" || {
  echo 'runner dependency install can execute candidate lifecycle scripts' >&2
  exit 1
}
grep -Fq 'terminate_evaluator_provider_processes' "$ENTRYPOINT" || {
  echo 'runner does not terminate Provider descendants before trusted assertions' >&2
  exit 1
}
grep -Fq 'pkill -KILL -u cecelia' "$ENTRYPOINT" || {
  echo 'runner does not sweep escaped Provider UID processes' >&2
  exit 1
}
CODEX_RECOVERY_LINE="$(grep -n 'recovered completed Codex turn' "$ENTRYPOINT" | cut -d: -f1)"
PROVIDER_SWEEP_LINE="$(grep -n 'if ! terminate_evaluator_provider_processes' "$ENTRYPOINT" | cut -d: -f1)"
if [[ -z "$CODEX_RECOVERY_LINE" || -z "$PROVIDER_SWEEP_LINE" \
    || "$PROVIDER_SWEEP_LINE" -le "$CODEX_RECOVERY_LINE" ]]; then
  echo 'Codex terminal recovery can overwrite Provider descendant cleanup failure' >&2
  exit 1
fi
DEPENDENCY_INSTALL_SECTION="$(sed -n '/package-lock.json/,/trusted assertion dependency install failed/p' "$ENTRYPOINT")"
grep -Fq '"${ASSERTION_IDENTITY_PREFIX[@]}"' <<<"$DEPENDENCY_INSTALL_SECTION" || {
  echo 'runner dependency install does not use the isolated assertion identity' >&2
  exit 1
}
if grep -Fq '"${PROVIDER_IDENTITY_PREFIX[@]}"' <<<"$DEPENDENCY_INSTALL_SECTION"; then
  echo 'runner dependency install reuses the untrusted Provider identity' >&2
  exit 1
fi

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
FINALIZER_TASK_ID='a1fa8636-2ad4-41b4-8de3-8609af83daec'
FINALIZER_RUN_ID='11111111-1111-4111-8111-111111111111'
FINALIZER_BRANCH='cp-harness-propose-r1-a1fa8636-r11111111-a4'
FINALIZER_TASK_BUNDLE="$FINALIZER_TMP/task-bundle.json"
FINALIZER_WRONG_HOP_TASK_BUNDLE="$FINALIZER_TMP/task-bundle-wrong-hop.json"
FINALIZER_ROUND2_BRANCH='cp-harness-propose-r2-a1fa8636-r11111111-a6'
FINALIZER_ROUND2_TASK_BUNDLE="$FINALIZER_TMP/task-bundle-round2.json"
mkdir -p "$FINALIZER_REPO/$FINALIZER_SPRINT/tests"
printf '%s\n' '# contract' > "$FINALIZER_REPO/$FINALIZER_SPRINT/contract-draft.md"
printf '%s\n' '# dod' > "$FINALIZER_REPO/$FINALIZER_SPRINT/contract-dod.md"
printf '%s\n' '{"tasks":[]}' > "$FINALIZER_REPO/$FINALIZER_SPRINT/task-plan.json"
printf '%s\n' 'test("red", () => {});' > "$FINALIZER_REPO/$FINALIZER_SPRINT/tests/kernel-telemetry.contract.test.ts"
printf '%s\n' '{"propose_branch":"stale-provider-branch"}' > "$FINALIZER_REPO/.brain-result.json"
printf '%s\n' \
  "{\"task_bundle\":{\"run_id\":\"$FINALIZER_RUN_ID\",\"hop\":4,\"role\":\"proposer\",\"inputs\":{\"task_id\":\"$FINALIZER_TASK_ID\",\"sprint_dir\":\"$FINALIZER_SPRINT\",\"propose_branch\":\"$FINALIZER_BRANCH\",\"contract_round\":1}}}" \
  > "$FINALIZER_TASK_BUNDLE"
printf '%s\n' \
  "{\"task_bundle\":{\"run_id\":\"$FINALIZER_RUN_ID\",\"hop\":4,\"role\":\"proposer\",\"inputs\":{\"task_id\":\"$FINALIZER_TASK_ID\",\"sprint_dir\":\"$FINALIZER_SPRINT\",\"propose_branch\":\"cp-harness-propose-r1-a1fa8636-r11111111-a5\",\"contract_round\":1}}}" \
  > "$FINALIZER_WRONG_HOP_TASK_BUNDLE"
printf '%s\n' \
  "{\"task_bundle\":{\"run_id\":\"$FINALIZER_RUN_ID\",\"hop\":6,\"role\":\"proposer\",\"inputs\":{\"task_id\":\"$FINALIZER_TASK_ID\",\"sprint_dir\":\"$FINALIZER_SPRINT\",\"propose_branch\":\"$FINALIZER_ROUND2_BRANCH\",\"contract_round\":2}}}" \
  > "$FINALIZER_ROUND2_TASK_BUNDLE"

HARNESS_NODE=proposer \
CECELIA_TASK_ID="$FINALIZER_TASK_ID" \
PROPOSE_BRANCH="$FINALIZER_BRANCH" \
PROPOSE_ROUND=1 \
SPRINT_DIR="$FINALIZER_SPRINT" \
WORKTREE_PATH="$FINALIZER_REPO" \
HARNESS_TASK_BUNDLE_FILE="$FINALIZER_TASK_BUNDLE" \
  finalize_proposer_output

git --git-dir="$FINALIZER_REMOTE" rev-parse --verify \
  "refs/heads/$FINALIZER_BRANCH" >/dev/null
for artifact in contract-draft.md contract-dod.md task-plan.json tests/kernel-telemetry.contract.test.ts; do
  git --git-dir="$FINALIZER_REMOTE" show \
    "refs/heads/$FINALIZER_BRANCH:$FINALIZER_SPRINT/$artifact" >/dev/null
done
jq -e \
  '.propose_branch == "cp-harness-propose-r1-a1fa8636-r11111111-a4"
   and .workstream_count == 1
   and .task_plan_path == "sprints/07251915-kernel-a1fa8636/task-plan.json"' \
  "$FINALIZER_REPO/.brain-result.json" >/dev/null

if HARNESS_NODE=proposer \
  CECELIA_TASK_ID="$FINALIZER_TASK_ID" \
  PROPOSE_BRANCH=cp-harness-propose-r2-wrongid0-r11111111-a5 \
  SPRINT_DIR="$FINALIZER_SPRINT" \
  WORKTREE_PATH="$FINALIZER_REPO" \
  HARNESS_TASK_BUNDLE_FILE="$FINALIZER_WRONG_HOP_TASK_BUNDLE" \
    finalize_proposer_output; then
  echo 'proposer finalizer accepted a branch for another task' >&2
  exit 1
fi
if git --git-dir="$FINALIZER_REMOTE" show-ref --verify --quiet \
  refs/heads/cp-harness-propose-r2-wrongid0-r11111111-a5; then
  echo 'proposer finalizer pushed an invalid branch' >&2
  exit 1
fi

if HARNESS_NODE=proposer \
  CECELIA_TASK_ID="$FINALIZER_TASK_ID" \
  PROPOSE_BRANCH=cp-harness-propose-r1-a1fa8636-r33333333-a4 \
  PROPOSE_ROUND=1 \
  SPRINT_DIR="$FINALIZER_SPRINT" \
  WORKTREE_PATH="$FINALIZER_REPO" \
  HARNESS_TASK_BUNDLE_FILE="$FINALIZER_TASK_BUNDLE" \
    finalize_proposer_output; then
  echo 'proposer finalizer accepted a branch for another run' >&2
  exit 1
fi
if git --git-dir="$FINALIZER_REMOTE" show-ref --verify --quiet \
  refs/heads/cp-harness-propose-r1-a1fa8636-r33333333-a4; then
  echo 'proposer finalizer pushed a branch for another run' >&2
  exit 1
fi

if HARNESS_NODE=proposer \
  CECELIA_TASK_ID="$FINALIZER_TASK_ID" \
  PROPOSE_BRANCH=cp-harness-propose-r1-a1fa8636-r11111111-a5 \
  PROPOSE_ROUND=1 \
  SPRINT_DIR="$FINALIZER_SPRINT" \
  WORKTREE_PATH="$FINALIZER_REPO" \
  HARNESS_TASK_BUNDLE_FILE="$FINALIZER_WRONG_HOP_TASK_BUNDLE" \
    finalize_proposer_output; then
  echo 'proposer finalizer accepted a branch for another hop' >&2
  exit 1
fi

rm "$FINALIZER_REPO/$FINALIZER_SPRINT/contract-dod.md"
if HARNESS_NODE=proposer \
  CECELIA_TASK_ID="$FINALIZER_TASK_ID" \
  PROPOSE_BRANCH="$FINALIZER_ROUND2_BRANCH" \
  PROPOSE_ROUND=2 \
  SPRINT_DIR="$FINALIZER_SPRINT" \
  WORKTREE_PATH="$FINALIZER_REPO" \
  HARNESS_TASK_BUNDLE_FILE="$FINALIZER_ROUND2_TASK_BUNDLE" \
    finalize_proposer_output; then
  echo 'proposer finalizer accepted incomplete contract artifacts' >&2
  exit 1
fi
if git --git-dir="$FINALIZER_REMOTE" show-ref --verify --quiet \
  refs/heads/cp-harness-propose-r2-a1fa8636-r11111111-a6; then
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
grep -q 'commander-directive/v1' <<<"$SECTION" || {
  echo 'runner does not select the Commander Directive contract' >&2
  exit 1
}
grep -q 'validate_commander_task_bundle' <<<"$SECTION" || {
  echo 'runner does not enforce the observational Commander TaskBundle boundary' >&2
  exit 1
}
grep -q 'normalize_provider_success' <<<"$SECTION" || {
  echo 'runner does not wrap direct Commander output for callback transport' >&2
  exit 1
}
if ! grep -q 'HARNESS_CALLBACK_TOKEN' <<<"$SECTION"; then
  echo 'Commander path dropped callback credentials' >&2
  exit 1
fi

eval "$SECTION"
RUNNER_ASSERTION_EXECUTOR="$SCRIPT_DIR/assertion-exec.mjs"
RUNNER_ASSERTION_NODE_BIN="$(command -v node)"
type provider_result_schema_json >/dev/null 2>&1 || {
  echo 'missing Provider result schema selector' >&2
  exit 1
}
type validate_commander_task_bundle >/dev/null 2>&1 || {
  echo 'missing Commander TaskBundle validator' >&2
  exit 1
}
type normalize_provider_success >/dev/null 2>&1 || {
  echo 'missing Provider success normalizer' >&2
  exit 1
}
type read_attempt_timeout_seconds >/dev/null 2>&1 || {
  echo 'missing Attempt timeout validator' >&2
  exit 1
}
type run_with_attempt_timeout >/dev/null 2>&1 || {
  echo 'missing Attempt timeout process supervisor' >&2
  exit 1
}
type normalize_attempt_timeout_exit >/dev/null 2>&1 || {
  echo 'missing Attempt timeout forced-kill classifier' >&2
  exit 1
}
type normalize_provider_failure >/dev/null 2>&1 || {
  echo 'missing Provider failure normalizer' >&2
  exit 1
}
type validate_codex_terminal_receipt >/dev/null 2>&1 || {
  echo 'missing strict Codex terminal receipt validator' >&2
  exit 1
}
type publish_provider_result_schema >/dev/null 2>&1 || {
  echo 'missing Provider-readable result schema publisher' >&2
  exit 1
}

# codex exec can retain exit 1 after a non-retry internal error even when the
# primary turn later completes. Recovery is legal only when the CLI's two
# independent outputs agree: the terminal JSONL receipt and last-message file.
CODEX_RECEIPT_TMP="$(mktemp -d)"
cat > "$CODEX_RECEIPT_TMP/result.json" <<'JSON'
{"status":"completed_with_concerns","summary":"planner shipped","artifacts":["sprint-prd.md"],"checks":[],"decision":{"outcome":"DONE_WITH_CONCERNS","reason":"non-fatal compact concern"},"error":null}
JSON
jq -nc \
  --arg text "$(cat "$CODEX_RECEIPT_TMP/result.json")" \
  '{type:"thread.started",thread_id:"thread-receipt"},
   {type:"error",message:"remote compact credential refresh failed"},
   {type:"item.completed",item:{id:"item_1",type:"agent_message",text:$text}},
   {type:"turn.completed",usage:{input_tokens:42,output_tokens:7}}' \
  > "$CODEX_RECEIPT_TMP/completed.jsonl"
validate_codex_terminal_receipt \
  "$CODEX_RECEIPT_TMP/completed.jsonl" \
  "$CODEX_RECEIPT_TMP/result.json" || {
  echo 'strict receipt rejected a completed Codex turn with matching result' >&2
  exit 1
}
cat > "$CODEX_RECEIPT_TMP/task.json" <<'JSON'
{"task_bundle":{"expected_output":"harness-result/planner-v1"}}
JSON
normalize_provider_success \
  "$CODEX_RECEIPT_TMP/task.json" \
  "$CODEX_RECEIPT_TMP/result.json" \
  "$CODEX_RECEIPT_TMP/normalized.json" \
  "22222222-2222-4222-8222-222222222222" \
  "codex" \
  "thread-receipt" \
  "33333333-3333-4333-8333-333333333333" \
  "false" \
  "1" \
  "turn.completed"
jq -e '
  .status == "completed_with_concerns"
  and .provider_metadata.cli_exit_code == 1
  and .provider_metadata.terminal_receipt == "turn.completed"
' "$CODEX_RECEIPT_TMP/normalized.json" >/dev/null || {
  echo 'normalized result dropped the Codex terminal recovery evidence' >&2
  exit 1
}

cat > "$CODEX_RECEIPT_TMP/mismatch.json" <<'JSON'
{"status":"completed","summary":"different result","artifacts":[],"checks":[],"decision":null,"error":null}
JSON
if validate_codex_terminal_receipt \
  "$CODEX_RECEIPT_TMP/completed.jsonl" \
  "$CODEX_RECEIPT_TMP/mismatch.json"; then
  echo 'strict receipt accepted a last-message mismatch' >&2
  exit 1
fi

sed 's/turn.completed/turn.failed/' \
  "$CODEX_RECEIPT_TMP/completed.jsonl" > "$CODEX_RECEIPT_TMP/failed.jsonl"
if validate_codex_terminal_receipt \
  "$CODEX_RECEIPT_TMP/failed.jsonl" \
  "$CODEX_RECEIPT_TMP/result.json"; then
  echo 'strict receipt accepted turn.failed' >&2
  exit 1
fi

head -n 1 "$CODEX_RECEIPT_TMP/completed.jsonl" \
  > "$CODEX_RECEIPT_TMP/missing-message.jsonl"
tail -n 1 "$CODEX_RECEIPT_TMP/completed.jsonl" \
  >> "$CODEX_RECEIPT_TMP/missing-message.jsonl"
if validate_codex_terminal_receipt \
  "$CODEX_RECEIPT_TMP/missing-message.jsonl" \
  "$CODEX_RECEIPT_TMP/result.json"; then
  echo 'strict receipt accepted a missing agent message' >&2
  exit 1
fi

cp "$CODEX_RECEIPT_TMP/completed.jsonl" "$CODEX_RECEIPT_TMP/trailing-garbage.jsonl"
printf '%s\n' 'unstructured stderr after terminal event' \
  >> "$CODEX_RECEIPT_TMP/trailing-garbage.jsonl"
if validate_codex_terminal_receipt \
  "$CODEX_RECEIPT_TMP/trailing-garbage.jsonl" \
  "$CODEX_RECEIPT_TMP/result.json"; then
  echo 'strict receipt ignored a non-JSON line after turn.completed' >&2
  exit 1
fi

jq -nc \
  --arg text "$(cat "$CODEX_RECEIPT_TMP/result.json")" \
  '{type:"thread.started",thread_id:"thread-receipt"},
   {type:"item.completed",item:{id:"item_1",type:"agent_message",text:$text}},
   {type:"item.completed",item:{id:"item_2",type:"agent_message",text:"not-json"}},
   {type:"turn.completed",usage:{input_tokens:42,output_tokens:7}}' \
  > "$CODEX_RECEIPT_TMP/invalid-last-message.jsonl"
if validate_codex_terminal_receipt \
  "$CODEX_RECEIPT_TMP/invalid-last-message.jsonl" \
  "$CODEX_RECEIPT_TMP/result.json"; then
  echo 'strict receipt ignored an invalid final agent message' >&2
  exit 1
fi
rm -rf "$CODEX_RECEIPT_TMP"

PROVIDER_SCHEMA_PERMISSION_TMP="$(mktemp -d)"
publish_provider_result_schema \
  "$PROVIDER_SCHEMA_PERMISSION_TMP/result.schema.json" \
  '{"type":"object"}'
PROVIDER_SCHEMA_MODE="$(
  stat -c '%a' "$PROVIDER_SCHEMA_PERMISSION_TMP/result.schema.json" 2>/dev/null \
    || stat -f '%Lp' "$PROVIDER_SCHEMA_PERMISSION_TMP/result.schema.json"
)"
[[ "$PROVIDER_SCHEMA_MODE" == "444" ]] || {
  echo "Provider result schema mode is $PROVIDER_SCHEMA_MODE instead of 444" >&2
  exit 1
}
[[ "$(cat "$PROVIDER_SCHEMA_PERMISSION_TMP/result.schema.json")" == '{"type":"object"}' ]] || {
  echo 'Provider result schema publisher changed schema contents' >&2
  exit 1
}
rm -rf "$PROVIDER_SCHEMA_PERMISSION_TMP"

EVALUATOR_SCHEMA_TMP="$(mktemp -d)"
cat > "$EVALUATOR_SCHEMA_TMP/task.json" <<'JSON'
{"task_bundle":{"role":"evaluator","expected_output":"harness-result/evaluator-v1"}}
JSON
EVALUATOR_SCHEMA="$(provider_result_schema_json "$EVALUATOR_SCHEMA_TMP/task.json")"
jq -e '
  .properties.checks.items.anyOf[0].type == "string"
  and .properties.checks.items.anyOf[1].type == "object"
  and .properties.checks.items.anyOf[1].additionalProperties == false
  and .properties.checks.items.anyOf[1].properties.command.type == "string"
  and .properties.checks.items.anyOf[1].properties.exit_code.type == "integer"
  and .properties.checks.items.anyOf[1].properties.log_tail.type == "string"
  and .properties.checks.items.anyOf[1].properties.verification_level.enum == ["L1","L2","L3"]
  and .properties.checks.items.anyOf[1].required == [
    "command","exit_code","log_tail","verification_level",
    "action","expected","wait_budget","evidence"
  ]
' <<<"$EVALUATOR_SCHEMA" >/dev/null || {
  echo 'runner schema does not preserve strict evaluator evidence objects' >&2
  exit 1
}
rm -rf "$EVALUATOR_SCHEMA_TMP"

# ── 案卷式 GAN 出口字段必须被 schema 放行（2026-08-05 r36 实证根因）──────────
# 事故：runner schema 顶层 additionalProperties:false 且 decision 只允许
# outcome/reason，把 skill 9.13.0 要求的 case_file / decision.rubric_scores
# 硬性禁掉。codex structured output 遵守 schema → 两个字段永远输不出来 →
# Brain 落库 gan_case_file 永远是空壳（blockers=[] / feedback_md=null /
# rubric_scores=null）→ 每轮 reviewer 读到零信息案卷 → 无跨轮记忆 → 打地鼠式
# 挑毛病，r36 跑满 14 轮仍不收敛。案卷是 GAN 收敛机制的命脉，schema 必须放行。
GAN_SCHEMA_TMP="$(mktemp -d)"
cat > "$GAN_SCHEMA_TMP/task.json" <<'JSON'
{"task_bundle":{"role":"reviewer","expected_output":"harness-result/v1"}}
JSON
GAN_SCHEMA="$(provider_result_schema_json "$GAN_SCHEMA_TMP/task.json")"
jq -e '
  (.required | index("case_file")) != null
  and .properties.case_file.anyOf[0].properties.blockers.type == "array"
  and .properties.case_file.anyOf[0].properties.feedback_md.type == "string"
  and (.properties.case_file.anyOf[0].properties.blockers.items.anyOf
       | map(.properties | has("why_not_found_earlier")) | any)
  and (.properties.decision.anyOf[0].required | index("rubric_scores")) != null
  and (.properties.decision.anyOf[0].properties.rubric_scores.anyOf[0].properties
       | has("test_is_red"))
' <<<"$GAN_SCHEMA" >/dev/null || {
  echo 'runner schema forbids case_file / decision.rubric_scores — GAN 案卷断链' >&2
  exit 1
}
rm -rf "$GAN_SCHEMA_TMP"

[[ "$(read_attempt_timeout_seconds 300)" == "300" ]]
for invalid_timeout in '' 0 -1 1.5 12s token; do
  if read_attempt_timeout_seconds "$invalid_timeout" >/dev/null 2>&1; then
    echo "Attempt timeout validator accepted invalid value: $invalid_timeout" >&2
    exit 1
  fi
done

timeout_started=$SECONDS
if run_with_attempt_timeout 1 bash -c 'sleep 3'; then
  echo 'Attempt timeout supervisor allowed an over-budget process to succeed' >&2
  exit 1
else
  timeout_exit=$?
fi
[[ $timeout_exit -eq 124 ]] || {
  echo "Attempt timeout supervisor returned $timeout_exit instead of 124" >&2
  exit 1
}
[[ "$(normalize_attempt_timeout_exit 137 11 1)" == "124" ]] || {
  echo 'Attempt timeout forced KILL was not normalized to timeout' >&2
  exit 1
}
[[ "$(normalize_attempt_timeout_exit 137 0 30)" == "137" ]] || {
  echo 'Provider OOM/early KILL was incorrectly normalized to timeout' >&2
  exit 1
}
[[ "$(normalize_attempt_timeout_exit 124 0 30)" == "125" ]] || {
  echo 'Provider-native early exit 124 was incorrectly normalized to timeout' >&2
  exit 1
}
[[ $((SECONDS - timeout_started)) -lt 3 ]] || {
  echo 'Attempt timeout supervisor did not stop the process before natural exit' >&2
  exit 1
}

grep -q 'run_with_attempt_timeout' <<<"$CODEX_SECTION"
grep -q 'run_with_attempt_timeout' <<<"$CLAUDE_SECTION"
grep -q 'run_with_attempt_timeout' <<<"$GROK_SECTION"

ATTEMPT_TIMEOUT_TMP="$(mktemp -d)"
printf '%s\n' 'sensitive-provider-output-must-not-cross-timeout-result' \
  > "$ATTEMPT_TIMEOUT_TMP/stdout.jsonl"
normalize_provider_failure \
  "$ATTEMPT_TIMEOUT_TMP/normalized.json" \
  "22222222-2222-4222-8222-222222222222" \
  "codex" \
  "thread-timeout" \
  "33333333-3333-4333-8333-333333333333" \
  "false" \
  124 \
  "$ATTEMPT_TIMEOUT_TMP/stdout.jsonl"
jq -e '
  .status == "failed"
  and .summary == "provider process timed out"
  and .error.code == "provider_timeout"
  and .error.message == "provider exceeded the TaskBundle timeout"
  and .error.exit_code == 124
  and .provider_metadata.provider == "codex"
  and .provider_metadata.session_id == "thread-timeout"
  and .provider_metadata.credential_ref == "33333333-3333-4333-8333-333333333333"
  and .provider_metadata.credential_copy_mutated == false
' "$ATTEMPT_TIMEOUT_TMP/normalized.json" >/dev/null
if grep -q 'sensitive-provider-output' "$ATTEMPT_TIMEOUT_TMP/normalized.json"; then
  echo 'Attempt timeout result leaked Provider output' >&2
  exit 1
fi
rm -rf "$ATTEMPT_TIMEOUT_TMP"

COMMANDER_TMP="$(mktemp -d)"
cat > "$COMMANDER_TMP/task.json" <<'JSON'
{"task_bundle":{"contract_version":"1.0","run_id":"11111111-1111-4111-8111-111111111111","attempt_id":"22222222-2222-4222-8222-222222222222","role":"commander","skill":null,"inputs":{"commander_bundle":{"schema":"commander-bundle/v1","run_id":"11111111-1111-4111-8111-111111111111","commander_attempt_id":"22222222-2222-4222-8222-222222222222","output_schema":"commander-directive/v1"}},"constraints":{"read_only":true,"fresh_session":true,"timeout_seconds":600},"expected_output":"commander-directive/v1"}}
JSON
cat > "$COMMANDER_TMP/directive.json" <<'JSON'
{"schema":"commander-directive/v1","run_id":"11111111-1111-4111-8111-111111111111","event_cursor":9,"action":"continue_default","target_role":null,"target_attempt_id":null,"reason":"The fresh Kernel decision remains legal.","guidance":null,"route":null,"evidence_refs":["event:9"]}
JSON

COMMANDER_SCHEMA="$(provider_result_schema_json "$COMMANDER_TMP/task.json")"
jq -e '
  .properties.schema.type == "string"
  and .properties.schema.const == "commander-directive/v1"
  and (.required | sort) == (.properties | keys | sort)
  and .properties.target_role.type == ["string","null"]
  and (.properties.target_attempt_id.anyOf | map(.type) | sort) == ["null","string"]
  and .properties.guidance.type == ["string","null"]
  and (.properties.route.anyOf | map(.type) | sort) == ["null","object"]
  and ([.properties.route.anyOf[] | select(.type == "object")][0] as $route
    | ($route.required | sort) == ($route.properties | keys | sort)
      and ([ $route.properties[] | .type ] | all(. == ["string","null"])))
  and .additionalProperties == false
' <<<"$COMMANDER_SCHEMA" >/dev/null || {
  echo 'runner Commander schema is not strict' >&2
  exit 1
}
validate_commander_task_bundle "$COMMANDER_TMP/task.json"
normalize_provider_success \
  "$COMMANDER_TMP/task.json" \
  "$COMMANDER_TMP/directive.json" \
  "$COMMANDER_TMP/normalized.json" \
  "22222222-2222-4222-8222-222222222222" \
  "codex" \
  "thread-commander" \
  "" \
  "false"
jq -e '
  .contract_version == "1.0"
  and .attempt_id == "22222222-2222-4222-8222-222222222222"
  and .status == "completed"
  and .summary == .decision.reason
  and .artifacts == []
  and .checks == []
  and .decision.schema == "commander-directive/v1"
  and (.decision | has("target_role") | not)
  and (.decision | has("target_attempt_id") | not)
  and (.decision | has("guidance") | not)
  and (.decision | has("route") | not)
  and .error == null
  and .provider_metadata.provider == "codex"
  and .provider_metadata.session_id == "thread-commander"
' "$COMMANDER_TMP/normalized.json" >/dev/null || {
  echo 'runner did not wrap the direct Commander Directive' >&2
  exit 1
}

cat > "$COMMANDER_TMP/ordinary-task.json" <<'JSON'
{"task_bundle":{"expected_output":"harness-result/planner-v1"}}
JSON
cat > "$COMMANDER_TMP/ordinary-result.json" <<'JSON'
{"status":"completed","summary":"unchanged","artifacts":[],"checks":[],"decision":null,"error":null}
JSON
normalize_provider_success \
  "$COMMANDER_TMP/ordinary-task.json" \
  "$COMMANDER_TMP/ordinary-result.json" \
  "$COMMANDER_TMP/ordinary-normalized.json" \
  "22222222-2222-4222-8222-222222222222" \
  "codex" \
  "thread-ordinary" \
  "" \
  "false"
jq \
  --arg attempt "22222222-2222-4222-8222-222222222222" \
  --arg provider "codex" \
  --arg session "thread-ordinary" \
  '.contract_version = (.contract_version // "1.0")
   | .attempt_id = $attempt
   | .provider_metadata = ((.provider_metadata // {}) + {
       provider: $provider,
       session_id: $session
     })' \
  "$COMMANDER_TMP/ordinary-result.json" > "$COMMANDER_TMP/ordinary-expected.json"
cmp "$COMMANDER_TMP/ordinary-expected.json" "$COMMANDER_TMP/ordinary-normalized.json" || {
  echo 'runner changed the ordinary HarnessResult normalization path' >&2
  exit 1
}

jq '.task_bundle.skill = {"name":"writer","content":"mutating"}' \
  "$COMMANDER_TMP/task.json" > "$COMMANDER_TMP/with-skill.json"
if validate_commander_task_bundle "$COMMANDER_TMP/with-skill.json"; then
  echo 'runner allowed Commander role Skill content' >&2
  exit 1
fi
jq '.task_bundle.constraints.read_only = false' \
  "$COMMANDER_TMP/task.json" > "$COMMANDER_TMP/writable.json"
if validate_commander_task_bundle "$COMMANDER_TMP/writable.json"; then
  echo 'runner allowed a writable Commander workspace' >&2
  exit 1
fi
rm -rf "$COMMANDER_TMP"

# Evaluator writes the authoritative mechanical evidence to .brain-result.json.
# The provider-facing summary may reduce checks to strings, so the runner must
# bridge the structured behavior_tests into the callback envelope before POST.
EVIDENCE_BRIDGE="$(sed -n '/evaluator-evidence-bridge:start/,/evaluator-evidence-bridge:end/p' "$ENTRYPOINT")"
[[ -n "$EVIDENCE_BRIDGE" ]] || { echo 'missing evaluator evidence bridge' >&2; exit 1; }
TRUST_BOUNDARY="$(sed -n '/^  PROVIDER_TRUST_BOUNDARY_ENV=(/,/^  )/p' "$ENTRYPOINT")"
for secret in BRAIN_URL HARNESS_CALLBACK_URL HARNESS_CALLBACK_TOKEN \
  HARNESS_LEASE_OWNER HARNESS_LEASE_GENERATION; do
  grep -Fq -- "-u $secret" <<< "$TRUST_BOUNDARY" || {
    echo "evaluator Provider still inherits trusted callback secret: $secret" >&2
    exit 1
  }
done
[[ "$(grep -c '"${PROVIDER_TRUST_BOUNDARY_ENV\[@\]}"' "$ENTRYPOINT")" -eq 3 ]] || {
  echo 'callback secret fence is not applied to every Provider command' >&2
  exit 1
}
eval "$EVIDENCE_BRIDGE"
type prepare_evaluator_evidence >/dev/null 2>&1 || {
  echo 'missing evaluator evidence freshness snapshot' >&2
  exit 1
}
EVIDENCE_TMP="$(mktemp -d)"
trap 'rm -rf "$EVIDENCE_TMP"' EXIT
RUNNER_ASSERTION_TIMEOUT_BIN="$EVIDENCE_TMP/timeout-shim"
cat > "$RUNNER_ASSERTION_TIMEOUT_BIN" <<'SH'
#!/usr/bin/env bash
shift 3
exec "$@"
SH
chmod +x "$RUNNER_ASSERTION_TIMEOUT_BIN"
PROVIDER_IDENTITY_PREFIX=()
RUNTIME_BRAIN_RESULT="$EVIDENCE_TMP/runtime-brain-result.json"
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":["npm test passed"],"decision":{"outcome":"PASS","reason":"verified"}}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-current CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" BRAIN_RESULT_FILE="$RUNTIME_BRAIN_RESULT" prepare_evaluator_evidence
cat > "$RUNTIME_BRAIN_RESULT" <<'JSON'
{"verdict":"PASS","task_id":"task-current","attempt_id":"attempt-current","behavior_tests":[{"command":"npm test","exit_code":0,"log_tail":"12 tests passed"}]}
JSON
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-current CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" BRAIN_RESULT_FILE="$RUNTIME_BRAIN_RESULT" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == [{"command":"npm test","exit_code":0,"log_tail":"12 tests passed"}]' \
  "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'evaluator evidence bridge did not preserve structured behavior_tests' >&2
  exit 1
}

# Impact Contract assertions are executed by the authenticated runner after the
# provider returns. The model cannot manufacture these receipts in its output.
if [[ "${RUNNER_CONTRACT_REAL_IDENTITIES:-0}" == "1" ]]; then
  [[ "$(id -u)" == "0" ]] || {
    echo 'real identity contract requires root' >&2
    exit 1
  }
  PROVIDER_IDENTITY_PREFIX=(
    setpriv --reuid=cecelia --regid=cecelia --init-groups --no-new-privs
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all --
  )
  ASSERTION_IDENTITY_PREFIX=(
    setpriv --reuid=nobody --regid=nogroup --clear-groups --no-new-privs
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all --
  )
  RUNNER_ASSERTION_EXECUTOR=/usr/local/lib/cecelia/assertion-exec.mjs
  RUNNER_ASSERTION_NODE_BIN=/usr/local/bin/node
fi
git -C "$EVIDENCE_TMP" init -q
git -C "$EVIDENCE_TMP" config user.email runner-test@cecelia.local
git -C "$EVIDENCE_TMP" config user.name cecelia-runner-test
printf 'baseline\n' > "$EVIDENCE_TMP/tracked.txt"
mkdir -p "$EVIDENCE_TMP/scripts/smoke"
printf '#!/usr/bin/env bash\nprintf "runner-proof\\n"\n' \
  > "$EVIDENCE_TMP/scripts/smoke/runner-proof.sh"
printf '#!/usr/bin/env bash\nexit 9\n' > "$EVIDENCE_TMP/scripts/smoke/assertion.sh"
printf '#!/usr/bin/env bash\nprintf "failure\\n" >&2\nexit 7\n' \
  > "$EVIDENCE_TMP/scripts/smoke/failure.sh"
git -C "$EVIDENCE_TMP" add tracked.txt scripts/smoke
git -C "$EVIDENCE_TMP" -c core.hooksPath=/dev/null commit -qm baseline
RUNNER_ASSERTION_SHA="$(git -C "$EVIDENCE_TMP" rev-parse HEAD)"
RUNNER_ASSERTIONS_JSON="$(jq -cn '[{
  assertion_id:"scripts/smoke/runner-proof.sh",
  command:"bash scripts/smoke/runner-proof.sh",
  covers_capability_ids:["capability-proof"],
  journey_step_link_id:"11111111-1111-4111-8111-111111111111",
  assertion_revision:1,
  assertion_digest:("a" * 64)
}]')"
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":[],"decision":{"outcome":"PASS","reason":"provider verified"}}
JSON
HARNESS_NODE=evaluator EVALUATOR_EVIDENCE_PREPARED=1 \
  WORKTREE_PATH="$EVIDENCE_TMP" PR_HEAD_SHA="$RUNNER_ASSERTION_SHA" \
  CECELIA_MACHINE_ID=runner-machine HARNESS_CALLBACK_TOKEN=runner-secret \
  HARNESS_REQUIRED_ASSERTIONS_JSON="$RUNNER_ASSERTIONS_JSON" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
EXPECTED_RUNNER_DIGEST="$(printf 'runner-proof\n' | shasum -a 256 | awk '{print $1}')"
jq -e --arg sha "$RUNNER_ASSERTION_SHA" --arg digest "$EXPECTED_RUNNER_DIGEST" '
  .decision.outcome == "PASS"
  and (.checks | length) == 1
  and .checks[0].assertion_id == "scripts/smoke/runner-proof.sh"
  and .checks[0].command_argv == ["bash", "scripts/smoke/runner-proof.sh"]
  and .checks[0].exit_code == 0
  and .checks[0].output_digest == $digest
  and .checks[0].scenario_evidence.pr_head_sha == $sha
  and .checks[0].scenario_evidence.machine == "runner-machine"
  and .checks[0].scenario_evidence.cases == ["scripts/smoke/runner-proof.sh"]
  and (.checks[0].started_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))
  and (.checks[0].completed_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T"))
' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'runner did not execute and bind the required assertion receipt' >&2
  exit 1
}

# Provider 与 assertion 若共用 HOME，登录 shell 会加载 Provider 写入的 profile，
# 从而用假 npx 把不存在的测试伪造成 PASS。Runner 必须使用干净 HOME、固定工具链、
# 非 shell argv 执行，使该攻击稳定 FAIL。
PROVIDER_HOME="$EVIDENCE_TMP/provider-home"
FAKE_BIN="$EVIDENCE_TMP/fake-bin"
mkdir -p "$PROVIDER_HOME" "$FAKE_BIN"
cat > "$FAKE_BIN/npx" <<'SH'
#!/usr/bin/env bash
printf 'FORGED_ASSERTION_TOOL\n'
exit 0
SH
chmod +x "$FAKE_BIN/npx"
printf 'export PATH="%s:$PATH"\n' "$FAKE_BIN" > "$PROVIDER_HOME/.bash_profile"
HOME_POISON_ASSERTIONS_JSON="$(jq -cn '[{
  assertion_id:"packages/brain/src/never-exists.test.js",
  command:"npx vitest run packages/brain/src/never-exists.test.js",
  covers_capability_ids:["capability-proof"],
  journey_step_link_id:"44444444-4444-4444-8444-444444444444",
  assertion_revision:1,
  assertion_digest:("d" * 64)
}]')"
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":[],"decision":{"outcome":"PASS","reason":"provider verified"}}
JSON
HOME="$PROVIDER_HOME" HARNESS_NODE=evaluator EVALUATOR_EVIDENCE_PREPARED=1 \
  WORKTREE_PATH="$EVIDENCE_TMP" PR_HEAD_SHA="$RUNNER_ASSERTION_SHA" \
  CECELIA_MACHINE_ID=runner-machine \
  HARNESS_REQUIRED_ASSERTIONS_JSON="$HOME_POISON_ASSERTIONS_JSON" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '
  .decision.outcome == "FAIL"
  and (.checks | length) == 1
  and .checks[0].assertion_id == "packages/brain/src/never-exists.test.js"
  and .checks[0].exit_code != 0
  and (.checks[0].output_tail | contains("FORGED_ASSERTION_TOOL") | not)
' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'runner trusted Provider-controlled HOME/PATH for required assertions' >&2
  exit 1
}

HIDDEN_MUTATION_ASSERTIONS_JSON="$(jq -cn '[{
  assertion_id:"scripts/smoke/assertion.sh",
  command:"bash scripts/smoke/assertion.sh",
  covers_capability_ids:["capability-proof"],
  journey_step_link_id:"33333333-3333-4333-8333-333333333333",
  assertion_revision:1,
  assertion_digest:("c" * 64)
}]')"
git -C "$EVIDENCE_TMP" update-index --assume-unchanged scripts/smoke/assertion.sh
printf '#!/usr/bin/env bash\nexit 0\n' > "$EVIDENCE_TMP/scripts/smoke/assertion.sh"
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":[],"decision":{"outcome":"PASS","reason":"provider verified"}}
JSON
HARNESS_NODE=evaluator EVALUATOR_EVIDENCE_PREPARED=1 \
  WORKTREE_PATH="$EVIDENCE_TMP" PR_HEAD_SHA="$RUNNER_ASSERTION_SHA" \
  CECELIA_MACHINE_ID=runner-machine \
  HARNESS_REQUIRED_ASSERTIONS_JSON="$HIDDEN_MUTATION_ASSERTIONS_JSON" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '
  .decision.outcome == "FAIL"
  and .checks[0].assertion_id == "scripts/smoke/assertion.sh"
  and .checks[0].exit_code == 9
' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'runner executed an assume-unchanged provider mutation instead of the exact commit' >&2
  exit 1
}
git -C "$EVIDENCE_TMP" update-index --no-assume-unchanged scripts/smoke/assertion.sh
git -C "$EVIDENCE_TMP" restore scripts/smoke/assertion.sh

printf 'provider mutation\n' > "$EVIDENCE_TMP/tracked.txt"
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":[],"decision":{"outcome":"PASS","reason":"provider verified"}}
JSON
HARNESS_NODE=evaluator EVALUATOR_EVIDENCE_PREPARED=1 \
  WORKTREE_PATH="$EVIDENCE_TMP" PR_HEAD_SHA="$RUNNER_ASSERTION_SHA" \
  CECELIA_MACHINE_ID=runner-machine HARNESS_REQUIRED_ASSERTIONS_JSON="$RUNNER_ASSERTIONS_JSON" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '
  .decision.outcome == "FAIL"
  and (.decision.reason | contains("tracked files"))
  and .checks == []
' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'runner executed required assertions against provider-mutated tracked files' >&2
  exit 1
}
git -C "$EVIDENCE_TMP" restore tracked.txt

cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":[],"decision":{"outcome":"PASS","reason":"provider verified"}}
JSON
HARNESS_NODE=evaluator EVALUATOR_EVIDENCE_PREPARED=1 \
  WORKTREE_PATH="$EVIDENCE_TMP" PR_HEAD_SHA="$RUNNER_ASSERTION_SHA" \
  CECELIA_MACHINE_ID=runner-machine HARNESS_REQUIRED_ASSERTIONS_JSON='{"malformed":true}' \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '
  .decision.outcome == "FAIL"
  and (.decision.reason | contains("payload is invalid"))
' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'runner failed open on malformed required assertion input' >&2
  exit 1
}

FAILING_ASSERTIONS_JSON="$(jq -cn '[{
  assertion_id:"scripts/smoke/failure.sh",
  command:"bash scripts/smoke/failure.sh",
  covers_capability_ids:["capability-proof"],
  journey_step_link_id:"22222222-2222-4222-8222-222222222222",
  assertion_revision:1,
  assertion_digest:("b" * 64)
}]')"
cat > "$EVIDENCE_TMP/result.json" <<'JSON'
{"status":"completed","checks":[],"decision":{"outcome":"PASS","reason":"provider verified"}}
JSON
HARNESS_NODE=evaluator EVALUATOR_EVIDENCE_PREPARED=1 \
  WORKTREE_PATH="$EVIDENCE_TMP" PR_HEAD_SHA="$RUNNER_ASSERTION_SHA" \
  CECELIA_MACHINE_ID=runner-machine HARNESS_REQUIRED_ASSERTIONS_JSON="$FAILING_ASSERTIONS_JSON" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '
  .decision.outcome == "FAIL"
  and (.decision.reason | contains("scripts/smoke/failure.sh"))
  and .checks[0].exit_code == 7
' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'runner allowed a failed required assertion to retain PASS' >&2
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

node - "$EVALUATOR_SKILL" <<'NODE' || {
const fs = require('node:fs');
const match = fs.readFileSync(process.argv[2], 'utf8').match(/^version:\s*(\d+)\.(\d+)\.(\d+)$/m);
if (!match) process.exit(1);
const actual = match.slice(1).map(Number);
const minimum = [1, 35, 1];
for (let index = 0; index < minimum.length; index += 1) {
  if (actual[index] > minimum[index]) process.exit(0);
  if (actual[index] < minimum[index]) process.exit(1);
}
NODE
  echo 'harness-evaluator skill version was not bumped for attempt-bound evidence' >&2
  exit 1
}
grep -q 'HARNESS_ATTEMPT_ID' "$EVALUATOR_SKILL" || {
  echo 'harness-evaluator skill does not emit attempt-bound evidence' >&2
  exit 1
}
grep -Fq 'RESULT_FILE="${BRAIN_RESULT_FILE:-$WORKSPACE/.brain-result.json}"' \
  "$EVALUATOR_SKILL" || {
  echo 'harness-evaluator skill does not honor the injected result file' >&2
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
WORKSPACE="$EVIDENCE_TMP" RESULT_FILE="$RUNTIME_BRAIN_RESULT" \
  TASK_ID=task-current HARNESS_ATTEMPT_ID=attempt-skill \
  TARGET_ENV=local_api E2E_EXECUTION_FILE="$EVIDENCE_TMP/evaluator-execution.json" \
  E2E_RESULT_LOG="$EVIDENCE_TMP/e2e-result.log" SCREENSHOTS_JSON='[]' CASCADE_ASSERTIONS='[]' \
  eval "$RESULT_WRITER"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-skill CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" BRAIN_RESULT_FILE="$RUNTIME_BRAIN_RESULT" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
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
WORKSPACE="$EVIDENCE_TMP" RESULT_FILE="$RUNTIME_BRAIN_RESULT" \
  TASK_ID=task-current HARNESS_ATTEMPT_ID=attempt-skill \
  TARGET_ENV=local_api E2E_EXECUTION_FILE="$EVIDENCE_TMP/evaluator-execution.json" \
  E2E_RESULT_LOG="$EVIDENCE_TMP/e2e-result.log" SCREENSHOTS_JSON='[]' CASCADE_ASSERTIONS='[]' \
  eval "$RESULT_WRITER"
HARNESS_NODE=evaluator HARNESS_ATTEMPT_ID=attempt-skill CECELIA_TASK_ID=task-current \
  WORKTREE_PATH="$EVIDENCE_TMP" BRAIN_RESULT_FILE="$RUNTIME_BRAIN_RESULT" \
  merge_evaluator_evidence "$EVIDENCE_TMP/result.json"
jq -e '.checks == ["provider summary"]' "$EVIDENCE_TMP/result.json" >/dev/null || {
  echo 'harness-evaluator PASS writer accepted foreign execution metadata' >&2
  exit 1
}
# The runner's provider-facing schema must emit decisions accepted by the Brain
# callback parser. A permissive object here caused real planner callbacks to 400.
# 案卷式 GAN（r36 根因修复）：rubric_scores 并入 decision 的 required——OpenAI
# strict output 要求"声明即必填"，GAN 角色填 7 维分数、其余角色填 null。
grep -q '"required":\["outcome","reason","rubric_scores"\]' <<<"$SECTION"
# Codex structured output uses OpenAI strict JSON Schema. Every object must be
# closed and must require each declared property; arrays must declare items.
RESULT_SCHEMA_JSON="$EVALUATOR_SCHEMA"
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
# Heartbeats are a single generation-fenced transport contract shared by the
# provider session, provider runtime, evaluator preflight, and callback retry
# paths. Do not regress to role-local endpoint construction inside this section.
[[ "$(grep -c '/heartbeat' "$ENTRYPOINT")" -eq 1 ]] || {
  echo 'runner must define exactly one centralized heartbeat endpoint' >&2
  exit 1
}
grep -q '^build_attempt_heartbeat_body()' "$ENTRYPOINT"
grep -q '^post_attempt_heartbeat()' "$ENTRYPOINT"
[[ "$(grep -Ec '^[[:space:]]+post_attempt_heartbeat( |$)' "$ENTRYPOINT")" -eq 4 ]] || {
  echo 'runner must keep all four production heartbeat callers' >&2
  exit 1
}
grep -q 'post_attempt_heartbeat >/dev/null' <<<"$EVIDENCE_BOUNDARY_SECTION"
grep -q 'post_attempt_heartbeat "\$session"' <<<"$PROVIDER_SESSION_SECTION"
grep -q 'post_attempt_heartbeat >/dev/null' <<<"$SECTION"
grep -q 'post_attempt_heartbeat >/dev/null' <<<"$CALLBACK_SECTION"
grep -q 'lease_generation:\$generation' "$ENTRYPOINT"
grep -q 'build_attempt_heartbeat_body' <<<"$HEARTBEAT_SECTION"
grep -q 'HARNESS_LEASE_OWNER' <<<"$HEARTBEAT_SECTION"
grep -q 'HARNESS_CALLBACK_TOKEN' <<<"$HEARTBEAT_SECTION"
grep -q 'Authorization: Bearer' <<<"$HEARTBEAT_SECTION"
grep -q '/heartbeat' <<<"$HEARTBEAT_SECTION"
grep -q 'provider_session_id:\$session' "$ENTRYPOINT"
grep -q -- '--session-id' <<<"$SECTION"
grep -q 'HARNESS_READ_ONLY' <<<"$SECTION"
# The Runner container is already the external sandbox. Asking Codex to add its
# own read-only bubblewrap sandbox fails inside Docker because unprivileged user
# namespaces are unavailable. Read-only roles are enforced by the /workspace:ro
# bind mount, so Codex must bypass its nested sandbox for every Kernel attempt.
grep -q -- '--dangerously-bypass-approvals-and-sandbox' <<<"$SECTION"
grep -q 'HARNESS_CANARY' <<<"$SECTION"
grep -q -- '--disable shell_tool' <<<"$SECTION"
grep -q -- '--disable unified_exec' <<<"$SECTION"
grep -q -- '--disable computer_use' <<<"$SECTION"
grep -q -- '--disable in_app_browser' <<<"$SECTION"
grep -q -- '--disable multi_agent' <<<"$SECTION"
grep -q -- '--disable multi_agent_v2' <<<"$SECTION"
grep -q -- '--disable hooks' <<<"$SECTION"
grep -q -- '--disable goals' <<<"$SECTION"
grep -q -- '--ignore-user-config' <<<"$SECTION"
grep -q -- '-u HARNESS_CALLBACK_TOKEN' <<<"$SECTION"
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
