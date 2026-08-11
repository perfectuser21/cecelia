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
    recordCallbackTerminal: vi.fn(),
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
import {
  replayProductConvergence,
} from '../../../packages/brain/src/orchestrator/counters.js';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const RUN_ID = '80000000-0000-4000-8000-000000000008';
const TASK_ID = '90000000-0000-4000-8000-000000000009';
const ATTEMPT_ID = 'a0000000-0000-4000-8000-00000000000a';
const CALLBACK_TOKEN = 'generator-callback-token';
const LEASE_OWNER = 'stub-generator:1';
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/1';
const SHA = '1111111111111111111111111111111111111111';
const VERIFIED_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const UPPERCASE_VERIFIED_SHA = VERIFIED_SHA.toUpperCase();
const SHORT_SHA = 'abc1234';
const FAKE_SHA = 'ffffffffffffffffffffffffffffffffffffffff';

function callbackRowFromResult(result, triggerSha = SHA) {
  const pullRequest = result.artifacts.find((artifact) => (
    artifact?.type === 'pull_request'
    && artifact.verification_status === 'verified'
  ));
  if (!pullRequest) return null;
  return {
    action: 'verdict:generator-fix-callback',
    observed: {
      attempt_id: ATTEMPT_ID,
      trigger_hop: runtime.attempt.hop,
      pr_head_sha: pullRequest.head_sha,
      provider: result.provider_metadata.provider,
    },
    detail: {
      attempt_id: ATTEMPT_ID,
      pr_head_sha: pullRequest.head_sha,
      status: result.status,
      verification_status: 'verified',
      trigger_sha: triggerSha,
    },
  };
}

function callbackResult({ artifactSha = null, decisionSha = null, providerSha = null } = {}) {
  return {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'generator completed',
    artifacts: artifactSha
      ? [{ type: 'pull_request', url: PR_URL, head_sha: artifactSha }]
      : [],
    checks: [],
    decision: decisionSha ? { pr_head_sha: decisionSha } : null,
    error: null,
    provider_metadata: {
      provider: 'codex',
      session_id: 'generator-session',
      ...(providerSha ? { pr_head_sha: providerSha } : {}),
    },
  };
}

function mountCallbackRouter({ resolver }) {
  const app = express();
  app.use(express.json());
  app.set('pool', runtime.pool);
  app.set('kernelPrIdentityResolver', async (url) => ({
    head_sha: await resolver(url),
    head_ref: `cp-fleet-generator-${ATTEMPT_ID.slice(0, 8)}`,
  }));
  app.use('/api/brain', callbackRouter);
  return app;
}

async function postCallback(app, result) {
  return request(app)
    .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
    .set('Authorization', `Bearer ${CALLBACK_TOKEN}`)
    .set('X-Harness-Lease-Owner', LEASE_OWNER)
    .set('X-Harness-Lease-Generation', '0')
    .send(result);
}

function installCallbackPersistence({
  callbackRows,
  prUrl = PR_URL,
  triggerSha = SHA,
}) {
  runtime.pool.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes('FROM initiative_runs r')) {
      return {
        rows: [{
          pr_url: prUrl,
          task_id: TASK_ID,
          payload: { base_repo: 'perfectuser21/cecelia' },
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("action='spawn:generator-fix'")) {
      return { rows: [{ trigger_sha: triggerSha }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  runtime.store.recordCallbackTerminal.mockImplementation(async ({ result }) => {
    const callbackRow = callbackRowFromResult(result, triggerSha);
    if (callbackRow) callbackRows.push(callbackRow);
    return {
      attempt: { ...runtime.attempt, status: result.status, result },
      deduped: false,
    };
  });
}

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
      url: PR_URL,
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
      lease_generation: 0,
      requested_machine_id: 'us-mac-m4',
      actual_machine_id: 'us-mac-m4',
      execution_transport: 'local-docker',
      remote_job_id: null,
      machine_attestation_status: 'local',
      callback_secret_hash: createHash('sha256').update(CALLBACK_TOKEN).digest('hex'),
      task_bundle: {
        inputs: {
          workspace_spec: {
            repo: 'perfectuser21/cecelia',
            branch: `cp-fleet-generator-${ATTEMPT_ID.slice(0, 8)}`,
          },
        },
      },
    };
    runtime.store.getById.mockResolvedValue(runtime.attempt);
    runtime.store.recordCallbackTerminal.mockImplementation(async ({ result }) => ({
      attempt: { ...runtime.attempt, status: result.status, result },
      deduped: false,
    }));
  });

  test('real loop→derive→dispatch→HTTP callback detects same SHA despite next-hop provider change', async () => {
    const decisionLog = [];
    const resolver = vi.fn(async () => SHA);
    const app = mountCallbackRouter({ resolver });
    let failureReason = null;
    runtime.pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM initiative_runs r')) {
        return {
          rows: [{
            pr_url: PR_URL,
            task_id: TASK_ID,
            payload: { base_repo: 'perfectuser21/cecelia' },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT deadline_at')) {
        return { rows: [{ deadline_at: new Date(Date.now() + 120 * 60 * 1000) }] };
      }
      if (sql.includes("action='spawn:generator-fix'")) {
        return { rows: [{ trigger_sha: SHA }], rowCount: 1 };
      }
      if (sql.includes('UPDATE initiative_runs') && sql.includes('failure_reason')) {
        failureReason = params[1];
      }
      return { rows: [], rowCount: 1 };
    });
    runtime.store.recordCallbackTerminal.mockImplementation(async ({ result: callback }) => {
      const callbackRow = callbackRowFromResult(callback, SHA);
      if (callbackRow) {
        decisionLog.push({
          hop: decisionLog.reduce((max, row) => Math.max(max, row.hop), 0) + 1,
          ...callbackRow,
        });
      }
      return {
        attempt: { ...runtime.attempt, status: callback.status, result: callback },
        deduped: false,
      };
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
      impactGate: {
        beforeGenerate: async () => ({
          allowed: true,
          gate: 'pass',
          stage: 'structure',
        }),
      },
      finalizeRun: async (_pool, input) => {
        failureReason = input.reason;
        expect(input).toMatchObject({
          runId: RUN_ID,
          expectedTaskId: TASK_ID,
          outcome: 'failed',
        });
      },
      dispatch: async () => {
        dispatches += 1;
        if (dispatches > 1) throw new Error('no_progress_not_detected');
        const response = await request(app)
          .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
          .set('Authorization', `Bearer ${CALLBACK_TOKEN}`)
          .set('X-Harness-Lease-Owner', LEASE_OWNER)
          .set('X-Harness-Lease-Generation', '0')
          .send({
            contract_version: '1.0',
            attempt_id: ATTEMPT_ID,
            status: 'completed',
            summary: 'generator completed without advancing the PR',
            artifacts: [{
              type: 'pull_request',
              url: PR_URL,
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

    expect(decisionLog.find((row) => row.action === 'spawn:generator-fix')?.observed)
      .toMatchObject({ trigger_sha: SHA });
    expect(decisionLog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'verdict:generator-fix-callback',
        observed: expect.objectContaining({ pr_head_sha: SHA }),
      }),
    ]));
    expect(result.exitReason).toBe('no_progress_same_sha');
    expect(failureReason).toBe('no_progress_same_sha');
    expect(dispatches).toBe(1);
  });

  test('uppercase artifact SHA is stored only as the lowercase resolver-confirmed head', async () => {
    const callbackRows = [];
    const resolver = vi.fn(async () => VERIFIED_SHA);
    installCallbackPersistence({ callbackRows });
    const app = mountCallbackRouter({ resolver });

    const response = await postCallback(
      app,
      callbackResult({ artifactSha: UPPERCASE_VERIFIED_SHA }),
    );

    expect(response.status).toBe(200);
    expect(callbackRows).toHaveLength(1);
    expect(callbackRows[0]).toMatchObject({
      observed: {
        trigger_hop: runtime.attempt.hop,
        pr_head_sha: VERIFIED_SHA,
      },
      detail: {
        pr_head_sha: VERIFIED_SHA,
        verification_status: 'verified',
      },
    });
    expect(JSON.stringify(callbackRows[0])).not.toContain(UPPERCASE_VERIFIED_SHA);
    expect(resolver).toHaveBeenCalledWith(PR_URL);
  });

  test('short decision SHA is ignored in favor of the server-observed pull request head', async () => {
    const callbackRows = [];
    const resolver = vi.fn(async () => VERIFIED_SHA);
    installCallbackPersistence({ callbackRows });
    const app = mountCallbackRouter({ resolver });

    const response = await postCallback(
      app,
      callbackResult({ decisionSha: SHORT_SHA }),
    );

    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith(PR_URL);
    expect(callbackRows).toHaveLength(1);
    expect(callbackRows[0]).toMatchObject({
      observed: {
        trigger_hop: runtime.attempt.hop,
        pr_head_sha: VERIFIED_SHA,
      },
      detail: {
        pr_head_sha: VERIFIED_SHA,
        verification_status: 'verified',
      },
    });
  });

  test('fake provider-metadata SHA is ignored in favor of the server-observed head', async () => {
    const callbackRows = [];
    const resolver = vi.fn(async () => SHA);
    installCallbackPersistence({ callbackRows });
    const app = mountCallbackRouter({ resolver });

    const response = await postCallback(
      app,
      callbackResult({ providerSha: FAKE_SHA }),
    );

    expect(response.status).toBe(200);
    expect(callbackRows).toHaveLength(1);
    expect(callbackRows[0]).toMatchObject({
      observed: {
        trigger_hop: runtime.attempt.hop,
        pr_head_sha: SHA,
      },
      detail: {
        pr_head_sha: SHA,
        verification_status: 'verified',
      },
    });
    expect(JSON.stringify(callbackRows[0])).not.toContain(FAKE_SHA);
    expect(resolver).toHaveBeenCalledWith(PR_URL);
  });

  test('current head advanced beyond the trigger stores the server-observed head as progress', async () => {
    const callbackRows = [];
    const resolver = vi.fn(async () => VERIFIED_SHA);
    installCallbackPersistence({ callbackRows });
    const app = mountCallbackRouter({ resolver });

    const response = await postCallback(
      app,
      callbackResult({ artifactSha: FAKE_SHA }),
    );

    expect(response.status).toBe(200);
    expect(callbackRows).toHaveLength(1);
    expect(callbackRows[0]).toMatchObject({
      observed: {
        trigger_hop: runtime.attempt.hop,
        pr_head_sha: VERIFIED_SHA,
      },
      detail: {
        pr_head_sha: VERIFIED_SHA,
        verification_status: 'verified',
      },
    });
    expect(callbackRows[0].detail).not.toHaveProperty('no_progress_reason');
  });

  test('missing run pr_url still verifies the callback artifact against GitHub identity', async () => {
    const callbackRows = [];
    const resolver = vi.fn(async () => VERIFIED_SHA);
    installCallbackPersistence({ callbackRows, prUrl: null });
    const app = mountCallbackRouter({ resolver });

    const response = await postCallback(
      app,
      callbackResult({ artifactSha: VERIFIED_SHA }),
    );

    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith(PR_URL);
    expect(callbackRows[0]).toMatchObject({
      detail: {
        pr_head_sha: VERIFIED_SHA,
        verification_status: 'verified',
      },
    });
    expect(callbackRows[0].detail).not.toHaveProperty('no_progress_reason');
  });

  test('resolver transport failure keeps the callback retryable and writes no terminal state', async () => {
    const callbackRows = [];
    const resolver = vi.fn(async () => {
      throw new Error('GitHub rate limited');
    });
    installCallbackPersistence({ callbackRows });
    const app = mountCallbackRouter({ resolver });

    const response = await postCallback(
      app,
      callbackResult({ artifactSha: VERIFIED_SHA }),
    );

    expect(response.status).toBe(503);
    expect(callbackRows).toHaveLength(0);
    expect(runtime.store.recordCallbackTerminal).not.toHaveBeenCalled();
  });

  test('a verified callback followed by update-branch continues on the new current head', () => {
    const callbackSha = '2222222222222222222222222222222222222222';
    const currentHeadSha = '3333333333333333333333333333333333333333';
    const result = replayProductConvergence([
      {
        hop: 1,
        action: 'spawn:generator-fix',
        observed: {
          trigger_sha: SHA,
          failure_class: 'product_failure',
        },
        detail: { reason: 'ci_fail' },
      },
      {
        hop: 2,
        action: 'verdict:generator-fix-callback',
        observed: { trigger_hop: 1, pr_head_sha: callbackSha },
        detail: {
          pr_head_sha: callbackSha,
          verification_status: 'verified',
        },
      },
    ], {
      currentFailureSet: null,
      currentHeadSha,
    });

    expect(result).toEqual({
      outcome: 'continue',
      reason: 'verified_new_sha',
    });
  });

  test('a pending intermediate claim continues when GitHub confirms a newer head', () => {
    const claimedSha = '2222222222222222222222222222222222222222';
    const currentHeadSha = '3333333333333333333333333333333333333333';
    const result = replayProductConvergence([
      {
        hop: 1,
        action: 'spawn:generator-fix',
        observed: {
          trigger_sha: SHA,
          failure_class: 'product_failure',
        },
        detail: { reason: 'ci_fail' },
      },
      {
        hop: 2,
        action: 'verdict:generator-fix-callback',
        observed: { trigger_hop: 1, pr_head_sha: SHA },
        detail: {
          pr_head_sha: SHA,
          claimed_pr_head_sha: claimedSha,
          verification_status: 'verification_pending',
        },
      },
    ], {
      currentFailureSet: null,
      currentHeadSha,
    });

    expect(result).toEqual({
      outcome: 'continue',
      reason: 'verified_new_sha',
    });
  });
});
