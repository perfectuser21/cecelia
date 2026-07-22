#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENTRYPOINT="$ROOT_DIR/docker/cecelia-runner/entrypoint.sh"
BRIDGE="$(sed -n '/evaluator-evidence-bridge:start/,/evaluator-evidence-bridge:end/p' "$ENTRYPOINT")"

[[ -n "$BRIDGE" ]] || { echo 'FAIL: evaluator evidence bridge missing' >&2; exit 1; }
eval "$BRIDGE"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/evaluator-evidence-bridge.XXXXXX")"
trap '[[ -n "${TMP_DIR:-}" ]] && rm -r "$TMP_DIR"' EXIT

printf '%s\n' \
  '{"status":"completed","checks":["claimed pass"],"decision":{"outcome":"PASS","reason":"verified"}}' \
  > "$TMP_DIR/result.json"
printf '%s\n' \
  '{"verdict":"PASS","behavior_tests":[{"command":"npm test","exit_code":0,"log_tail":"12 tests passed"}]}' \
  > "$TMP_DIR/.brain-result.json"

HARNESS_NODE=evaluator WORKTREE_PATH="$TMP_DIR" merge_evaluator_evidence "$TMP_DIR/result.json"
jq -e '.checks[0].exit_code == 0 and .checks[0].log_tail == "12 tests passed"' \
  "$TMP_DIR/result.json" >/dev/null

cd "$ROOT_DIR"
node --input-type=module <<'NODE'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMechanicalGate } from './packages/brain/src/harness-judge.js';

const root = await mkdtemp(path.join(tmpdir(), 'judge-contract-draft-'));
try {
  const sprintDir = 'sprints/evidence-smoke';
  const sprintRoot = path.join(root, sprintDir);
  await mkdir(sprintRoot, { recursive: true });
  await writeFile(path.join(sprintRoot, 'contract-draft.md'), '- [ ] [BEHAVIOR] manual:bash npm test\n');
  const result = await runMechanicalGate({
    taskId: 'evidence-smoke',
    worktreePath: root,
    sprintDir,
    brainResult: {
      verdict: 'PASS',
      behavior_tests: [{ command: 'npm test', exit_code: 0, log_tail: '12 tests passed' }],
    },
  });
  if (!result.pass) throw new Error(`judge rejected contract-draft evidence: ${result.reasons.join('; ')}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
NODE

echo 'PASS: evaluator evidence survives callback and contract-draft satisfies judge gate'
