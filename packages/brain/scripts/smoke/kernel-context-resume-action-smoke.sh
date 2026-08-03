#!/usr/bin/env bash
# An answered needs_context checkpoint must retry the exact original spawn action.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT_DIR/packages/brain"

node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { derive } from './src/orchestrator/derive.js';

const callback = {
  hop: 3,
  action: 'verdict:attempt_callback',
  derived_phase: 'generate',
  detail: {
    hop: 1,
    role: 'generator',
    status: 'needs_context',
    failure_class: 'needs_context',
  },
};
const answer = {
  hop: 5,
  action: 'verdict:context_answer',
  detail: {
    callback_hop: 3,
    context_request_hop: 4,
    context_version: 'context-v1:3:attempt-3',
    answer: 'Use the approved rollback policy.',
  },
};
const observed = (action, pr) => ({
  run: { phase: 'generate' },
  task: { status: 'in_progress' },
  prdExists: true,
  contract: { approved: true },
  pr,
  inflight: { containers: [], host_pids: [], attempts: [] },
  lastAgentExit: { code: 0, auth_failed: false },
  proposeBranchRn: 0,
  ganLatestRoundVerdict: null,
  generatorSpawned: true,
  evaluateVerdict: null,
  judgeVerdict: null,
  reviewRequired: false,
  reviewApproved: false,
  counters: {
    hops: 5,
    fixRound: 0,
    pollCount: 0,
    noPushStreak: 0,
    noVerdictStreak: 0,
    ganCostUsd: 0,
  },
  decisionLog: [
    { hop: 1, action, observed: {} },
    callback,
    {
      hop: 4,
      action: 'effect:context_requested',
      detail: { callback_hop: 3, context_version: 'context-v1:3:attempt-3' },
    },
    answer,
  ],
});

assert.deepEqual(derive(observed('spawn:generator', null)), {
  phase: 'generate',
  action: 'spawn:generator',
  reason: 'context_answered_retry',
});
assert.deepEqual(derive(observed('spawn:generator-fix', {
  url: 'https://github.com/perfectuser21/zenithjoy-workspace/pull/1581',
  state: 'OPEN',
  ci: 'pass',
  merged: false,
  head_sha: 'c305f6217da65bb69413c39e621b7e797e0fb189',
})), {
  phase: 'generate',
  action: 'spawn:generator-fix',
  reason: 'context_answered_retry',
});
NODE

echo "KERNEL_CONTEXT_RESUME_ACTION_SMOKE_PASS"
