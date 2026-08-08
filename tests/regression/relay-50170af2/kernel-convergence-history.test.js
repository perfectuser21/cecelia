/**
 * Product failure-set convergence regression (R2).
 *
 * The tests intentionally exercise the real ground-truth collector, counter
 * replay, pure derive router, and loop effect path. Failure history comes only
 * from append-only decision-log rows; no natural-language feedback is used.
 */
import { describe, expect, test, vi } from 'vitest';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const CONTRACT_ID = '99999999-8888-7777-6666-555555555555';
const PR_URL = 'https://github.com/o/r/pull/4226';
const SHAS = 'abcdef0123456789'.split('').map((digit) => digit.repeat(40));

function normalizeSet(values) {
  if (!Array.isArray(values)) return null;
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function appendVerifiedRound(rows, { triggerSha, nextSha, failureSet }) {
  const normalized = normalizeSet(failureSet);
  const intentHop = rows.length === 0 ? 1 : Number(rows.at(-1).hop) + 1;
  rows.push({
    hop: intentHop,
    action: 'spawn:generator-fix',
    observed: {
      trigger_sha: triggerSha,
      failure_class: 'product_failure',
      failure_set: normalized,
      failure_set_key: normalized == null ? null : JSON.stringify(normalized),
    },
    detail: { reason: 'ci_fail' },
  });
  rows.push({
    hop: intentHop + 1,
    action: 'verdict:generator-fix-callback',
    observed: {
      trigger_hop: intentHop,
      pr_head_sha: nextSha,
    },
    detail: {
      pr_head_sha: nextSha,
      verification_status: 'verified',
    },
  });
  return rows;
}

function observedFor({ rows, sha, failureSet, hops = null }) {
  const counters = deriveCounters(rows, { proposeBranchMaxRn: 0 });
  if (hops != null) counters.hops = hops;
  return {
    run: { id: RUN_ID, phase: 'generate', cost_usd: 0 },
    task: { id: TASK_ID, status: 'in_progress', payload: {} },
    prdExists: true,
    contract: { approved: true, id: CONTRACT_ID, row: {} },
    pr: {
      url: PR_URL,
      state: 'OPEN',
      mergeStateStatus: 'BLOCKED',
      merged: false,
      ci: 'fail',
      head_sha: sha,
      failed_checks: normalizeSet(failureSet),
    },
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false, action: null },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    evaluateResult: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: rows,
    authCircuit: [],
    callbackResult: null,
    noProgress: counters.noProgress,
    noProgressReason: counters.noProgressReason,
    counters: { ...counters, ganCostUsd: 0 },
  };
}

function appendPatienceReview(rows, { sha, failureSet }) {
  const requestHop = Number(rows.at(-1)?.hop ?? 0) + 1;
  const normalized = normalizeSet(failureSet);
  rows.push({
    hop: requestHop,
    action: 'effect:human_review_requested',
    observed: {
      pr: { head_sha: sha },
      review_reason: 'failure_set_patience_exhausted',
      failure_set: normalized,
      failure_set_key: JSON.stringify(normalized),
    },
    detail: {
      review_reason: 'failure_set_patience_exhausted',
      failure_set: normalized,
      failure_set_key: JSON.stringify(normalized),
    },
  });
  rows.push({
    hop: requestHop + 1,
    action: 'verdict:human_review',
    observed: { pr: { head_sha: sha } },
    detail: {
      approved: true,
      pr_head_sha: sha,
      review_request_hop: String(requestHop),
    },
  });
  return rows;
}

function makeGroundTruthDeps(statusCheckRollup) {
  const run = {
    id: RUN_ID,
    contract_id: CONTRACT_ID,
    current_task_id: TASK_ID,
    phase: 'generate',
    pr_url: PR_URL,
    cost_usd: 0,
  };
  return {
    pool: {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM initiative_runs')) return { rows: [run] };
        if (sql.includes('FROM initiative_contracts')) {
          return { rows: [{ id: CONTRACT_ID, status: 'approved' }] };
        }
        if (sql.includes('FROM tasks')) {
          return { rows: [{ id: TASK_ID, status: 'in_progress', payload: {} }] };
        }
        if (sql.includes('FROM harness_attempts')) return { rows: [] };
        if (sql.includes('FROM orchestrator_decision_log')) return { rows: [] };
        if (sql.includes('FROM account_usage_cache')) return { rows: [] };
        if (sql.includes('gan_case_file')) return { rows: [] };
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    },
    execCmd: vi.fn((cmd) => {
      if (cmd.includes('gh pr view')) {
        return JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'BLOCKED',
          headRefOid: SHAS[0],
          statusCheckRollup,
        });
      }
      if (cmd.includes('ls-remote')) return '';
      if (cmd.includes('docker ps')) return '';
      throw new Error(`unexpected command: ${cmd}`);
    }),
    fileExists: vi.fn(() => false),
    readFile: vi.fn(),
  };
}

describe('server-owned structured CI failure set', () => {
  test('collectGroundTruth normalizes failed check names as sorted unique values', async () => {
    const deps = makeGroundTruthDeps([
      { name: ' zeta ', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'alpha', status: 'COMPLETED', conclusion: 'ERROR' },
      { name: 'alpha', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { context: ' context-check ', state: 'TIMED_OUT' },
      { name: 'manual', conclusion: 'ACTION_REQUIRED' },
      { name: 'startup', conclusion: 'STARTUP_FAILURE' },
      { name: 'passing', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'in progress', status: 'IN_PROGRESS', conclusion: '' },
      { name: '   ', conclusion: 'FAILURE' },
    ]);

    const observed = await collectGroundTruth(deps, {
      taskId: TASK_ID,
      runId: RUN_ID,
    });

    // v1.270.10 起：BLOCKED 且仍有 check 未落定（本夹具含 in-progress 行）→
    // ci=pending 等全部落定再裁（防"非 required 已红 + required 在跑"误判 fail）。
    // 本测试主旨是 failed_checks 归一化，不受 ci 裁决时机影响。
    expect(observed.pr.ci).toBe('pending');
    expect(observed.pr.failed_checks).toEqual([
      'alpha',
      'context-check',
      'manual',
      'startup',
      'zeta',
    ]);
  });
});

describe('append-only product convergence replay', () => {
  test('verified new SHA plus a historical-low failure set continues repair', () => {
    const rows = appendVerifiedRound([], {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['lint', 'test-a', 'test-b'],
    });

    expect(derive(observedFor({
      rows,
      sha: SHAS[1],
      failureSet: ['test-a', 'test-b'],
    }))).toMatchObject({
      action: 'spawn:generator-fix',
    });
  });

  test('verified new SHA plus a never-seen set may explore even when it is larger', () => {
    const rows = appendVerifiedRound([], {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['lint'],
    });

    expect(derive(observedFor({
      rows,
      sha: SHAS[1],
      failureSet: ['integration-a', 'integration-b'],
    }))).toMatchObject({
      action: 'spawn:generator-fix',
    });
  });

  test('an exact historical set recurrence pauses for human review, not FAILED', () => {
    const rows = [];
    appendVerifiedRound(rows, {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['lint', 'unit'],
    });
    appendVerifiedRound(rows, {
      triggerSha: SHAS[1],
      nextSha: SHAS[2],
      failureSet: ['integration'],
    });

    const decision = derive(observedFor({
      rows,
      sha: SHAS[2],
      failureSet: ['unit', 'lint'],
    }));

    expect(decision).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
    });
    expect(decision.action).not.toBe('mark_failed');
  });

  test('three consecutive novel structured rounds without a historical low pause for review', () => {
    const rows = [];
    appendVerifiedRound(rows, {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['baseline-a', 'baseline-b'],
    });
    appendVerifiedRound(rows, {
      triggerSha: SHAS[1],
      nextSha: SHAS[2],
      failureSet: ['round-1-a', 'round-1-b', 'round-1-c'],
    });
    appendVerifiedRound(rows, {
      triggerSha: SHAS[2],
      nextSha: SHAS[3],
      failureSet: ['round-2-a', 'round-2-b', 'round-2-c'],
    });

    expect(derive(observedFor({
      rows,
      sha: SHAS[3],
      failureSet: ['round-3-a', 'round-3-b', 'round-3-c'],
    }))).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
    });
  });

  test('an unstructured round accepts only a verified new SHA and does not enter set comparison', () => {
    const rows = appendVerifiedRound([], {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: null,
    });

    expect(derive(observedFor({
      rows,
      sha: SHAS[1],
      failureSet: null,
    }))).toMatchObject({
      action: 'spawn:generator-fix',
    });
  });

  test('legacy callback without verification_status remains a verified new-SHA round', () => {
    const rows = [{
      hop: 1,
      action: 'spawn:generator-fix',
      observed: {
        trigger_sha: SHAS[0],
        failure_class: 'product_failure',
        failure_set: ['lint'],
      },
      detail: { reason: 'ci_fail' },
    }, {
      hop: 2,
      action: 'verdict:generator-fix-callback',
      observed: { trigger_hop: 1, pr_head_sha: SHAS[1] },
      detail: { pr_head_sha: SHAS[1] },
    }];

    expect(derive(observedFor({
      rows,
      sha: SHAS[1],
      failureSet: ['unit'],
    }))).toMatchObject({
      phase: 'generate',
      action: 'spawn:generator-fix',
    });
  });

  test('missing callback waits for one durable observation before a distinct terminal reason', () => {
    const rows = [{
      hop: 1,
      action: 'spawn:generator-fix',
      observed: {
        trigger_sha: SHAS[0],
        failure_class: 'product_failure',
        failure_set: ['lint'],
      },
      detail: { reason: 'ci_fail' },
    }];

    expect(derive(observedFor({
      rows,
      sha: SHAS[0],
      failureSet: ['lint'],
    }))).toMatchObject({
      phase: 'generate',
      action: 'wait:generator_fix_callback',
      reason: 'generator_fix_callback_pending',
    });

    rows.push({
      hop: 2,
      action: 'wait:generator_fix_callback',
      observed: { trigger_hop: 1, pr: { head_sha: SHAS[0] } },
      detail: { reason: 'generator_fix_callback_pending', trigger_hop: 1 },
    });

    expect(derive(observedFor({
      rows,
      sha: SHAS[0],
      failureSet: ['lint'],
    }))).toMatchObject({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'generator_fix_callback_missing_after_observation',
    });
  });

  test('an unstructured round between structured rounds does not consume patience', () => {
    const rows = [];
    appendVerifiedRound(rows, {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['baseline-a', 'baseline-b'],
    });
    appendVerifiedRound(rows, {
      triggerSha: SHAS[1],
      nextSha: SHAS[2],
      failureSet: ['novel-1a', 'novel-1b', 'novel-1c'],
    });
    appendVerifiedRound(rows, {
      triggerSha: SHAS[2],
      nextSha: SHAS[3],
      failureSet: null,
    });

    expect(derive(observedFor({
      rows,
      sha: SHAS[3],
      failureSet: ['novel-2a', 'novel-2b', 'novel-2c'],
    }))).toMatchObject({
      phase: 'generate',
      action: 'spawn:generator-fix',
    });
  });

  test.each([
    ['same SHA', 'verified'],
    ['invalid claimed SHA', 'invalid'],
    ['unverified claimed SHA', 'unverified'],
  ])('%s is an immediate FAILED no-progress outcome', (_label, verificationStatus) => {
    const rows = [{
      hop: 1,
      action: 'spawn:generator-fix',
      observed: {
        trigger_sha: SHAS[0],
        failure_class: 'product_failure',
        failure_set: ['lint'],
        failure_set_key: JSON.stringify(['lint']),
      },
    }, {
      hop: 2,
      action: 'verdict:generator-fix-callback',
      observed: { trigger_hop: 1, pr_head_sha: SHAS[0] },
      detail: {
        pr_head_sha: SHAS[0],
        verification_status: verificationStatus,
        ...(verificationStatus === 'verified'
          ? {}
          : { no_progress_reason: `callback_sha_${verificationStatus}` }),
      },
    }];

    expect(derive(observedFor({
      rows,
      sha: SHAS[0],
      failureSet: ['lint'],
    }))).toMatchObject({
      phase: 'failed',
      action: 'mark_failed',
    });
  });
});

describe('patience approval is a one-shot observation unlock', () => {
  function approvedPatienceRequestHistory() {
    const rows = [];
    appendVerifiedRound(rows, {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['base-a', 'base-b'],
    });
    appendVerifiedRound(rows, {
      triggerSha: SHAS[1],
      nextSha: SHAS[2],
      failureSet: ['novel-1a', 'novel-1b', 'novel-1c'],
    });
    appendVerifiedRound(rows, {
      triggerSha: SHAS[2],
      nextSha: SHAS[3],
      failureSet: ['novel-2a', 'novel-2b', 'novel-2c'],
    });
    appendPatienceReview(rows, {
      sha: SHAS[3],
      failureSet: ['novel-3a', 'novel-3b', 'novel-3c'],
    });
    return rows;
  }

  function approvedPatienceHistory() {
    const rows = approvedPatienceRequestHistory();
    appendVerifiedRound(rows, {
      triggerSha: SHAS[3],
      nextSha: SHAS[4],
      failureSet: ['novel-3a', 'novel-3b', 'novel-3c'],
    });
    return rows;
  }

  test('an approved patience request with no post-approval intent unlocks exactly one fix', () => {
    const rows = approvedPatienceRequestHistory();

    expect(derive(observedFor({
      rows,
      sha: SHAS[3],
      failureSet: ['novel-3a', 'novel-3b', 'novel-3c'],
    }))).toMatchObject({
      phase: 'generate',
      action: 'spawn:generator-fix',
    });
  });

  test('the next structured non-low after approval fails immediately without a second review', () => {
    const rows = approvedPatienceHistory();
    const decision = derive(observedFor({
      rows,
      sha: SHAS[4],
      failureSet: ['novel-4a', 'novel-4b', 'novel-4c'],
    }));

    expect(decision).toMatchObject({
      phase: 'failed',
      action: 'mark_failed',
    });
    expect(decision.action).not.toBe('wait:human_review');
    expect(rows.filter((row) => (
      row.action === 'effect:human_review_requested'
      && row.detail?.review_reason === 'failure_set_patience_exhausted'
    ))).toHaveLength(1);
  });

  test('a historical low immediately after approval restores normal repair routing', () => {
    const rows = approvedPatienceHistory();

    expect(derive(observedFor({
      rows,
      sha: SHAS[4],
      failureSet: ['only-failure-left'],
    }))).toMatchObject({
      phase: 'generate',
      action: 'spawn:generator-fix',
    });
  });
});

describe('loop ordering and human-review side effect', () => {
  test('missing callback writes one observation marker, then terminates without redispatch', async () => {
    const history = [{
      hop: 1,
      action: 'spawn:generator-fix',
      observed: {
        trigger_sha: SHAS[0],
        failure_class: 'product_failure',
        failure_set: ['lint'],
      },
      detail: { reason: 'ci_fail' },
    }];
    const appended = [];
    const deps = {
      pool: { query: vi.fn(async () => ({ rows: [] })) },
      collectGroundTruth: vi.fn(async () => observedFor({
        rows: history,
        sha: SHAS[0],
        failureSet: ['lint'],
      })),
      nextHop: vi.fn(async () => Number(history.at(-1).hop) + 1),
      appendHop: vi.fn(async (entry) => {
        appended.push(entry);
        history.push({ ...entry, hop: entry.hop });
      }),
      writeHeartbeat: vi.fn(async () => {}),
      dispatch: vi.fn(),
      sleep: vi.fn(async () => {}),
      now: vi.fn(() => new Date('2026-07-23T08:00:00Z')),
      log: vi.fn(),
      finalizeRun: vi.fn(async () => ({ changed: true })),
    };

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('generator_fix_callback_missing_after_observation');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.finalizeRun).toHaveBeenCalledWith(deps.pool, {
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      outcome: 'failed',
      reason: 'generator_fix_callback_missing_after_observation',
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      action: 'wait:generator_fix_callback',
      detail: {
        reason: 'generator_fix_callback_pending',
        trigger_hop: 1,
      },
    });
  });

  test('recurrence dispatches Bark/human review and records its effect marker', async () => {
    const history = [];
    appendVerifiedRound(history, {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['lint', 'unit'],
    });
    appendVerifiedRound(history, {
      triggerSha: SHAS[1],
      nextSha: SHAS[2],
      failureSet: ['integration'],
    });
    const recurrence = observedFor({
      rows: history,
      sha: SHAS[2],
      failureSet: ['unit', 'lint'],
    });
    const terminal = {
      ...recurrence,
      run: { ...recurrence.run, phase: 'done' },
    };
    const sequence = [recurrence, terminal];
    let collectIndex = 0;
    let hop = Number(history.at(-1).hop);
    const appended = [];
    const deps = {
      pool: {
        query: vi.fn(async () => ({ rows: [] })),
      },
      collectGroundTruth: vi.fn(async () => sequence[
        Math.min(collectIndex++, sequence.length - 1)
      ]),
      nextHop: vi.fn(async () => ++hop),
      appendHop: vi.fn(async (entry) => appended.push(entry)),
      writeHeartbeat: vi.fn(async () => {}),
      dispatch: vi.fn(async () => ({ status: 'DONE', detail: 'Bark sent' })),
      sleep: vi.fn(async () => {}),
      now: vi.fn(() => new Date('2026-07-23T08:00:00Z')),
      log: vi.fn(),
    };

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledWith(
      'wait:human_review',
      expect.objectContaining({ runId: RUN_ID }),
    );
    expect(appended.map((entry) => entry.action)).toEqual([
      'wait:human_review',
      'effect:human_review_requested',
    ]);
    expect(appended.at(-1).detail).toMatchObject({
      review_reason: 'failure_set_repeated',
    });
  });

  test('convergence recurrence is evaluated before the MAX_HOPS=4096 wide fence', () => {
    const filler = Array.from({ length: 4092 }, (_, index) => ({
      hop: index + 1,
      action: 'wait:poll_ci',
      observed: {},
    }));
    appendVerifiedRound(filler, {
      triggerSha: SHAS[0],
      nextSha: SHAS[1],
      failureSet: ['lint', 'unit'],
    });
    appendVerifiedRound(filler, {
      triggerSha: SHAS[1],
      nextSha: SHAS[2],
      failureSet: ['integration'],
    });

    const decision = derive(observedFor({
      rows: filler,
      sha: SHAS[2],
      failureSet: ['lint', 'unit'],
    }));

    expect(decision).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
    });
    expect(decision.reason).not.toBe('hop_cap');
  });
});
