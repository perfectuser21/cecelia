import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  attempt: null,
  pool: { query: vi.fn() },
  store: {
    getById: vi.fn(),
    assertFreshRoleSession: vi.fn(async () => true),
    complete: vi.fn(),
    fail: vi.fn(),
    heartbeat: vi.fn(),
    markRunning: vi.fn(),
  },
}));

vi.mock('../../../packages/brain/src/db.js', () => ({ default: runtime.pool }));
vi.mock('../../../packages/brain/src/orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => runtime.store,
}));
vi.mock('../../../packages/brain/src/lib/harness-thread-lookup.js', () => ({
  lookupHarnessThread: vi.fn(),
}));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../../../packages/brain/src/lib/harness-orphan-guard.js', () => ({
  handleRelayExitConsistency: vi.fn(async () => ({ action: 'noop' })),
}));

import callbackRouter from '../../../packages/brain/src/routes/harness-callback.js';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const RUN_ID = '80000000-0000-4000-8000-000000000008';
const TASK_ID = '90000000-0000-4000-8000-000000000009';
const ATTEMPT_ID = 'a0000000-0000-4000-8000-00000000000a';
const CALLBACK_TOKEN = 'generator-callback-token';
const LEASE_OWNER = 'stub-generator:1';
const SHA = 'same-pr-head';

function observed(decisionLog, provider) {
  return {
    run: {
      id: RUN_ID,
      phase: 'evaluate',
      cost_usd: '0',
      deadline_at: new Date(Date.now() + 120 * 60 * 1000),
    },
    task: {
      id: TASK_ID,
      status: 'in_progress',
      payload: { provider, sprint_dir: 'sprints/kernel', worktree_path: '/workspace' },
    },
    prdExists: true,
    contract: { approved: true, id: 'contract-1', row: {} },
    pr: {
      url: 'https://github.com/example/repo/pull/1',
      state: 'OPEN',
      merged: false,
      ci: 'pass',
      head_sha: SHA,
    },
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: {
      verdict: 'FAIL',
      pr_head_sha: SHA,
      failure_class: 'product_failure',
    },
    evaluateResult: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: decisionLog.map((row) => structuredClone(row)),
    authCircuit: [],
    callbackResult: null,
  };
}

describe('kernel wiring: generator fix callback feeds no-progress terminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.attempt = {
      id: ATTEMPT_ID,
      run_id: RUN_ID,
      hop: 1,
      role: 'generator',
      provider: 'codex',
      status: 'running',
      lease_owner: LEASE_OWNER,
      callback_secret_hash: createHash('sha256').update(CALLBACK_TOKEN).digest('hex'),
      task_bundle: { inputs: {} },
    };
    runtime.store.getById.mockResolvedValue(runtime.attempt);
    runtime.store.complete.mockImplementation(async (_id, result) => ({
      attempt: { ...runtime.attempt, status: result.status, result },
      deduped: false,
    }));
  });

  test('real loop→derive→dispatch→HTTP callback detects same SHA despite next-hop provider change', async () => {
    const decisionLog = [];
    const app = express();
    app.use(express.json());
    app.use('/api/brain', callbackRouter);
    let failureReason = null;
    runtime.pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT deadline_at')) {
        return { rows: [{ deadline_at: new Date(Date.now() + 120 * 60 * 1000) }] };
      }
      if (sql.includes("'verdict:generator-fix-callback'")) {
        decisionLog.push({
          hop: decisionLog.reduce((max, row) => Math.max(max, row.hop), 0) + 1,
          action: 'verdict:generator-fix-callback',
          observed: {
            attempt_id: params[2],
            pr_head_sha: params[3],
            provider: params[4],
          },
          detail: { attempt_id: params[2], pr_head_sha: params[3] },
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE initiative_runs') && sql.includes('failure_reason')) {
        failureReason = params[1];
      }
      return { rows: [], rowCount: 1 };
    });

    let collections = 0;
    let dispatches = 0;
    const deps = {
      pool: runtime.pool,
      collectGroundTruth: async () => {
        collections += 1;
        return observed(decisionLog, collections === 1 ? 'codex' : 'claude');
      },
      nextHop: async () => decisionLog.reduce((max, row) => Math.max(max, row.hop), 0) + 1,
      appendHop: async (entry) => {
        decisionLog.push({
          hop: entry.hop,
          action: entry.action,
          observed: structuredClone(entry.observed),
          gate_verdict: entry.gateVerdict,
          detail: structuredClone(entry.detail),
        });
      },
      writeHeartbeat: async () => {},
      sleep: async () => {},
      now: () => new Date(),
      log: () => {},
      dispatch: async () => {
        dispatches += 1;
        if (dispatches > 1) throw new Error('no_progress_not_detected');
        const response = await request(app)
          .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
          .set('Authorization', `Bearer ${CALLBACK_TOKEN}`)
          .set('X-Harness-Lease-Owner', LEASE_OWNER)
          .send({
            contract_version: '1.0',
            attempt_id: ATTEMPT_ID,
            status: 'completed',
            summary: 'generator completed without advancing the PR',
            artifacts: [{
              type: 'pull_request',
              url: 'https://github.com/example/repo/pull/1',
              head_sha: SHA,
            }],
            checks: [],
            decision: null,
            error: null,
            provider_metadata: { provider: 'codex', session_id: 'generator-session' },
          });
        expect(response.status).toBe(200);
        return { status: 'DONE', detail: 'stub generator callback completed' };
      },
    };

    let result;
    try {
      result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    } catch (error) {
      result = { exitReason: error.message };
    }

    expect(result.exitReason).toBe('no_progress_same_sha');
    expect(failureReason).toBe('no_progress_same_sha');
    expect(dispatches).toBe(1);
    expect(decisionLog.find((row) => row.action === 'spawn:generator-fix')?.observed)
      .toMatchObject({ trigger_sha: SHA });
    expect(decisionLog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'verdict:generator-fix-callback',
        observed: expect.objectContaining({ pr_head_sha: SHA }),
      }),
    ]));
  });
});
