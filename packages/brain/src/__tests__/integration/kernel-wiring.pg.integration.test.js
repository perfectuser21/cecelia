import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { deriveCounters } from '../../orchestrator/counters.js';
import { derive } from '../../orchestrator/derive.js';
import { collectGroundTruth } from '../../orchestrator/ground-truth.js';
import { createKernelHandlers } from '../../orchestrator/kernel-handlers.js';
import { runLoop } from '../../orchestrator/loop.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import callbackRouter, { appendAttemptVerdict } from '../../routes/harness-callback.js';
import approvalRouter from '../../routes/harness-kernel-approvals.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const APPROVER_TOKEN = 'kernel-pg-approval-token';
const CALLBACK_TOKEN = 'kernel-pg-callback-token';
const LEASE_OWNER = 'kernel-pg-generator:1';
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4226';
const HEAD_SHA = 'a'.repeat(40);

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_wiring_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_wiring_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 10 });
}

async function dropIsolatedDatabase() {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`);
  }
  if (adminPool) await adminPool.end();
}

async function seedRun({ reviewRequired = false, ci = 'pass' } = {}) {
  const initiativeId = randomUUID();
  const contractId = randomUUID();
  const taskId = randomUUID();
  const runId = randomUUID();
  const payload = {
    harness_runtime: 'kernel-v1',
    sprint_dir: 'sprints/07231527-relay-50170af2',
    worktree_path: '/workspace',
    review_required: reviewRequired,
    executor: 'codex',
    test_ci: ci,
  };
  await testPool.query(
    `INSERT INTO initiative_contracts
       (id, initiative_id, version, status, prd_content, contract_content, approved_at)
     VALUES ($1, $2, 1, 'approved', 'prd', 'contract', NOW())`,
    [contractId, initiativeId],
  );
  await testPool.query(
    `INSERT INTO tasks
       (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [taskId, `kernel-pg-${taskId}`, JSON.stringify(payload)],
  );
  await testPool.query(
    `INSERT INTO initiative_runs
       (id, initiative_id, contract_id, phase, current_task_id, pr_url,
        orchestrator_version, deadline_at)
     VALUES ($1, $2, $3, 'evaluate', $4, $5, 'v2', NOW() + INTERVAL '120 minutes')`,
    [runId, initiativeId, contractId, taskId, PR_URL],
  );
  return { initiativeId, contractId, taskId, runId, payload };
}

async function appendLog(runId, {
  hop,
  action,
  observed = {},
  phase = 'evaluate',
  gateVerdict = null,
  detail = null,
}) {
  await testPool.query(
    `INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb)`,
    [
      runId,
      hop,
      JSON.stringify(observed),
      phase,
      gateVerdict,
      action,
      detail == null ? null : JSON.stringify(detail),
    ],
  );
}

function externalObservation({ ci = 'pass', headSha = HEAD_SHA } = {}) {
  return {
    execCmd(command) {
      if (command.startsWith('gh pr view ')) {
        const state = ci === 'pass' ? 'SUCCESS' : (ci === 'fail' ? 'FAILURE' : 'PENDING');
        return JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefOid: headSha,
          statusCheckRollup: [{ state }],
        });
      }
      if (command.startsWith('git ls-remote ')) return '';
      if (command.startsWith('docker ps ')) return '';
      throw new Error(`unexpected external observation command: ${command}`);
    },
    fileExists(filePath) {
      return filePath.endsWith('/sprint-prd.md');
    },
    readFile() {
      return '';
    },
    listHostPids: async () => [],
  };
}

function loopDeps(options = {}) {
  return {
    pool: testPool,
    ...externalObservation(options),
    writeHeartbeat: async (db, heartbeat) => {
      await db.query(
        `UPDATE initiative_runs
            SET orchestrator_heartbeat_at=$2, orchestrator_host=$3, orchestrator_pid=$4
          WHERE id=$1`,
        [heartbeat.runId, heartbeat.now, heartbeat.host, heartbeat.pid],
      );
    },
    now: () => new Date(),
    host: 'kernel-pg-test',
    pid: process.pid,
    log: () => {},
  };
}

async function setTaskStatus(taskId, status) {
  await testPool.query('UPDATE tasks SET status=$2, updated_at=NOW() WHERE id=$1', [taskId, status]);
}

async function collect(run, options = {}) {
  return collectGroundTruth(
    { pool: testPool, ...externalObservation(options), listHostPids: async () => [] },
    {
      taskId: run.taskId,
      runId: run.runId,
      prdPath: `${run.payload.sprint_dir}/sprint-prd.md`,
      callbackResultPath: '.kernel-pg-no-callback-file',
    },
  );
}

beforeAll(createIsolatedDatabase, 30_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('Kernel restart recovery on real PostgreSQL decision log', () => {
  it.each(['BLOCKED', 'NEEDS_CONTEXT'])(
    'instance B resumes the persisted %s streak from instance A',
    async (status) => {
      const run = await seedRun();
      await appendLog(run.runId, {
        hop: 1,
        action: 'verdict:evaluate',
        observed: { pr: { head_sha: HEAD_SHA } },
        gateVerdict: 'deny:evaluate_fail',
        detail: {
          verdict: 'FAIL',
          pr_head_sha: HEAD_SHA,
          failure_class: 'product_failure',
        },
      });

      const instanceA = await runLoop({
        ...loopDeps(),
        sleep: async () => {},
        dispatch: async () => {
          await setTaskStatus(run.taskId, 'aborted');
          return { status, detail: `instance-a-${status}` };
        },
      }, { taskId: run.taskId, runId: run.runId });
      expect(instanceA.exitReason).toBe('task_aborted');

      await setTaskStatus(run.taskId, 'in_progress');
      const instanceB = await runLoop({
        ...loopDeps(),
        sleep: async () => {},
        dispatch: async () => ({ status, detail: `instance-b-${status}` }),
      }, { taskId: run.taskId, runId: run.runId });

      const { rows } = await testPool.query(
        `SELECT hop, action, observed, gate_verdict, detail
           FROM orchestrator_decision_log
          WHERE run_id=$1 ORDER BY hop`,
        [run.runId],
      );
      const results = rows.filter((row) => row.action === 'result:dispatch');
      const secondIntent = rows.find((row) => row.detail?.reason === 'product_failure'
        && row.hop > results[0].hop);
      expect(results.map((row) => row.gate_verdict)).toEqual([
        `deny:${status}`,
        `deny:${status}`,
      ]);
      expect(secondIntent.observed.counters).toMatchObject({
        blockedStreak: 1,
        blockedStatus: status,
      });
      expect(instanceB.exitReason).toBe('blocked_same_state');
      expect((await testPool.query(
        'SELECT failure_reason FROM initiative_runs WHERE id=$1',
        [run.runId],
      )).rows[0].failure_reason).toBe(`blocked_same_state:${status}`);
    },
  );

  it('instance B resumes pollCount from instance A instead of resetting it', async () => {
    const run = await seedRun({ ci: 'pending' });
    await appendLog(run.runId, {
      hop: 1,
      action: 'spawn:generator',
      observed: { pr: { head_sha: HEAD_SHA } },
      phase: 'generate',
      gateVerdict: 'allow',
    });

    const instanceA = await runLoop({
      ...loopDeps({ ci: 'pending' }),
      dispatch: async () => {
        throw new Error('poll must not dispatch');
      },
      sleep: async () => setTaskStatus(run.taskId, 'aborted'),
    }, { taskId: run.taskId, runId: run.runId });
    expect(instanceA.exitReason).toBe('task_aborted');

    await setTaskStatus(run.taskId, 'in_progress');
    const instanceB = await runLoop({
      ...loopDeps({ ci: 'pending' }),
      dispatch: async () => {
        throw new Error('poll must not dispatch');
      },
      sleep: async () => setTaskStatus(run.taskId, 'aborted'),
    }, { taskId: run.taskId, runId: run.runId });
    expect(instanceB.exitReason).toBe('task_aborted');

    const { rows } = await testPool.query(
      `SELECT hop, observed FROM orchestrator_decision_log
        WHERE run_id=$1 AND action='wait:poll_ci' ORDER BY hop`,
      [run.runId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].observed.counters.pollCount).toBe(1);
  });
});

describe('Kernel failure classifications on real PostgreSQL writers', () => {
  it('preserves evaluator and judge classes independently and derives by judge class', async () => {
    const run = await seedRun();
    const evaluatorAttemptId = randomUUID();
    await appendAttemptVerdict({
      id: evaluatorAttemptId,
      run_id: run.runId,
      role: 'evaluator',
      task_bundle: { inputs: { pull_request: { head_sha: HEAD_SHA } } },
    }, {
      status: 'completed',
      decision: {
        outcome: 'PASS',
        reason: 'evidence accepted with evaluator classification retained',
        failure_class: 'evidence_invalid',
      },
    }, testPool);

    const attemptStore = createAttemptStore(testPool);
    const judgeAttemptId = randomUUID();
    const judgeAttempt = await attemptStore.createAttempt({
      id: judgeAttemptId,
      runId: run.runId,
      hop: 2,
      phase: 'evaluate',
      role: 'judge',
      provider: 'independent-judge',
      bundle: {
        inputs: {
          task_id: run.taskId,
          sprint_dir: run.payload.sprint_dir,
          worktree_path: '/workspace',
        },
      },
      callbackSecretHash: createHash('sha256').update('judge-secret').digest('hex'),
    });
    const handlers = createKernelHandlers({
      pool: testPool,
      attemptStore,
      judgeGate: async () => ({
        judged: true,
        verdict: 'FAIL',
        feedback: 'needs human context',
        failure_class: 'needs_context',
      }),
    });
    await handlers['spawn:judge']({
      runId: run.runId,
      taskId: run.taskId,
      attempt: judgeAttempt,
      bundle: { inputs: { worktree_path: '/workspace', sprint_dir: run.payload.sprint_dir } },
      observed: {
        pr: { head_sha: HEAD_SHA },
        evaluateVerdict: {
          verdict: 'PASS',
          pr_head_sha: HEAD_SHA,
          failure_class: 'evidence_invalid',
        },
        evaluateResult: null,
        callbackResult: null,
      },
    });

    const { rows } = await testPool.query(
      `SELECT action, detail FROM orchestrator_decision_log
        WHERE run_id=$1 AND action IN ('verdict:evaluate','verdict:judge')
        ORDER BY hop`,
      [run.runId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].detail.failure_class).toBe('evidence_invalid');
    expect(rows[1].detail).toMatchObject({
      verdict: 'FAIL',
      failure_class: 'needs_context',
      evaluator_failure_class: 'evidence_invalid',
    });

    const observed = await collect(run);
    const counters = deriveCounters(observed.decisionLog, {
      proposeBranchMaxRn: observed.proposeBranchRn,
    });
    expect(derive({
      ...observed,
      counters: { ...counters, ganCostUsd: Number(observed.run.cost_usd) },
    })).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'needs_context:awaiting_human_review',
    });
  });
});

describe('Kernel no-progress through real loop, attempt store, HTTP callback, and PostgreSQL', () => {
  it('same SHA callback becomes terminal after a new collect despite hop/provider changes', async () => {
    const run = await seedRun();
    await appendLog(run.runId, {
      hop: 1,
      action: 'verdict:evaluate',
      observed: { pr: { head_sha: HEAD_SHA } },
      gateVerdict: 'deny:evaluate_fail',
      detail: {
        verdict: 'FAIL',
        pr_head_sha: HEAD_SHA,
        failure_class: 'product_failure',
      },
    });

    const app = express();
    app.use(express.json());
    app.set('pool', testPool);
    app.use('/api/brain', callbackRouter);
    const attemptStore = createAttemptStore(testPool);
    let dispatchCount = 0;

    const result = await runLoop({
      ...loopDeps(),
      sleep: async () => {},
      dispatch: async (_action, ctx) => {
        dispatchCount += 1;
        const attemptId = randomUUID();
        await attemptStore.createAttempt({
          id: attemptId,
          runId: run.runId,
          hop: ctx.hop,
          phase: 'generate',
          role: 'generator',
          provider: 'grok',
          bundle: {
            inputs: {
              task_id: run.taskId,
              sprint_dir: run.payload.sprint_dir,
              worktree_path: '/workspace',
            },
          },
          callbackSecretHash: createHash('sha256').update(CALLBACK_TOKEN).digest('hex'),
        });
        await attemptStore.markStarting(attemptId, {
          leaseOwner: LEASE_OWNER,
          leaseSeconds: 180,
        });
        await attemptStore.markRunning(attemptId, {
          leaseOwner: LEASE_OWNER,
          providerSessionId: `grok-before-callback-${attemptId}`,
          leaseSeconds: 180,
        });

        const callback = await request(app)
          .post(`/api/brain/harness/attempts/${attemptId}/callback`)
          .set('Authorization', `Bearer ${CALLBACK_TOKEN}`)
          .set('X-Harness-Lease-Owner', LEASE_OWNER)
          .send({
            contract_version: '1.0',
            attempt_id: attemptId,
            status: 'completed',
            summary: 'provider changed but PR SHA did not advance',
            artifacts: [{ type: 'pull_request', url: PR_URL, head_sha: HEAD_SHA }],
            checks: [],
            decision: null,
            error: null,
            provider_metadata: {
              provider: 'grok',
              session_id: `grok-after-callback-${attemptId}`,
            },
          });
        expect(callback.status).toBe(200);
        return { status: 'DONE', detail: 'real HTTP callback completed' };
      },
    }, { taskId: run.taskId, runId: run.runId });

    const { rows } = await testPool.query(
      `SELECT hop, action, observed, detail
         FROM orchestrator_decision_log WHERE run_id=$1 ORDER BY hop`,
      [run.runId],
    );
    expect(rows.filter((row) => row.action === 'spawn:generator-fix')).toHaveLength(1);
    expect(rows.filter((row) => row.action === 'verdict:generator-fix-callback')).toHaveLength(1);
    expect(rows.find((row) => row.action === 'verdict:generator-fix-callback').observed)
      .toMatchObject({
        trigger_hop: rows.find((row) => row.action === 'spawn:generator-fix').hop,
        pr_head_sha: HEAD_SHA,
        provider: 'grok',
      });
    expect(dispatchCount).toBe(1);
    expect(result.exitReason).toBe('no_progress_same_sha');
    expect((await testPool.query(
      'SELECT phase, failure_reason FROM initiative_runs WHERE id=$1',
      [run.runId],
    )).rows[0]).toMatchObject({
      phase: 'failed',
      failure_reason: 'no_progress_same_sha',
    });
  });
});

describe('Kernel approval HTTP route on real PostgreSQL', () => {
  const originalToken = process.env.HARNESS_REVIEW_APPROVER_TOKEN;

  afterAll(() => {
    if (originalToken === undefined) delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
    else process.env.HARNESS_REVIEW_APPROVER_TOKEN = originalToken;
  });

  it('fails closed, rejects stale/concurrent duplicates, writes once, derives merge, and rate-limits', async () => {
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = APPROVER_TOKEN;
    const run = await seedRun({ reviewRequired: true });
    await appendLog(run.runId, {
      hop: 1,
      action: 'verdict:evaluate',
      observed: { pr: { head_sha: HEAD_SHA } },
      gateVerdict: 'allow',
      detail: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
    });
    await appendLog(run.runId, {
      hop: 2,
      action: 'verdict:judge',
      observed: { pr: { head_sha: HEAD_SHA } },
      gateVerdict: 'allow',
      detail: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
    });
    await appendLog(run.runId, {
      hop: 3,
      action: 'effect:human_review_requested',
      observed: { pr: { head_sha: HEAD_SHA } },
      phase: 'review',
      detail: { dispatch_hop: 2 },
    });
    // Deterministically widen the existing check-then-insert race. Both HTTP
    // requests can pass the duplicate SELECT before either INSERT commits.
    // The production fix must serialize before that SELECT; then the loser
    // never reaches this trigger and returns a semantic 409.
    await testPool.query(`
      CREATE OR REPLACE FUNCTION kernel_test_delay_human_review_insert()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'verdict:human_review' THEN
          PERFORM pg_sleep(0.15);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER kernel_test_delay_human_review_insert
        BEFORE INSERT ON orchestrator_decision_log
        FOR EACH ROW EXECUTE FUNCTION kernel_test_delay_human_review_insert()
    `);

    const app = express();
    app.use(express.json());
    app.set('pool', testPool);
    app.set('kernelPrHeadResolver', async () => HEAD_SHA);
    app.use('/api/brain/harness/kernel-reviews', approvalRouter);
    const approve = ({ token = APPROVER_TOKEN, sha = HEAD_SHA } = {}) => {
      const call = request(app)
        .post(`/api/brain/harness/kernel-reviews/${run.runId}/approve`);
      if (token !== null) call.set('x-approver-token', token);
      return call.send({
        task_id: run.taskId,
        pr_head_sha: sha,
        review_request_hop: 3,
        approved_by: 'alex',
      });
    };

    expect((await approve({ token: null })).status).toBe(401);
    expect((await approve({ sha: 'b'.repeat(40) })).status).toBe(409);

    const concurrent = await Promise.all([approve(), approve()]);
    expect.soft(concurrent.map((response) => response.status).sort()).toEqual([202, 409]);
    expect((await approve()).status).toBe(409);

    const approvals = await testPool.query(
      `SELECT hop, observed, detail FROM orchestrator_decision_log
        WHERE run_id=$1 AND action='verdict:human_review'`,
      [run.runId],
    );
    expect(approvals.rows).toHaveLength(1);
    expect(approvals.rows[0].detail).toMatchObject({
      verdict: 'APPROVED',
      approved: true,
      pr_head_sha: HEAD_SHA,
      review_request_hop: 3,
      approved_by: 'alex',
    });

    const observed = await collect(run);
    const counters = deriveCounters(observed.decisionLog, {
      proposeBranchMaxRn: observed.proposeBranchRn,
    });
    expect(derive({
      ...observed,
      counters: { ...counters, ganCostUsd: Number(observed.run.cost_usd) },
    })).toMatchObject({ phase: 'merge', action: 'merge_pr' });

    const burstStatuses = [];
    for (let i = 0; i < 12; i += 1) {
      burstStatuses.push((await approve({ token: 'wrong-token' })).status);
    }
    expect.soft(burstStatuses).toContain(429);
    expect((await testPool.query(
      `SELECT COUNT(*)::int AS count FROM orchestrator_decision_log
        WHERE run_id=$1 AND action='verdict:human_review'`,
      [run.runId],
    )).rows[0].count).toBe(1);
  });
});
