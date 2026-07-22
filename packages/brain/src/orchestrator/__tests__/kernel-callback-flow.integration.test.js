import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const runtime = vi.hoisted(() => {
  const attempts = new Map();
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
        result: null,
      };
      attempts.set(attempt.id, attempt);
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
  return {
    attempts,
    store,
    pool: { query: vi.fn() },
  };
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
import { runLoop } from '../loop.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_IDS = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const SPRINT_DIR = 'sprints/07220001-kernel-flow';

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
      launch: vi.fn(async ({ attempt, bundle, spec }) => {
        launchCount += 1;
        if (launchCount === 1) {
          runtime.attempts.get(attempt.id).lease_owner = 'docker-stub-owner';
          files.add(`${SPRINT_DIR}/sprint-prd.md`);
          const callback = await request(app)
            .post(`/api/brain/harness/attempts/${attempt.id}/callback`)
            .set('Authorization', `Bearer ${attempt.callbackSecret}`)
            .set('X-Harness-Lease-Owner', 'docker-stub-owner')
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
        } else {
          task.status = 'aborted';
        }
        return { containerId: `docker-stub-${attempt.id.slice(0, 8)}` };
      }),
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
      appendHop: async (_pool, entry) => decisionLog.push(entry),
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
});
