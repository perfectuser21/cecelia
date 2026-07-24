#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BRAIN_DIR"

node --input-type=module <<'NODE'
import { validateIndependentJudgeStageFacts } from './src/harness-judge.js';

const base = {
  current_stage: 'independent_judge',
  pr_state: 'OPEN',
  pr_merged: false,
  head_sha: 'a'.repeat(40),
  merge_gate_approved: false,
};

function assert(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

assert('open current head enters independent judge', validateIndependentJudgeStageFacts(base).pass);
assert(
  'premature merge is rejected',
  !validateIndependentJudgeStageFacts({ ...base, pr_merged: true }).pass
);
assert(
  'premature merge-gate approval is rejected',
  !validateIndependentJudgeStageFacts({ ...base, merge_gate_approved: true }).pass
);
NODE
