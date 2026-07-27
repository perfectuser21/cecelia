import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const mocks = vi.hoisted(() => ({
  store: {
    getById: vi.fn(),
    assertFreshRoleSession: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    heartbeat: vi.fn(),
    markRunning: vi.fn(),
  },
  pool: { query: vi.fn() },
}));

vi.mock('../../../packages/brain/src/orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => mocks.store,
}));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mocks.pool }));
vi.mock('../../../packages/brain/src/lib/harness-thread-lookup.js', () => ({ lookupHarnessThread: vi.fn() }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../../../packages/brain/src/lib/harness-orphan-guard.js', () => ({
  handleRelayExitConsistency: vi.fn(async () => ({ action: 'noop' })),
}));

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const CALLBACK_TOKEN = 'kernel-preview-callback-secret';
const LEASE_OWNER = 'kernel-preview:1';
const HEAD_SHA = 'a'.repeat(40);

function makePool(rows: {
  run?: Record<string, unknown>[];
  task?: Record<string, unknown>[];
  log?: Record<string, unknown>[];
  attempts?: Record<string, unknown>[];
}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM initiative_runs')) return { rows: rows.run ?? [] };
      if (sql.includes('FROM initiative_contracts')) return { rows: [] };
      if (sql.includes('FROM tasks')) return { rows: rows.task ?? [] };
      if (sql.includes("role = 'evaluator'")) return { rows: rows.attempts ?? [] };
      if (sql.includes('FROM harness_attempts')) return { rows: rows.attempts ?? [] };
      if (sql.includes('FROM orchestrator_decision_log')) return { rows: rows.log ?? [] };
      if (sql.includes('FROM account_usage_cache')) return { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
}

function baseObserved(overrides: Record<string, unknown> = {}) {
  return {
    run: { phase: 'review' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: { url: 'https://github.com/perfectuser21/cecelia/pull/4226', state: 'OPEN', ci: 'pass', merged: false, head_sha: HEAD_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
    judgeVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
    reviewRequired: true,
    reviewApproved: true,
    counters: { hops: 3, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

describe('kernel preview ci target-aware authority red contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('忽略 caller-fed authority 字段，collectGroundTruth 必须产出 preview_authority 真相对象', async () => {
    const pool = makePool({
      run: [{ id: RUN_ID, contract_id: null, phase: 'evaluate', pr_url: 'https://github.com/perfectuser21/cecelia/pull/4226', current_task_id: TASK_ID }],
      task: [{ id: TASK_ID, status: 'in_progress', payload: { expected_repo: 'attacker/repo', expected_run: 'fake-run', scenario: { injected: true } } }],
      log: [{ hop: 1, action: 'spawn:evaluator', observed: { pr: { head_sha: HEAD_SHA } }, detail: { record: { fake: true } } }],
      attempts: [],
    });

    const observed = await collectGroundTruth({
      pool,
      execCmd: vi.fn((cmd: string) => {
        if (cmd.startsWith('gh pr view')) {
          return JSON.stringify({
            state: 'OPEN',
            mergeStateStatus: 'CLEAN',
            headRefOid: HEAD_SHA,
            statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS', name: 'preview-ci' }],
          });
        }
        if (cmd.startsWith('docker ps')) return '';
        if (cmd.startsWith('git ls-remote')) return '';
        throw new Error(`unexpected cmd: ${cmd}`);
      }),
      fileExists: vi.fn(() => true),
      readFile: vi.fn(() => ''),
      listHostPids: async () => [],
    }, {
      taskId: TASK_ID,
      runId: RUN_ID,
      prdPath: 'sprints/07272310-kernel-e6eb6c0c/sprint-prd.md',
      callbackResultPath: '/tmp/does-not-exist.json',
    });

    expect((observed as any).preview_authority).toEqual({
      source: 'server_owned',
      current_pr_head_sha: HEAD_SHA,
      ignores_caller_expected_values: true,
    });
  });

  it('每个负例返回唯一 blocker，preview required failure 不得被 local required-context failure 掩盖', () => {
    const decision = derive(baseObserved({
      previewAuthority: {
        stale_check_sha: false,
        missing_required_context: false,
        preview_required_failure: true,
        local_required_context_failure: true,
        missing_context_mapping: false,
        external_infrastructure_failure: false,
      },
    } as any));

    expect(decision).toEqual({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'preview_required_failure',
    });
  });

  it('新 commit 必须同时使 evaluator、judge、human approval 三类 current-SHA authority 失效', () => {
    const decision = derive(baseObserved({
      pr: { url: 'https://github.com/perfectuser21/cecelia/pull/4226', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'b'.repeat(40) },
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
      reviewApproved: true,
      decisionLog: [{
        hop: 7,
        action: 'verdict:human_review',
        observed: { pr: { head_sha: HEAD_SHA } },
        detail: { approved: true, pr_head_sha: HEAD_SHA, review_request_hop: 6 },
      }],
    } as any));

    expect(decision).toEqual({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'draft_authority_invalidated',
    });
  });

  it('callback route 必须拒绝缺少 server-owned workflow identity 绑定的 payload', async () => {
    mocks.store.getById.mockResolvedValue({
      id: ATTEMPT_ID,
      run_id: RUN_ID,
      hop: 4,
      role: 'evaluator',
      provider: 'codex',
      status: 'running',
      lease_owner: LEASE_OWNER,
      requested_machine_id: 'us-mac-m4',
      actual_machine_id: 'us-mac-m4',
      execution_transport: 'local-docker',
      remote_job_id: null,
      machine_attestation_status: 'local',
      callback_secret_hash: createHash('sha256').update(CALLBACK_TOKEN).digest('hex'),
      task_bundle: {
        inputs: {
          contract_round: 1,
          pull_request: { head_sha: HEAD_SHA },
        },
      },
    });
    mocks.store.assertFreshRoleSession.mockResolvedValue(true);
    mocks.store.complete.mockResolvedValue({ attempt: { status: 'completed' }, deduped: false });
    mocks.pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { default: callbackRouter } = await import('../../../packages/brain/src/routes/harness-callback.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain', callbackRouter);

    const response = await request(app)
      .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
      .set('Authorization', `Bearer ${CALLBACK_TOKEN}`)
      .set('X-Harness-Lease-Owner', LEASE_OWNER)
      .send({
        contract_version: '1.0',
        attempt_id: ATTEMPT_ID,
        status: 'completed',
        summary: 'missing authority binding fields',
        artifacts: [],
        checks: [],
        decision: { outcome: 'PASS', reason: 'should still be rejected without route-bound identity proof' },
        error: null,
        provider_metadata: { provider: 'codex', session_id: 'preview-red' },
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      ok: false,
      error: 'missing_server_owned_authority_binding',
    });
  });
});
