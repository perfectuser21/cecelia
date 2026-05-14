#!/usr/bin/env bash
# harness-protocol-smoke.sh — 验证 .brain-result.json 协议正确工作
# 不需要真起 Brain，直接调 readBrainResult Node 函数。
# exit 0 = 协议 OK；exit 1 = 协议失败

set -euo pipefail
BRAIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR=$(mktemp -d)
trap "rm -rf '$TMP_DIR'" EXIT

node --input-type=module << NODEJS
import { readBrainResult } from '$BRAIN_ROOT/src/harness-shared.js';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
const d = '$TMP_DIR';

// Test 1: valid proposer result
writeFileSync(join(d, '.brain-result.json'), JSON.stringify({
  propose_branch: 'cp-harness-propose-r1-test1234',
  workstream_count: 2,
  task_plan_path: 'sprints/test/task-plan.json',
}));
const r1 = await readBrainResult(d, ['propose_branch']);
if (r1.propose_branch !== 'cp-harness-propose-r1-test1234') process.exit(1);
console.log('[smoke] PASS: proposer result read correctly');

// Test 2: missing file → throws
rmSync(join(d, '.brain-result.json'));
try {
  await readBrainResult(d, ['verdict']);
  process.exit(1);
} catch (e) {
  if (!e.message.includes('missing_result_file')) process.exit(1);
}
console.log('[smoke] PASS: missing file throws ContractViolation');

// Test 3: reviewer result
writeFileSync(join(d, '.brain-result.json'), JSON.stringify({
  verdict: 'APPROVED',
  rubric_scores: { dod_machineability: 8, scope_match_prd: 8, test_is_red: 8, internal_consistency: 8, risk_registered: 8 },
  feedback: '',
}));
const r3 = await readBrainResult(d, ['verdict', 'rubric_scores']);
if (r3.verdict !== 'APPROVED') process.exit(1);
console.log('[smoke] PASS: reviewer result read correctly');

console.log('[smoke] All checks passed — protocol OK');
NODEJS
