import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = vi.hoisted(() => {
  const attempts = new Map();
  const state = {
    attempts,
    afterReceipt: null,
  };
  const store = {
    createAttempt: vi.fn(async (input) => {
      const attempt = {
        id: input.id,
        run_id: input.runId,
        hop: input.hop,
        phase: input.phase,
        role: input.role,
        provider: input.provider,
        account_id: input.accountId,
        machine_id: input.machineId,
        callback_secret_hash: input.callbackSecretHash,
        task_bundle: input.bundle,
        status: 'queued',
        lease_generation: 0,
        result: null,
      };
      attempts.set(attempt.id, attempt);
      return attempt;
    }),
    markStarting: vi.fn(async (id, { leaseOwner }) => {
      const attempt = attempts.get(id);
      if (!attempt || attempt.status !== 'queued') return null;
      Object.assign(attempt, {
        status: 'starting',
        lease_owner: leaseOwner,
      });
      return attempt;
    }),
    recordLaunchReceipt: vi.fn(async (id, receipt) => {
      const attempt = attempts.get(id);
      if (!attempt || attempt.lease_owner !== receipt.leaseOwner) return null;
      Object.assign(attempt, {
        actual_machine_id: receipt.actualMachineId,
        execution_transport: receipt.executionTransport,
        remote_job_id: receipt.remoteJobId,
        machine_attestation_status: receipt.attestationStatus,
      });
      const afterReceipt = state.afterReceipt;
      state.afterReceipt = null;
      await afterReceipt?.();
      return attempt;
    }),
    getById: vi.fn(async (id) => attempts.get(id) ?? null),
    assertFreshRoleSession: vi.fn(async () => true),
    complete: vi.fn(async (id, result) => {
      const attempt = attempts.get(id);
      if (!attempt || ['completed', 'failed', 'cancelled'].includes(attempt.status)) {
        return { attempt: null, deduped: true };
      }
      Object.assign(attempt, { status: result.status, result });
      return { attempt, deduped: false };
    }),
    fail: vi.fn(async (id, error) => {
      const attempt = attempts.get(id);
      if (!attempt) return { attempt: null, deduped: true };
      Object.assign(attempt, { status: error.status, error_code: error.code });
      return { attempt, deduped: false };
    }),
    heartbeat: vi.fn(),
    markRunning: vi.fn(),
  };
  state.store = store;
  state.pool = { query: vi.fn() };
  return state;
});

vi.mock('../../db.js', () => ({ default: runtime.pool }));
vi.mock('../attempt-store.js', () => ({
  createAttemptStore: () => runtime.store,
}));
vi.mock('../../lib/harness-thread-lookup.js', () => ({ lookupHarnessThread: vi.fn() }));
vi.mock('../../notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../../lib/harness-orphan-guard.js', () => ({
  handleRelayExitConsistency: vi.fn(async () => ({ action: 'noop' })),
}));

import callbackRouter from '../../routes/harness-callback.js';
import { createDispatcher } from '../dispatcher.js';
import { createKernelHandlers } from '../kernel-handlers.js';
import { runLoop } from '../loop.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_IDS = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const SPRINT_DIR = 'sprints/07220001-kernel-flow';

function runEvaluatorWriterAndBridge(result, { attemptId, command, logTail }) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'kernel-evidence-bridge-'));
  const entrypoint = fileURLToPath(new URL(
    '../../../../../docker/cecelia-runner/entrypoint.sh',
    import.meta.url,
  ));
  const evaluatorSkill = fileURLToPath(new URL(
    '../../../../../packages/workflows/skills/harness-evaluator/SKILL.md',
    import.meta.url,
  ));
  try {
    writeFileSync(path.join(tempDir, 'result.json'), JSON.stringify(result));
    writeFileSync(path.join(tempDir, 'e2e-result.log'), `${logTail}\n`);
    writeFileSync(path.join(tempDir, 'evaluator-execution.json'), JSON.stringify({
      task_id: TASK_ID,
      attempt_id: attemptId,
      command,
      exit_code: 0,
    }));
    execFileSync('bash', ['-c', `
      set -euo pipefail
      BRIDGE="$(sed -n '/evaluator-evidence-bridge:start/,/evaluator-evidence-bridge:end/p' "$1")"
      RESULT_WRITER="$(sed -n '/evaluator-result-writer:start/,/evaluator-result-writer:end/p' "$3")"
      eval "$BRIDGE"
      prepare_evaluator_evidence
      eval "$RESULT_WRITER"
      merge_evaluator_evidence "$2/result.json"
    `, 'bridge-test', entrypoint, tempDir, evaluatorSkill], {
      env: {
        ...process.env,
        HARNESS_NODE: 'evaluator',
        HARNESS_ATTEMPT_ID: attemptId,
        CECELIA_TASK_ID: TASK_ID,
        WORKTREE_PATH: tempDir,
        WORKSPACE: tempDir,
        TASK_ID,
        TARGET_ENV: 'local_api',
        E2E_EXECUTION_FILE: path.join(tempDir, 'evaluator-execution.json'),
        E2E_RESULT_LOG: path.join(tempDir, 'e2e-result.log'),
        SCREENSHOTS_JSON: '[]',
        CASCADE_ASSERTIONS: '[]',
      },
    });
    return JSON.parse(readFileSync(path.join(tempDir, 'result.json'), 'utf8'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function skill(name) {
  return {
    name,
    version: '1.0.0',
    digest: `sha256:${'a'.repeat(64)}`,
    content: `# ${name}\nFollow the frozen contract.`,
  };
}

describe('provider-neutral kernel spawn → callback → next hop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.attempts.clear();
    runtime.afterReceipt = null;
  });

  it('planner 写 sprint PRD 并回调后，attempt 落库且下一 hop 派 proposer', async () => {
    const files = new Set();
    const decisionLog = [];
    const actions = [];
    const task = {
      id: TASK_ID,
      status: 'in_progress',
      title: 'stabilize provider-neutral kernel',
      description: 'exercise the real callback boundary',
      payload: {
        harness_runtime: 'kernel-v1',
        executor: 'codex',
        sprint_dir: SPRINT_DIR,
        worktree_path: '/workspace',
        review_required: false,
      },
    };
    const run = {
      id: RUN_ID,
      initiative_id: TASK_ID,
      current_task_id: TASK_ID,
      phase: 'planning',
      cost_usd: 0,
      contract_id: null,
      pr_url: null,
    };

    runtime.pool.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM initiative_runs WHERE id')) return { rows: [run] };
      if (sql.includes('SELECT * FROM tasks WHERE id')) return { rows: [task] };
      if (sql.includes('FROM orchestrator_decision_log')) return { rows: [...decisionLog] };
      if (sql.includes('FROM account_usage_cache')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    });

    const app = express();
    app.use(express.json());
    app.use('/api/brain', callbackRouter);

    let launchCount = 0;
    const launcher = {
      launch: vi.fn(async ({ attempt, spec, target }) => {
        launchCount += 1;
        if (launchCount === 1) {
          runtime.afterReceipt = async () => {
            files.add(`${SPRINT_DIR}/sprint-prd.md`);
            const callback = await request(app)
              .post(`/api/brain/harness/attempts/${attempt.id}/callback`)
              .set('Authorization', `Bearer ${attempt.callbackSecret}`)
              .set('X-Harness-Lease-Owner', attempt.lease_owner)
              .set('X-Harness-Lease-Generation', String(attempt.lease_generation))
              .send({
                contract_version: '1.0',
                attempt_id: attempt.id,
                status: 'completed',
                summary: 'planner wrote the sprint PRD',
                artifacts: [{ type: 'file', path: `${SPRINT_DIR}/sprint-prd.md` }],
                checks: [],
                decision: null,
                error: null,
                provider_metadata: { provider: spec.provider, session_id: 'thread-planner' },
              });
            expect(callback.status).toBe(200);
          };
        } else {
          runtime.afterReceipt = async () => {
            task.status = 'aborted';
          };
        }
        return Object.freeze({
          actualMachineId: target.machine,
          executionTransport: 'local-docker',
          remoteJobId: null,
          attestationStatus: 'local',
          containerId: `docker-stub-${attempt.id.slice(0, 8)}`,
          jobId: null,
        });
      }),
      cancel: vi.fn(),
    };

    let uuidIndex = 0;
    const realDispatch = createDispatcher({
      randomUUID: () => ATTEMPT_IDS[uuidIndex++],
      machineId: 'integration-host',
      attemptStore: runtime.store,
      loadSkill: skill,
      registry: {
        resolve: () => ({
          name: 'codex',
          start: ({ bundle }) => ({ provider: 'codex', args: ['exec'], env: {}, stdin: bundle.objective }),
        }),
      },
      launcher,
      leaseOwner: 'integration-host:4242',
    });
    const dispatch = vi.fn(async (action, ctx) => {
      actions.push(action);
      return realDispatch(action, ctx);
    });

    let hop = 0;
    const result = await runLoop({
      pool: runtime.pool,
      execCmd: () => '',
      fileExists: (filePath) => files.has(filePath),
      readFile: () => '',
      dispatch,
      nextHop: async () => ++hop,
      appendHop: async (entry) => decisionLog.push(entry),
      writeHeartbeat: async () => {},
      sleep: async () => {},
      now: () => new Date('2026-07-22T00:01:00Z'),
      host: 'integration-host',
      pid: 4242,
    }, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('task_aborted');
    expect(actions.slice(0, 2)).toEqual(['spawn:planner', 'spawn:proposer']);
    expect(runtime.attempts.get(ATTEMPT_IDS[0])).toMatchObject({
      run_id: RUN_ID,
      hop: 1,
      role: 'planner',
      provider: 'codex',
      status: 'completed',
    });
    expect(launcher.launch).toHaveBeenCalledTimes(2);
  });

  it('evaluator 结构化 checks 经 callback 落库后原样进入 judge 机械闸', async () => {
    const evaluatorAttemptId = '55555555-5555-4555-8555-555555555555';
    const judgeAttemptId = '66666666-6666-4666-8666-666666666666';
    const callbackToken = 'evaluator-evidence-token';
    const leaseOwner = 'integration-host:4242';
    const behaviorTests = [
      { command: 'npm test', exit_code: 0, log_tail: '12 tests passed' },
    ];
    runtime.attempts.set(evaluatorAttemptId, {
      id: evaluatorAttemptId,
      run_id: RUN_ID,
      hop: 5,
      role: 'evaluator',
      provider: 'codex',
      status: 'running',
      lease_owner: leaseOwner,
      lease_generation: 0,
      requested_machine_id: 'integration-host',
      actual_machine_id: 'integration-host',
      execution_transport: 'local-docker',
      remote_job_id: null,
      machine_attestation_status: 'local',
      callback_secret_hash: createHash('sha256').update(callbackToken).digest('hex'),
      task_bundle: { inputs: { pull_request: { head_sha: 'sha-evidence' } } },
      result: null,
    });
    runtime.attempts.set(judgeAttemptId, {
      id: judgeAttemptId,
      run_id: RUN_ID,
      hop: 6,
      role: 'judge',
      provider: 'independent-judge',
      status: 'running',
      result: null,
    });
    runtime.pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const bridgedResult = runEvaluatorWriterAndBridge({
      contract_version: '1.0',
      attempt_id: evaluatorAttemptId,
      status: 'completed',
      summary: 'evaluator verified behavior',
      artifacts: [],
      checks: ['provider summary only'],
      decision: { outcome: 'PASS', reason: 'verified' },
      error: null,
      provider_metadata: { provider: 'codex', session_id: 'thread-evaluator' },
    }, {
      attemptId: evaluatorAttemptId,
      command: 'npm test',
      logTail: '12 tests passed',
    });
    expect(bridgedResult.checks).toEqual(behaviorTests);

    const app = express();
    app.use(express.json());
    app.use('/api/brain', callbackRouter);
    const callback = await request(app)
      .post(`/api/brain/harness/attempts/${evaluatorAttemptId}/callback`)
      .set('Authorization', `Bearer ${callbackToken}`)
      .set('X-Harness-Lease-Owner', leaseOwner)
      .set('X-Harness-Lease-Generation', '0')
      .send(bridgedResult);

    expect(callback.status).toBe(200);
    const judgeGate = vi.fn(async () => ({ verdict: 'PASS', feedback: 'grounded', judged: true }));
    const handlers = createKernelHandlers({
      pool: runtime.pool,
      attemptStore: runtime.store,
      judgeGate,
    });
    await handlers['spawn:judge']({
      taskId: TASK_ID,
      runId: RUN_ID,
      attempt: { id: judgeAttemptId },
      bundle: { inputs: { worktree_path: '/workspace', sprint_dir: SPRINT_DIR } },
      observed: {
        pr: { head_sha: 'sha-evidence' },
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-evidence' },
        evaluateResult: runtime.attempts.get(evaluatorAttemptId).result,
      },
    });

    expect(judgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      brainResult: expect.objectContaining({
        verdict: 'PASS',
        behavior_tests: behaviorTests,
      }),
    }), expect.objectContaining({ strict: true, dbPool: runtime.pool }));
  });

});
