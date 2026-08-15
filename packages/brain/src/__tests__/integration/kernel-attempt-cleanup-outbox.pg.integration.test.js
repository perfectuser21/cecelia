import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { finalizeKernelRun } from '../../orchestrator/kernel-run-store.js';
import { terminalizeRunsForTask } from '../../lib/harness-run-guard.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_attempt_cleanup_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function seedRun({ phase = 'planning' } = {}) {
  const taskId = randomUUID();
  const runId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id,title,status)
     VALUES ($1,$2,'in_progress')`,
    [taskId, `cleanup outbox integration ${taskId}`],
  );
  await seedOwnedActiveV2Run(testPool, { runId, taskId, phase });
  return { taskId, runId };
}

async function seedRunningAttempt({ runId, hop = 1, leaseGeneration = 7 }) {
  const attemptId = randomUUID();
  const machineId = `cleanup-worker-${randomUUID()}`;
  await createAttemptStore(testPool).createAttempt({
    id: attemptId,
    runId,
    hop,
    phase: 'generate',
    role: 'generator',
    provider: 'codex',
    machineId,
    callbackSecretHash: 'a'.repeat(64),
    bundle: { inputs: { task: 'cleanup outbox integration' } },
  });
  await testPool.query(
    `UPDATE harness_attempts
        SET status='running',
            lease_owner='worker:old-authority',
            lease_generation=$2,
            lease_expires_at=NOW()+INTERVAL '3 minutes',
            actual_machine_id=$3,
            execution_transport='remote-bridge',
            remote_job_id=$4
      WHERE id=$1`,
    [attemptId, leaseGeneration, machineId, `job-${attemptId}`],
  );
  return { attemptId, machineId, leaseGeneration };
}

async function loadAttemptAndIntent(attemptId) {
  const attempt = await testPool.query(
    `SELECT status,error_code,error_message,lease_owner,lease_generation
       FROM harness_attempts
      WHERE id=$1`,
    [attemptId],
  );
  const intent = await testPool.query(
    `SELECT run_id,attempt_id,target_machine_id,execution_transport,
            remote_job_id,lease_owner,lease_generation,cleanup_cause,
            cleanup_cause_message,status
       FROM harness_attempt_cleanup_outbox
      WHERE attempt_id=$1`,
    [attemptId],
  );
  return { attempt: attempt.rows[0], intents: intent.rows };
}

beforeAll(async () => {
  databaseName = `kernel_attempt_cleanup_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 6 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe('Kernel attempt cleanup outbox on real PostgreSQL', () => {
  it('direct run failure cancels active attempt and snapshots OLD cleanup authority', async () => {
    const { taskId, runId } = await seedRun();
    const seeded = await seedRunningAttempt({ runId });

    await expect(terminalizeRunsForTask(testPool, taskId, 'direct_terminal'))
      .resolves.toEqual({ ok: true, terminalized: 1 });

    const state = await loadAttemptAndIntent(seeded.attemptId);
    expect(state.attempt).toMatchObject({
      status: 'cancelled',
      error_code: 'parent_run_terminal',
      lease_owner: null,
      lease_generation: seeded.leaseGeneration,
    });
    expect(state.intents).toEqual([expect.objectContaining({
      run_id: runId,
      attempt_id: seeded.attemptId,
      target_machine_id: seeded.machineId,
      execution_transport: 'remote-bridge',
      remote_job_id: `job-${seeded.attemptId}`,
      lease_owner: 'worker:old-authority',
      lease_generation: seeded.leaseGeneration,
      cleanup_cause: 'parent_run_terminal',
      cleanup_cause_message: 'parent run terminal',
      status: 'pending',
    })]);
  });

  it('canonical finalize emits one cleanup intent even when repeated', async () => {
    const { taskId, runId } = await seedRun();
    const seeded = await seedRunningAttempt({ runId, leaseGeneration: 11 });

    await finalizeKernelRun(testPool, {
      runId,
      expectedTaskId: taskId,
      outcome: 'failed',
      reason: 'canonical_cleanup',
    });
    await finalizeKernelRun(testPool, {
      runId,
      expectedTaskId: taskId,
      outcome: 'failed',
      reason: 'canonical_cleanup',
    });

    const state = await loadAttemptAndIntent(seeded.attemptId);
    expect(state.attempt.status).toBe('cancelled');
    expect(state.intents).toHaveLength(1);
    expect(state.intents[0]).toMatchObject({
      lease_owner: 'worker:old-authority',
      lease_generation: 11,
      cleanup_cause: 'parent_run_terminal',
    });
  });

  it('rolls back run, attempt, and cleanup intent together', async () => {
    const { runId } = await seedRun();
    const seeded = await seedRunningAttempt({ runId, leaseGeneration: 13 });
    const transactionClient = await testPool.connect();
    try {
      await transactionClient.query('BEGIN');
      await transactionClient.query(
        `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
        [runId],
      );
      await transactionClient.query('SET CONSTRAINTS ALL IMMEDIATE');
      expect((await transactionClient.query(
        'SELECT status FROM harness_attempts WHERE id=$1',
        [seeded.attemptId],
      )).rows[0].status).toBe('cancelled');
      expect((await transactionClient.query(
        'SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
        [seeded.attemptId],
      )).rows[0].count).toBe(1);
      await transactionClient.query('ROLLBACK');
    } finally {
      transactionClient.release();
    }

    expect((await testPool.query(
      'SELECT phase FROM initiative_runs WHERE id=$1',
      [runId],
    )).rows[0].phase).toBe('planning');
    expect((await testPool.query(
      'SELECT status,lease_owner FROM harness_attempts WHERE id=$1',
      [seeded.attemptId],
    )).rows[0]).toMatchObject({ status: 'running', lease_owner: 'worker:old-authority' });
    expect((await testPool.query(
      'SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
      [seeded.attemptId],
    )).rows[0].count).toBe(0);
  });

  it('creator-first overlap lets deferred terminalization cancel the committed attempt', async () => {
    const { runId } = await seedRun();
    const creatorClient = await testPool.connect();
    const terminalClient = await testPool.connect();
    const terminalPid = (await terminalClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const attemptId = randomUUID();
    let creatorCommitted = false;
    let terminalCommitted = false;
    try {
      await creatorClient.query('BEGIN');
      await createAttemptStore(creatorClient, { transactionClient: true }).createAttempt({
        id: attemptId,
        runId,
        hop: 1,
        phase: 'generate',
        role: 'generator',
        provider: 'codex',
        machineId: `race-worker-${randomUUID()}`,
        callbackSecretHash: 'b'.repeat(64),
        bundle: {},
      });
      await terminalClient.query('BEGIN');
      await terminalClient.query(
        `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
        [runId],
      );
      const terminalCommit = terminalClient.query('COMMIT');

      let terminalWaitedForCreator = false;
      for (let check = 0; check < 200; check += 1) {
        const activity = await testPool.query(
          `SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1`,
          [terminalPid],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock'
            && activity.rows[0]?.wait_event === 'transactionid') {
          terminalWaitedForCreator = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      await creatorClient.query('COMMIT');
      creatorCommitted = true;
      await terminalCommit;
      terminalCommitted = true;

      expect(terminalWaitedForCreator).toBe(true);
      expect((await testPool.query(
        `SELECT COUNT(*)::int AS count FROM harness_attempts
          WHERE run_id=$1 AND status IN ('queued','starting','running')`,
        [runId],
      )).rows[0].count).toBe(0);
      expect((await testPool.query(
        `SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox
          WHERE attempt_id=$1`,
        [attemptId],
      )).rows[0].count).toBe(1);
    } finally {
      if (!creatorCommitted) await creatorClient.query('ROLLBACK').catch(() => {});
      if (!terminalCommitted) await terminalClient.query('ROLLBACK').catch(() => {});
      creatorClient.release();
      terminalClient.release();
    }
  }, 15_000);

  it('terminal-first overlap makes a later creator observe the terminal run', async () => {
    const { runId } = await seedRun();
    const seeded = await seedRunningAttempt({ runId, leaseGeneration: 19 });
    const terminalClient = await testPool.connect();
    const creatorClient = await testPool.connect();
    const terminalPid = (await terminalClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const creatorPid = (await creatorClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const nextAttemptId = randomUUID();
    let terminalCommitted = false;
    let creatorSettled = false;
    await testPool.query(`
      CREATE OR REPLACE FUNCTION pause_cleanup_outbox_insert()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.attempt_id = '${seeded.attemptId}'::uuid THEN
          PERFORM pg_sleep(1);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER pause_cleanup_outbox_insert
      BEFORE INSERT ON harness_attempt_cleanup_outbox
      FOR EACH ROW EXECUTE FUNCTION pause_cleanup_outbox_insert();
    `);
    try {
      await terminalClient.query('BEGIN');
      await terminalClient.query(
        `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
        [runId],
      );
      const terminalCommit = terminalClient.query('COMMIT');

      let terminalReachedDeferredCleanup = false;
      for (let check = 0; check < 200; check += 1) {
        const activity = await testPool.query(
          `SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1`,
          [terminalPid],
        );
        if (activity.rows[0]?.wait_event_type === 'Timeout'
            && activity.rows[0]?.wait_event === 'PgSleep') {
          terminalReachedDeferredCleanup = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      await creatorClient.query('BEGIN');
      const creation = createAttemptStore(creatorClient, { transactionClient: true })
        .createAttempt({
          id: nextAttemptId,
          runId,
          hop: 2,
          phase: 'generate',
          role: 'generator',
          provider: 'codex',
          machineId: `terminal-first-worker-${randomUUID()}`,
          callbackSecretHash: 'c'.repeat(64),
          bundle: {},
        })
        .then(
          (value) => ({ status: 'fulfilled', value }),
          (error) => ({ status: 'rejected', error }),
        );
      let creatorWaitedForTerminal = false;
      for (let check = 0; check < 200; check += 1) {
        const activity = await testPool.query(
          `SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1`,
          [creatorPid],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock') {
          creatorWaitedForTerminal = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      await terminalCommit;
      terminalCommitted = true;
      const result = await creation;
      creatorSettled = true;
      await creatorClient.query('ROLLBACK');

      expect(terminalReachedDeferredCleanup).toBe(true);
      expect(creatorWaitedForTerminal).toBe(true);
      expect(result.status).toBe('rejected');
      expect(result.error?.code).toBe('23514');
      expect(result.error?.message).toBe(`attempt_parent_run_terminal:${runId}`);
      expect((await testPool.query(
        `SELECT COUNT(*)::int AS count FROM harness_attempts
          WHERE run_id=$1 AND status IN ('queued','starting','running')`,
        [runId],
      )).rows[0].count).toBe(0);
    } finally {
      if (!terminalCommitted) await terminalClient.query('ROLLBACK').catch(() => {});
      if (!creatorSettled) await creatorClient.query('ROLLBACK').catch(() => {});
      terminalClient.release();
      creatorClient.release();
      await testPool.query(
        'DROP TRIGGER IF EXISTS pause_cleanup_outbox_insert ON harness_attempt_cleanup_outbox',
      ).catch(() => {});
      await testPool.query('DROP FUNCTION IF EXISTS pause_cleanup_outbox_insert()').catch(() => {});
    }
  }, 15_000);

  it('rejects reviving a cancelled attempt under a terminal v2 run', async () => {
    const { runId } = await seedRun();
    const seeded = await seedRunningAttempt({ runId, leaseGeneration: 23 });
    await testPool.query(
      `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
      [runId],
    );

    await expect(testPool.query(
      `UPDATE harness_attempts SET status='queued',updated_at=NOW() WHERE id=$1`,
      [seeded.attemptId],
    )).rejects.toMatchObject({
      code: '23514',
      message: `attempt_parent_run_terminal:${runId}`,
    });
    expect((await testPool.query(
      'SELECT status FROM harness_attempts WHERE id=$1',
      [seeded.attemptId],
    )).rows[0].status).toBe('cancelled');
  });

  it.each(['completed', 'failed'])(
    'allows %s history insertion under a terminal v2 run',
    async (status) => {
      const { runId } = await seedRun();
      await testPool.query(
        `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
        [runId],
      );
      const attemptId = randomUUID();

      await expect(testPool.query(
        `INSERT INTO harness_attempts (
           id,run_id,hop,phase,role,provider,task_bundle,status,
           callback_secret_hash,completed_at
         ) VALUES ($1,$2,1,'generate','generator','codex','{}'::jsonb,$3,$4,NOW())`,
        [attemptId, runId, status, 'd'.repeat(64)],
      )).resolves.toMatchObject({ rowCount: 1 });
      expect((await testPool.query(
        'SELECT status FROM harness_attempts WHERE id=$1',
        [attemptId],
      )).rows[0].status).toBe(status);
    },
  );

  it('rejects identity mutation and deletion before confirmation', async () => {
    const { runId } = await seedRun();
    const seeded = await seedRunningAttempt({ runId, leaseGeneration: 17 });
    await testPool.query(
      `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
      [runId],
    );

    await expect(testPool.query(
      `UPDATE harness_attempt_cleanup_outbox SET lease_owner='forged' WHERE attempt_id=$1`,
      [seeded.attemptId],
    )).rejects.toThrow(/cleanup_outbox_identity_immutable/);
    await expect(testPool.query(
      'DELETE FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
      [seeded.attemptId],
    )).rejects.toThrow(/cleanup_outbox_delete_forbidden/);

    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='leased',claim_owner='cleanup-worker',
              claim_generation=claim_generation+1,
              claim_expires_at=NOW()+INTERVAL '1 minute',updated_at=NOW()
        WHERE attempt_id=$1`,
      [seeded.attemptId],
    );
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='confirmed',receipt='{"removed":true}'::jsonb,
              confirmed_at=NOW(),updated_at=NOW()
        WHERE attempt_id=$1`,
      [seeded.attemptId],
    );
    await expect(testPool.query(
      'DELETE FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
      [seeded.attemptId],
    )).rejects.toThrow(/cleanup_outbox_delete_forbidden/);
    expect((await testPool.query(
      'SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
      [seeded.attemptId],
    )).rows[0].count).toBe(1);
  });
});
