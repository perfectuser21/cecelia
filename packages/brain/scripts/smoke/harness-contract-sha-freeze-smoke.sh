#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
TMP_REPO=$(mktemp -d)
trap 'rm -rf "$TMP_REPO"' EXIT

git -C "$TMP_REPO" init -q
git -C "$TMP_REPO" config user.email smoke@example.com
git -C "$TMP_REPO" config user.name Smoke
printf 'approved\n' > "$TMP_REPO/contract.md"
git -C "$TMP_REPO" add contract.md
git -C "$TMP_REPO" -c core.hooksPath=/dev/null commit -qm approved
APPROVED_SHA=$(git -C "$TMP_REPO" rev-parse HEAD)
printf 'moved\n' > "$TMP_REPO/contract.md"
git -C "$TMP_REPO" -c core.hooksPath=/dev/null commit -qam moved

node --input-type=module - "$REPO_ROOT" "$TMP_REPO" "$APPROVED_SHA" <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , repoRoot, tempRepo, approvedSha] = process.argv;
const moduleUrl = pathToFileURL(path.join(
  repoRoot,
  'packages/brain/src/orchestrator/git-artifact-reader.js',
));
const { readGitArtifact } = await import(moduleUrl);
if (readGitArtifact(approvedSha, 'contract.md', { cwd: tempRepo }) !== 'approved\n') {
  throw new Error('approved SHA did not preserve the reviewed contract');
}
let rejected = false;
try {
  readGitArtifact(approvedSha, '../contract.md', { cwd: tempRepo });
} catch (error) {
  rejected = /repository-relative/.test(error.message);
}
if (!rejected) throw new Error('unsafe repository path was accepted');
NODE

grep -q 'ganLatestRoundContractSha' "$REPO_ROOT/packages/brain/src/orchestrator/loop.js"
grep -q 'contract_sha' "$REPO_ROOT/packages/brain/src/routes/harness-callback.js"
echo 'harness contract SHA freeze smoke: OK'
