#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MATERIALIZER="$SCRIPT_DIR/../materialize-frozen-contract-artifacts.cjs"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

WORKSPACE="$TEST_ROOT/workspace"
BUNDLE="$TEST_ROOT/bundle.json"
mkdir -p "$WORKSPACE"
CONTENT='throw new Error("RED");'
DIGEST="$(printf '%s' "$CONTENT" | shasum -a 256 | awk '{print $1}')"
SOURCE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
TEST_PATH='sprints/example/tests/red.test.js'

for legacy_role in generator evaluator; do
  jq -n --arg role "$legacy_role" \
    '{task_bundle:{role:$role,inputs:{sprint_dir:"sprints/legacy",contract:null,artifacts:[]}}}' \
    > "$BUNDLE.legacy-$legacy_role"
  node "$MATERIALIZER" "$BUNDLE.legacy-$legacy_role" "$WORKSPACE" || {
    echo "legacy $legacy_role without a frozen contract was rejected" >&2
    exit 1
  }
done

jq -n --arg source "$SOURCE_SHA" \
  '{task_bundle:{role:"generator",inputs:{sprint_dir:"sprints/managed",contract:{approved_sha:$source},artifacts:[]}}}' \
  > "$BUNDLE.managed-missing"
if node "$MATERIALIZER" "$BUNDLE.managed-missing" "$WORKSPACE" 2>/dev/null; then
  echo 'managed contract without frozen tests was accepted as legacy' >&2
  exit 1
fi

jq -n \
  --arg content "$CONTENT" \
  --arg digest "$DIGEST" \
  --arg source "$SOURCE_SHA" \
  --arg path "$TEST_PATH" \
  '{task_bundle:{role:"generator",inputs:{sprint_dir:"sprints/example",contract:{approved_sha:$source},artifacts:[{type:"frozen_contract_test",path:$path,content:$content,sha256:$digest,source_sha:$source}]}}}' \
  > "$BUNDLE"

node "$MATERIALIZER" "$BUNDLE" "$WORKSPACE"
test "$(cat "$WORKSPACE/$TEST_PATH")" = "$CONTENT"

chmod u+w "$WORKSPACE/$TEST_PATH"
printf '%s' 'provider tampering' > "$WORKSPACE/$TEST_PATH"
if node "$MATERIALIZER" "$BUNDLE" "$WORKSPACE" 2>/dev/null; then
  echo 'materializer accepted a divergent frozen test' >&2
  exit 1
fi

rm -f "$WORKSPACE/$TEST_PATH"
jq '.task_bundle.role = "evaluator"' "$BUNDLE" > "$BUNDLE.evaluator"
if node "$MATERIALIZER" "$BUNDLE.evaluator" "$WORKSPACE" 2>/dev/null; then
  echo 'evaluator accepted a PR missing its frozen contract test' >&2
  exit 1
fi

jq '.task_bundle.inputs.artifacts[0].sha256 = ("b" * 64)' "$BUNDLE" > "$BUNDLE.bad-digest"
if node "$MATERIALIZER" "$BUNDLE.bad-digest" "$WORKSPACE" 2>/dev/null; then
  echo 'materializer accepted a forged artifact digest' >&2
  exit 1
fi

# ── contract_artifacts 文档物化（Red 纯净化：r30 结构根因修法）──────────────
DOC_CONTENT='# 合同正文'
DOC_DIGEST="$(printf '%s' "$DOC_CONTENT" | shasum -a 256 | awk '{print $1}')"
DOC_PATH='sprints/example/contract-draft.md'

jq -n \
  --arg content "$CONTENT" --arg digest "$DIGEST" --arg source "$SOURCE_SHA" --arg path "$TEST_PATH" \
  --arg dcontent "$DOC_CONTENT" --arg ddigest "$DOC_DIGEST" --arg dpath "$DOC_PATH" \
  '{task_bundle:{role:"generator",inputs:{sprint_dir:"sprints/example",contract:{approved_sha:$source},
    artifacts:[{type:"frozen_contract_test",path:$path,content:$content,sha256:$digest,source_sha:$source}],
    contract_artifacts:[
      {path:$path,content:$content,sha256:$digest,byte_length:($content|length),source_revision:$source},
      {path:$dpath,content:$dcontent,sha256:$ddigest,byte_length:($dcontent|length),source_revision:$source}
    ]}}}' > "$BUNDLE.docs"

node "$MATERIALIZER" "$BUNDLE.docs" "$WORKSPACE"
test "$(cat "$WORKSPACE/$DOC_PATH")" = "$DOC_CONTENT" || {
  echo 'generator did not materialize the contract document' >&2
  exit 1
}

# 文档漂移 → 拒绝
chmod u+w "$WORKSPACE/$DOC_PATH"
printf '%s' 'provider rewrote the contract' > "$WORKSPACE/$DOC_PATH"
if node "$MATERIALIZER" "$BUNDLE.docs" "$WORKSPACE" 2>/dev/null; then
  echo 'materializer accepted a divergent contract document' >&2
  exit 1
fi

# evaluator 候选缺文档 → 拒绝
rm -f "$WORKSPACE/$DOC_PATH"
jq '.task_bundle.role = "evaluator"' "$BUNDLE.docs" > "$BUNDLE.docs-evaluator"
if node "$MATERIALIZER" "$BUNDLE.docs-evaluator" "$WORKSPACE" 2>/dev/null; then
  echo 'evaluator accepted a candidate missing its contract document' >&2
  exit 1
fi

echo 'entrypoint frozen contract artifacts: PASS'
