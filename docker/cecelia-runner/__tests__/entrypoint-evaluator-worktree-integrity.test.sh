#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
PROVIDER_CONTRACT_TEST="$SCRIPT_DIR/../entrypoint-provider-contract.test.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

guard_block="$(
  sed -n \
    '/^# frozen-baseline-guard:start$/,/^# frozen-baseline-guard:end$/p' \
    "$ENTRYPOINT"
)"
[[ -n "$guard_block" ]] || {
  echo "missing frozen baseline guard implementation" >&2
  exit 1
}
eval "$guard_block"
grep -Fq 'GIT_NO_REPLACE_OBJECTS=1' "$ENTRYPOINT" || {
  echo "Evaluator Provider Git commands are not forced into raw-object mode" >&2
  exit 1
}
if grep -Fq 'fs.readFileSync' <<< "$guard_block"; then
  echo "dependency manifest hashes whole files in memory" >&2
  exit 1
fi
for boundary_token in HARD_MAX_ENTRIES HARD_MAX_TOTAL_BYTES HARD_MAX_FILE_BYTES \
  HARD_MAX_DURATION_MS fs.readSync 'stat.isDirectory()'; do
  grep -Fq "$boundary_token" <<< "$guard_block" || {
    echo "dependency manifest is missing resource boundary: $boundary_token" >&2
    exit 1
  }
done

# A dependency symlink whose resolved target leaves the frozen workspace tree
# can change runtime behavior without changing the recorded link text.
SYMLINK_WORKSPACE="$TEST_ROOT/symlink-workspace"
mkdir -p "$SYMLINK_WORKSPACE/node_modules/dependency"
printf '%s\n' 'exact external dependency' > "$TEST_ROOT/external-runtime.js"
ln -s "$TEST_ROOT/external-runtime.js" \
  "$SYMLINK_WORKSPACE/node_modules/dependency/runtime.js"
if WORKTREE_PATH="$SYMLINK_WORKSPACE" \
    write_frozen_evaluator_dependency_manifest "$TEST_ROOT/symlink-before.manifest" \
      2>/dev/null; then
  printf '%s\n' 'forged external dependency' > "$TEST_ROOT/external-runtime.js"
  grep -q '^forged external dependency$' \
    "$SYMLINK_WORKSPACE/node_modules/dependency/runtime.js"
  WORKTREE_PATH="$SYMLINK_WORKSPACE" \
    write_frozen_evaluator_dependency_manifest "$TEST_ROOT/symlink-after.manifest"
  if cmp -s "$TEST_ROOT/symlink-before.manifest" "$TEST_ROOT/symlink-after.manifest"; then
    echo "dependency manifest accepted mutable content behind an external symlink" >&2
    exit 1
  fi
fi

WORKSPACE="$TEST_ROOT/workspace"
mkdir -p "$WORKSPACE"
git init -q -b main "$WORKSPACE"
git -C "$WORKSPACE" config user.name 'Evaluator Integrity Test'
git -C "$WORKSPACE" config user.email 'evaluator-integrity@example.invalid'
cat > "$WORKSPACE/candidate-test.sh" <<'SH'
#!/usr/bin/env bash
exit 1
SH
cat > "$WORKSPACE/dependency-test.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
grep -q '^forged installed dependency$' \
  packages/app/node_modules/dependency/runtime.js
SH
printf '%s\n' 'tests/generated/' > "$WORKSPACE/.gitignore"
chmod +x "$WORKSPACE/candidate-test.sh" "$WORKSPACE/dependency-test.sh"
git -C "$WORKSPACE" add candidate-test.sh dependency-test.sh .gitignore
git -C "$WORKSPACE" -c core.hooksPath=/dev/null \
  commit -qm 'test: frozen failing candidate'
mkdir -p "$WORKSPACE/packages/app/node_modules/dependency"
chmod 0755 "$WORKSPACE/packages/app/node_modules/dependency"
printf '%s\n' 'exact installed dependency' \
  > "$WORKSPACE/packages/app/node_modules/dependency/runtime.js"
START_SHA="$(git -C "$WORKSPACE" rev-parse HEAD)"

export HARNESS_NODE=evaluator
export HARNESS_FROZEN_BASELINE=true
export HARNESS_WORKSPACE_START_SHA="$START_SHA"
export WORKTREE_PATH="$WORKSPACE"
export FROZEN_BASELINE_GUARD_DIR="$TEST_ROOT/guard"
mkdir -p "$TEST_ROOT/attempt-evidence"
export BRAIN_RESULT_FILE="$TEST_ROOT/attempt-evidence/brain-result.json"
install_frozen_baseline_guard

# The candidate test genuinely fails at the exact candidate commit.
if "$WORKSPACE/candidate-test.sh"; then
  echo "fixture is wrong: original candidate test should fail" >&2
  exit 1
fi
if (cd "$WORKSPACE" && ./dependency-test.sh); then
  echo "fixture is wrong: exact installed dependency should fail the test" >&2
  exit 1
fi

# The untrusted Evaluator edits the tracked test without committing, runs the
# forged green test, and returns PASS while HEAD remains the exact same SHA.
cat > "$WORKSPACE/candidate-test.sh" <<'SH'
#!/usr/bin/env bash
exit 0
SH
"$WORKSPACE/candidate-test.sh"
printf '%s\n' '{"status":"completed","decision":{"outcome":"PASS"}}' \
  > "$TEST_ROOT/provider-result.json"
test "$(git -C "$WORKSPACE" rev-parse HEAD)" = "$START_SHA"

FINAL_RESULT="$TEST_ROOT/final-result.json"
TRUSTED_ASSERTION_MARKER="$TEST_ROOT/trusted-assertion-ran"
if assert_frozen_baseline_lineage; then
  touch "$TRUSTED_ASSERTION_MARKER"
  cp "$TEST_ROOT/provider-result.json" "$FINAL_RESULT"
else
  printf '%s\n' '{"status":"failed","decision":{"outcome":"FAIL"}}' \
    > "$FINAL_RESULT"
fi
test ! -e "$TRUSTED_ASSERTION_MARKER" || {
  echo "runner executed trusted assertions after tracked candidate drift" >&2
  exit 1
}
grep -Fq '"outcome":"FAIL"' "$FINAL_RESULT" || {
  echo "runner retained a PASS receipt after tracked candidate drift" >&2
  exit 1
}
git -C "$WORKSPACE" restore candidate-test.sh

# A writable Git admin directory must not let the Evaluator replace the pinned
# commit with a forged tree. With the index and worktree aligned to that tree,
# ordinary HEAD/diff checks report a false-clean candidate while HEAD still
# prints the exact pinned object name.
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$WORKSPACE/candidate-test.sh"
git -C "$WORKSPACE" add candidate-test.sh
FORGED_TREE="$(git -C "$WORKSPACE" write-tree)"
FORGED_COMMIT="$(printf '%s\n' 'forged evaluator tree' \
  | git -C "$WORKSPACE" commit-tree "$FORGED_TREE" -p "$START_SHA")"
git -C "$WORKSPACE" replace "$START_SHA" "$FORGED_COMMIT"
git -C "$WORKSPACE" read-tree HEAD
test "$(git -C "$WORKSPACE" rev-parse HEAD)" = "$START_SHA"
git -C "$WORKSPACE" diff --cached --quiet --
git -C "$WORKSPACE" diff --quiet --
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted a forged candidate through refs/replace" >&2
  exit 1
fi
git -C "$WORKSPACE" replace -d "$START_SHA" >/dev/null
git -C "$WORKSPACE" read-tree "$START_SHA"
git -C "$WORKSPACE" restore candidate-test.sh

GIT_ADMIN="$(git -C "$WORKSPACE" rev-parse --path-format=absolute --git-dir)"
GIT_COMMON="$(git -C "$WORKSPACE" rev-parse --path-format=absolute --git-common-dir)"
git -C "$WORKSPACE" update-ref refs/heads/provider-admin-drift "$START_SHA"
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted mutable Git refs after identity freeze" >&2
  exit 1
fi
git -C "$WORKSPACE" update-ref -d refs/heads/provider-admin-drift

mkdir -p "$GIT_COMMON/info" "$GIT_COMMON/objects/info"
for GIT_HAZARD in info/grafts shallow objects/info/alternates \
  objects/info/http-alternates; do
  HAZARD_PATH="$GIT_COMMON/$GIT_HAZARD"
  mkdir -p "$(dirname "$HAZARD_PATH")"
  case "$GIT_HAZARD" in
    info/grafts|shallow) printf '%s\n' "$START_SHA" > "$HAZARD_PATH" ;;
    *) printf '%s\n' "$TEST_ROOT/alternate-objects" > "$HAZARD_PATH" ;;
  esac
  if assert_frozen_baseline_lineage >/dev/null 2>&1; then
    echo "runner accepted dangerous Git admin mechanism: $GIT_HAZARD" >&2
    exit 1
  fi
  rm -f "$HAZARD_PATH"
done
if GIT_OBJECT_DIRECTORY="$GIT_ADMIN/objects" \
    assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted an inherited Git object-directory override" >&2
  exit 1
fi

printf '%s\n' 'staged provider mutation' > "$WORKSPACE/candidate-test.sh"
git -C "$WORKSPACE" add candidate-test.sh
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted staged candidate drift" >&2
  exit 1
fi
git -C "$WORKSPACE" restore --staged candidate-test.sh
git -C "$WORKSPACE" restore candidate-test.sh

git -C "$WORKSPACE" update-index --assume-unchanged candidate-test.sh
printf '%s\n' 'assume-unchanged provider mutation' > "$WORKSPACE/candidate-test.sh"
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted assume-unchanged candidate drift" >&2
  exit 1
fi
git -C "$WORKSPACE" update-index --no-assume-unchanged candidate-test.sh
git -C "$WORKSPACE" restore candidate-test.sh

git -C "$WORKSPACE" update-index --skip-worktree candidate-test.sh
printf '%s\n' 'skip-worktree provider mutation' > "$WORKSPACE/candidate-test.sh"
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted skip-worktree candidate drift" >&2
  exit 1
fi
git -C "$WORKSPACE" update-index --no-skip-worktree candidate-test.sh
git -C "$WORKSPACE" restore candidate-test.sh

mkdir -p "$WORKSPACE/tests/generated"
printf '%s\n' 'forged green fixture' > "$WORKSPACE/tests/generated/pass.js"
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted an ignored untracked test fixture" >&2
  exit 1
fi
rm -f "$WORKSPACE/tests/generated/pass.js"
rmdir "$WORKSPACE/tests/generated" "$WORKSPACE/tests"

printf '%s\n' '{"behavior_tests":[]}' > "$BRAIN_RESULT_FILE"
assert_frozen_baseline_lineage || {
  echo "runner rejected allowlisted node_modules or controlled evidence" >&2
  exit 1
}

mkdir -p "$WORKSPACE/packages/app/node_modules/dependency/empty-runtime-hook"
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted a new empty directory inside installed dependencies" >&2
  exit 1
fi
rmdir "$WORKSPACE/packages/app/node_modules/dependency/empty-runtime-hook"

chmod 0700 "$WORKSPACE/packages/app/node_modules/dependency"
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted a dependency directory mode change" >&2
  exit 1
fi
chmod 0755 "$WORKSPACE/packages/app/node_modules/dependency"

WORKSPACE_EVIDENCE="$WORKSPACE/.harness-attempt/evidence.json"
mkdir -p "$(dirname "$WORKSPACE_EVIDENCE")"
printf '%s\n' '{"behavior_tests":[]}' > "$WORKSPACE_EVIDENCE"
if BRAIN_RESULT_FILE="$WORKSPACE_EVIDENCE" \
    assert_frozen_evaluator_candidate_tree pre-provider >/dev/null 2>&1; then
  echo "runner allowed attempt evidence inside the product workspace" >&2
  exit 1
fi
rm -f "$WORKSPACE_EVIDENCE"
rmdir "$(dirname "$WORKSPACE_EVIDENCE")"

printf '%s\n' 'forged installed dependency' \
  > "$WORKSPACE/packages/app/node_modules/dependency/runtime.js"
(cd "$WORKSPACE" && ./dependency-test.sh)
if assert_frozen_baseline_lineage >/dev/null 2>&1; then
  echo "runner accepted an Evaluator-modified installed dependency" >&2
  exit 1
fi
printf '%s\n' 'exact installed dependency' \
  > "$WORKSPACE/packages/app/node_modules/dependency/runtime.js"
assert_frozen_baseline_lineage || {
  echo "runner rejected restored exact installed dependencies" >&2
  exit 1
}

FUTURE_DEADLINE_MS="$((($(date +%s) + 60) * 1000))"
if write_frozen_evaluator_dependency_manifest \
    "$TEST_ROOT/max-entries.manifest" 1 9999999999 9999999999 "$FUTURE_DEADLINE_MS" \
    >/dev/null 2>&1; then
  echo "dependency manifest ignored its total entry limit" >&2
  exit 1
fi
if write_frozen_evaluator_dependency_manifest \
    "$TEST_ROOT/max-total.manifest" 100 1 9999999999 "$FUTURE_DEADLINE_MS" \
    >/dev/null 2>&1; then
  echo "dependency manifest ignored its total byte limit" >&2
  exit 1
fi
if write_frozen_evaluator_dependency_manifest \
    "$TEST_ROOT/max-file.manifest" 100 9999999999 1 "$FUTURE_DEADLINE_MS" \
    >/dev/null 2>&1; then
  echo "dependency manifest ignored its single-file byte limit" >&2
  exit 1
fi
if write_frozen_evaluator_dependency_manifest \
    "$TEST_ROOT/expired.manifest" 100 9999999999 9999999999 1 \
    >/dev/null 2>&1; then
  echo "dependency manifest ignored its deadline" >&2
  exit 1
fi

# A valid Provider PASS receipt cannot recover trust after descendant cleanup
# fails. Execute the actual post-Provider block with marker stubs to prove no
# assertion, artifact materialization, or evidence verification is attempted.
printf '%s\n' '{"status":"completed","decision":{"outcome":"PASS"}}' \
  > "$TEST_ROOT/valid-provider-receipt.json"
jq -e '.status == "completed" and .decision.outcome == "PASS"' \
  "$TEST_ROOT/valid-provider-receipt.json" >/dev/null
POST_PROVIDER_BLOCK="$(
  sed -n \
    '/^  if ! terminate_evaluator_provider_processes; then$/,/^  if \[\[ -n "$heartbeat_pid" \]\]; then$/p' \
    "$ENTRYPOINT" | sed '$d'
)"
[[ -n "$POST_PROVIDER_BLOCK" ]] || {
  echo "missing post-Provider trust boundary" >&2
  exit 1
}
TRUSTED_PATH_MARKER="$TEST_ROOT/trusted-path-ran"
terminate_evaluator_provider_processes() { return 1; }
assert_frozen_baseline_lineage() { touch "$TRUSTED_PATH_MARKER.assert"; return 0; }
node() { touch "$TRUSTED_PATH_MARKER.materialize"; return 0; }
verify_evaluator_evidence_capsule() { touch "$TRUSTED_PATH_MARKER.evidence"; return 0; }
redact_provider_credential_file() { return 0; }
persist_provider_session() { return 0; }
record_codex_credential_mutation() { return 0; }
finalize_proposer_output() { return 0; }
finalize_planner_output() { return 0; }
finalize_generator_candidate() { return 0; }
normalize_provider_success() { touch "$TRUSTED_PATH_MARKER.pass"; }
normalize_provider_failure() { touch "$TRUSTED_PATH_MARKER.failure"; }
merge_evaluator_evidence() { touch "$TRUSTED_PATH_MARKER.merge"; return 0; }
provider_exit=0
frozen_baseline_intact=true
provider_trust_intact=true
STDOUT_FILE="$TEST_ROOT/provider-stdout.log"
task_bundle_file="$TEST_ROOT/task-bundle.json"
result_file="$TEST_ROOT/valid-provider-receipt.json"
NORMALIZED_RESULT_FILE="$TEST_ROOT/normalized-result.json"
HARNESS_ATTEMPT_ID=77777777-7777-4777-8777-777777777777
provider=claude
provider_session_id=""
commander_contract=false
CREDENTIAL_REF=""
CREDENTIAL_COPY_MUTATED=false
provider_cli_exit_code=""
terminal_receipt=""
run_cleanup_failure_fixture() {
  eval "$POST_PROVIDER_BLOCK"
}
run_cleanup_failure_fixture
test "$provider_exit" -eq 1
if [[ "$provider_trust_intact" != "false" ]]; then
  echo "descendant cleanup failure did not irreversibly revoke Provider trust" >&2
  exit 1
fi
test -e "$TRUSTED_PATH_MARKER.failure"
if compgen -G "$TRUSTED_PATH_MARKER.assert" >/dev/null \
    || compgen -G "$TRUSTED_PATH_MARKER.materialize" >/dev/null \
    || compgen -G "$TRUSTED_PATH_MARKER.evidence" >/dev/null \
    || compgen -G "$TRUSTED_PATH_MARKER.pass" >/dev/null \
    || compgen -G "$TRUSTED_PATH_MARKER.merge" >/dev/null; then
  echo "runner executed trusted paths after descendant cleanup failure" >&2
  exit 1
fi

# Candidate drift must be checked immediately after Provider descendants stop,
# before trusted artifacts/evidence or any success receipt can be produced.
TERMINATE_LINE="$(grep -n '^  if ! terminate_evaluator_provider_processes; then' "$ENTRYPOINT" | cut -d: -f1)"
ASSERT_LINE="$(grep -n 'assert_frozen_baseline_lineage; then' "$ENTRYPOINT" | tail -1 | cut -d: -f1)"
POST_MATERIALIZE_LINE="$(grep -n 'materialize-frozen-contract-artifacts.cjs' "$ENTRYPOINT" | tail -1 | cut -d: -f1)"
VERIFY_EVIDENCE_LINE="$(grep -n 'verify_evaluator_evidence_capsule; then' "$ENTRYPOINT" | tail -1 | cut -d: -f1)"
NORMALIZE_LINE="$(grep -n 'normalize_provider_success' "$ENTRYPOINT" | tail -1 | cut -d: -f1)"
MERGE_LINE="$(grep -n 'merge_evaluator_evidence "\$NORMALIZED_RESULT_FILE"' "$ENTRYPOINT" | cut -d: -f1)"
for trusted_line in "$POST_MATERIALIZE_LINE" "$VERIFY_EVIDENCE_LINE" \
  "$NORMALIZE_LINE" "$MERGE_LINE"; do
  if (( ASSERT_LINE <= TERMINATE_LINE || ASSERT_LINE >= trusted_line )); then
    echo "runner checks candidate drift after trusted evidence or PASS processing" >&2
    exit 1
  fi
done

grep -Fq 'bash "$SCRIPT_DIR/__tests__/entrypoint-evaluator-worktree-integrity.test.sh"' \
  "$PROVIDER_CONTRACT_TEST" || {
  echo "evaluator worktree integrity regression is not wired into the CI contract" >&2
  exit 1
}

echo "entrypoint evaluator worktree integrity tests passed"
