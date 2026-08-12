#!/usr/bin/env bash
# 验收：批准合同制品从不可变 Git SHA 收集，并由 Runner 物化冻结测试。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SMOKE_ROOT="$(mktemp -d)"
trap 'rm -rf "$SMOKE_ROOT"' EXIT

SOURCE_REPO="$SMOKE_ROOT/source"
WORKSPACE="$SMOKE_ROOT/workspace"
BUNDLE="$SMOKE_ROOT/task-bundle.json"
SPRINT_DIR="sprints/kernel-contract-artifact-smoke"
mkdir -p "$SOURCE_REPO/$SPRINT_DIR/tests" "$WORKSPACE"
printf '%s\n' '# frozen PRD' > "$SOURCE_REPO/$SPRINT_DIR/sprint-prd.md"
printf '%s\n' '# frozen contract' > "$SOURCE_REPO/$SPRINT_DIR/contract-draft.md"
printf '%s\n' '# frozen DoD' > "$SOURCE_REPO/$SPRINT_DIR/contract-dod.md"
printf '%s\n' 'throw new Error("RED until implementation satisfies the contract");' \
  > "$SOURCE_REPO/$SPRINT_DIR/tests/contract.test.js"

git -C "$SOURCE_REPO" init -q
git -C "$SOURCE_REPO" config user.name smoke
git -C "$SOURCE_REPO" config user.email smoke@example.invalid
git -C "$SOURCE_REPO" add .
git -C "$SOURCE_REPO" -c core.hooksPath=/dev/null \
  commit -qm 'test: freeze approved contract artifacts'
SOURCE_REVISION="$(git -C "$SOURCE_REPO" rev-parse HEAD)"

REPO_ROOT="$REPO_ROOT" SOURCE_REPO="$SOURCE_REPO" SOURCE_REVISION="$SOURCE_REVISION" \
SPRINT_DIR="$SPRINT_DIR" BUNDLE="$BUNDLE" node --input-type=module <<'NODE'
import fs from 'node:fs';
const { collectApprovedContractArtifacts } = await import(
  `${process.env.REPO_ROOT}/packages/brain/src/orchestrator/contract-artifacts.js`
);
const { readGitArtifact, listGitArtifacts } = await import(
  `${process.env.REPO_ROOT}/packages/brain/src/orchestrator/git-artifact-reader.js`
);

const sourceRevision = process.env.SOURCE_REVISION;
const sprintDir = process.env.SPRINT_DIR;
const options = { cwd: process.env.SOURCE_REPO };
const collected = collectApprovedContractArtifacts({
  sourceRevision,
  sprintDir,
  readGitFile: (revision, filePath) => readGitArtifact(revision, filePath, options),
  listGitFiles: (revision, prefix) => listGitArtifacts(revision, prefix, options),
});
if (collected.artifacts.length !== 4) throw new Error('expected three core files and one test');
if (!collected.artifacts.every((artifact) => artifact.source_revision === sourceRevision)) {
  throw new Error('artifact source revision drifted');
}
const tests = collected.artifacts
  .filter((artifact) => artifact.path.includes('/tests/'))
  .map((artifact) => ({
    type: 'frozen_contract_test',
    path: artifact.path,
    content: artifact.content,
    sha256: artifact.sha256,
    source_sha: artifact.source_revision,
  }));
fs.writeFileSync(process.env.BUNDLE, JSON.stringify({
  task_bundle: {
    role: 'generator',
    inputs: { sprint_dir: sprintDir, contract: { approved_sha: sourceRevision }, artifacts: tests },
  },
}));
NODE

node "$REPO_ROOT/docker/cecelia-runner/materialize-frozen-contract-artifacts.cjs" \
  "$BUNDLE" "$WORKSPACE"
cmp "$SOURCE_REPO/$SPRINT_DIR/tests/contract.test.js" \
  "$WORKSPACE/$SPRINT_DIR/tests/contract.test.js"
test ! -w "$WORKSPACE/$SPRINT_DIR/tests/contract.test.js"

echo 'kernel contract artifacts smoke: PASS'
