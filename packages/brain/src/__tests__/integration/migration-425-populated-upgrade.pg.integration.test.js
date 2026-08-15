import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const migration425 = readFileSync(
  new URL('../../../migrations/425_harness_attempt_cleanup_outbox.sql', import.meta.url),
  'utf8',
);
const rollback425 = readFileSync(
  new URL('../../../migrations/rollback/425_harness_attempt_cleanup_outbox.down.sql', import.meta.url),
  'utf8',
);
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^migration_425_upgrade_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function apply425() {
  const client = await testPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migration425);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function seedTask() {
  const taskId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id,title,status)
     VALUES ($1,$2,'in_progress')`,
    [taskId, `migration 425 upgrade ${taskId}`],
  );
  return taskId;
}

async function seedActiveV2Run() {
  const taskId = await seedTask();
  const runId = randomUUID();
  await seedOwnedActiveV2Run(testPool, { runId, taskId, phase: 'planning' });
  return { taskId, runId };
}

async function seedRunningAttempt({ runId, hop = 1, leaseGeneration = 31 }) {
  const attemptId = randomUUID();
  const machineId = `upgrade-worker-${randomUUID()}`;
  await createAttemptStore(testPool).createAttempt({
    id: attemptId,
    runId,
    hop,
    phase: 'generate',
    role: 'generator',
    provider: 'codex',
    machineId,
    callbackSecretHash: 'e'.repeat(64),
    bundle: {},
  });
  await testPool.query(
    `UPDATE harness_attempts
        SET status='running',lease_owner='worker:upgrade-old',
            lease_generation=$2,lease_expires_at=NOW()+INTERVAL '2 minutes',
            actual_machine_id=$3,execution_transport='remote-bridge',
            remote_job_id=$4
      WHERE id=$1`,
    [attemptId, leaseGeneration, machineId, `upgrade-job-${attemptId}`],
  );
  return { attemptId, machineId, leaseGeneration };
}

async function seedPendingIntent() {
  const { runId } = await seedActiveV2Run();
  const attempt = await seedRunningAttempt({ runId });
  await testPool.query(
    `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
    [runId],
  );
  return { runId, ...attempt };
}

async function expectRejectedInRollback(sql, values, pattern) {
  const client = await testPool.connect();
  try {
    await client.query('BEGIN');
    await expect(client.query(sql, values)).rejects.toThrow(pattern);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

beforeAll(async () => {
  databaseName = `migration_425_upgrade_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 5 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('migration 425 populated upgrade and outbox guards on PostgreSQL', () => {
  it('rolls an empty 425 schema down twice and can restore it', async () => {
    await expect(testPool.query(rollback425)).resolves.toBeDefined();
    await expect(testPool.query(rollback425)).resolves.toBeDefined();
    await apply425();
    await expect(apply425()).resolves.toBeUndefined();
  });

  it('backfills a populated 424 terminal run and preserves OLD attempt authority', async () => {
    await testPool.query(rollback425);
    const taskId = await seedTask();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const machineId = `legacy-worker-${randomUUID()}`;
    try {
      await testPool.query(
        `INSERT INTO initiative_runs (
           id,initiative_id,current_task_id,phase,orchestrator_version,
           created_source,record_trust_status,started_at,updated_at,completed_at
         ) VALUES ($1,$2,$3,'failed','v2','historical_reconstruction',
           'trusted',NOW(),NOW(),NOW())`,
        [runId, randomUUID(), taskId],
      );
      await testPool.query(
        `INSERT INTO harness_attempts (
           id,run_id,hop,phase,role,provider,machine_id,requested_machine_id,
           actual_machine_id,execution_transport,remote_job_id,task_bundle,status,
           callback_secret_hash,lease_owner,lease_generation,lease_expires_at
         ) VALUES ($1,$2,1,'generate','generator','codex',$3,$3,$3,
           'remote-bridge',$4,'{}'::jsonb,'running',$5,'worker:legacy',41,
           NOW()+INTERVAL '2 minutes')`,
        [attemptId, runId, machineId, `legacy-job-${attemptId}`, 'f'.repeat(64)],
      );
      expect((await testPool.query(
        'SELECT status FROM harness_attempts WHERE id=$1',
        [attemptId],
      )).rows[0].status).toBe('running');

      await apply425();

      const beforeReplay = (await testPool.query('SELECT * FROM harness_attempts WHERE id=$1', [attemptId])).rows[0];
      const intentCountBeforeReplay = (await testPool.query('SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1', [attemptId])).rows[0].count;
      await apply425();
      expect((await testPool.query('SELECT * FROM harness_attempts WHERE id=$1', [attemptId])).rows[0]).toEqual(beforeReplay);
      expect((await testPool.query('SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1', [attemptId])).rows[0].count).toBe(intentCountBeforeReplay);

      expect((await testPool.query(
        'SELECT status,error_code,lease_owner FROM harness_attempts WHERE id=$1',
        [attemptId],
      )).rows[0]).toMatchObject({
        status: 'cancelled',
        error_code: 'parent_run_terminal',
        lease_owner: null,
      });
      expect((await testPool.query(
        `SELECT run_id,attempt_id,target_machine_id,lease_owner,lease_generation,
                cleanup_cause,status
           FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1`,
        [attemptId],
      )).rows).toEqual([expect.objectContaining({
        run_id: runId,
        attempt_id: attemptId,
        target_machine_id: machineId,
        lease_owner: 'worker:legacy',
        lease_generation: 41,
        cleanup_cause: 'parent_run_terminal',
        status: 'pending',
      })]);
    } finally {
      const applied = await testPool.query(
        "SELECT 1 FROM schema_version WHERE version='425'",
      );
      if (applied.rowCount === 0) await apply425();
    }
  });

  it('rejects empty, forged-generation, and expired lease claims', async () => {
    const invalidClaims = [
      "status='leased'",
      "status='leased',claim_owner='worker',claim_generation=claim_generation+2,claim_expires_at=NOW()+INTERVAL '1 minute'",
      "status='leased',claim_owner='worker',claim_generation=claim_generation+1,claim_expires_at=NOW()-INTERVAL '1 second'",
    ];
    for (const mutation of invalidClaims) {
      const { attemptId } = await seedPendingIntent();
      await expectRejectedInRollback(
        `UPDATE harness_attempt_cleanup_outbox SET ${mutation} WHERE attempt_id=$1`,
        [attemptId],
        /cleanup_outbox_invalid_lease_claim/,
      );
    }
  });

  it('rejects forged confirmations and accepts a same-claim receipt', async () => {
    const invalidConfirmations = [
      "status='confirmed',confirmed_at=NOW()",
      "status='confirmed',claim_owner='forged',receipt='{}'::jsonb,confirmed_at=NOW()",
      "status='confirmed',claim_generation=claim_generation+1,receipt='{}'::jsonb,confirmed_at=NOW()",
    ];
    for (const mutation of invalidConfirmations) {
      const { attemptId } = await seedPendingIntent();
      await testPool.query(
        `UPDATE harness_attempt_cleanup_outbox
            SET status='leased',claim_owner='worker',
                claim_generation=claim_generation+1,
                claim_expires_at=NOW()+INTERVAL '1 minute'
          WHERE attempt_id=$1`,
        [attemptId],
      );
      await expectRejectedInRollback(
        `UPDATE harness_attempt_cleanup_outbox SET ${mutation} WHERE attempt_id=$1`,
        [attemptId],
        /cleanup_outbox_invalid_confirmation/,
      );
    }

    const { attemptId } = await seedPendingIntent();
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='leased',claim_owner='worker',
              claim_generation=claim_generation+1,
              claim_expires_at=NOW()+INTERVAL '1 minute'
        WHERE attempt_id=$1`,
      [attemptId],
    );
    await expect(testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='confirmed',receipt='{"removed":true}'::jsonb,confirmed_at=NOW()
        WHERE attempt_id=$1`,
      [attemptId],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it('freezes outbox id and rejects deletion while pending or confirmed', async () => {
    const { attemptId } = await seedPendingIntent();
    await expectRejectedInRollback(
      'UPDATE harness_attempt_cleanup_outbox SET id=$2 WHERE attempt_id=$1',
      [attemptId, randomUUID()],
      /cleanup_outbox_identity_immutable/,
    );
    await expectRejectedInRollback(
      'DELETE FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
      [attemptId],
      /cleanup_outbox_delete_forbidden/,
    );
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='leased',claim_owner='worker',
              claim_generation=claim_generation+1,
              claim_expires_at=NOW()+INTERVAL '1 minute'
        WHERE attempt_id=$1`,
      [attemptId],
    );
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='confirmed',receipt='{}'::jsonb,confirmed_at=NOW()
        WHERE attempt_id=$1`,
      [attemptId],
    );
    await expectRejectedInRollback(
      'DELETE FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
      [attemptId],
      /cleanup_outbox_delete_forbidden/,
    );
  });

  it('rejects changing the parent run of an existing attempt', async () => {
    const source = await seedActiveV2Run();
    const attempt = await seedRunningAttempt({ runId: source.runId });
    const target = await seedActiveV2Run();
    await testPool.query(
      `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
      [target.runId],
    );

    await expectRejectedInRollback(
      'UPDATE harness_attempts SET run_id=$2 WHERE id=$1',
      [attempt.attemptId, target.runId],
      /attempt_run_id_immutable/,
    );
  });

  it('terminalizes a v1 active attempt when its run is promoted to v2', async () => {
    const taskId = await seedTask();
    const runId = randomUUID();
    const attemptId = randomUUID();
    await testPool.query(
      `INSERT INTO initiative_runs (
         id,initiative_id,current_task_id,phase,orchestrator_version,
         created_source,started_at,updated_at,completed_at
       ) VALUES ($1,$2,$3,'failed','v1','legacy_relay',NOW(),NOW(),NOW())`,
      [runId, randomUUID(), taskId],
    );
    await testPool.query(
      `INSERT INTO harness_attempts (
         id,run_id,hop,phase,role,provider,task_bundle,status,
         callback_secret_hash,lease_owner,lease_generation
       ) VALUES ($1,$2,1,'generate','generator','codex','{}'::jsonb,
         'running',$3,'worker:v1',47)`,
      [attemptId, runId, 'a'.repeat(64)],
    );

    await testPool.query(
      `UPDATE initiative_runs SET orchestrator_version='v2',updated_at=NOW() WHERE id=$1`,
      [runId],
    );

    expect((await testPool.query(
      'SELECT status,error_code FROM harness_attempts WHERE id=$1',
      [attemptId],
    )).rows[0]).toMatchObject({
      status: 'cancelled',
      error_code: 'parent_run_terminal',
    });
    expect((await testPool.query(
      'SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
      [attemptId],
    )).rows[0].count).toBe(1);
  });

  it('flags terminal history and rejects reviving it', async () => {
    const { runId } = await seedActiveV2Run();
    await testPool.query(
      `UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1`,
      [runId],
    );
    const attemptId = randomUUID();
    await testPool.query(
      `INSERT INTO harness_attempts (
         id,run_id,hop,phase,role,provider,task_bundle,status,callback_secret_hash
       ) VALUES ($1,$2,1,'generate','generator','codex','{}'::jsonb,'completed',$3)`,
      [attemptId, runId, 'b'.repeat(64)],
    );

    expect((await testPool.query(
      'SELECT parent_run_terminal FROM harness_attempts WHERE id=$1',
      [attemptId],
    )).rows[0].parent_run_terminal).toBe(true);
    await expectRejectedInRollback(
      "UPDATE harness_attempts SET status='queued' WHERE id=$1",
      [attemptId],
      /attempt_parent_run_terminal/,
    );
  });

  it('does not deadlock an attempt status transition with parent terminalization', async () => {
    const { runId } = await seedActiveV2Run();
    const attemptId = randomUUID();
    const store = createAttemptStore(testPool);
    await store.createAttempt({
      id: attemptId,
      runId,
      hop: 1,
      phase: 'generate',
      role: 'generator',
      provider: 'codex',
      callbackSecretHash: 'c'.repeat(64),
      bundle: {},
    });
    await testPool.query(`
      CREATE OR REPLACE FUNCTION aaa_pause_attempt_starting() RETURNS trigger AS $$
      BEGIN
        IF OLD.id = '${attemptId}'::uuid AND NEW.status = 'starting' THEN
          PERFORM pg_sleep(1.5);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER aaa_pause_attempt_starting
      BEFORE UPDATE OF status ON harness_attempts
      FOR EACH ROW EXECUTE FUNCTION aaa_pause_attempt_starting();
    `);
    try {
      const starting = store.markStarting(attemptId, {
        leaseOwner: 'worker:lock-order',
        leaseSeconds: 60,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const terminal = testPool.query(
        "UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1",
        [runId],
      );
      const results = await Promise.allSettled([starting, terminal]);
      const errors = results
        .filter((result) => result.status === 'rejected')
        .map((result) => ({
          code: result.reason?.code,
          detail: result.reason?.detail,
          message: result.reason?.message,
          where: result.reason?.where,
        }));
      expect(errors).toEqual([]);
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      expect((await testPool.query(
        'SELECT status,parent_run_terminal FROM harness_attempts WHERE id=$1',
        [attemptId],
      )).rows[0]).toMatchObject({ status: 'cancelled', parent_run_terminal: true });
    } finally {
      await testPool.query('DROP TRIGGER IF EXISTS aaa_pause_attempt_starting ON harness_attempts');
      await testPool.query('DROP FUNCTION IF EXISTS aaa_pause_attempt_starting()');
    }
  }, 10_000);

  it('enforces blocked, reclaim, and claim-release transitions', async () => {
    const blocked = await seedPendingIntent();
    await testPool.query(
      "UPDATE harness_attempt_cleanup_outbox SET status='blocked' WHERE attempt_id=$1",
      [blocked.attemptId],
    );
    await expectRejectedInRollback(
      `UPDATE harness_attempt_cleanup_outbox SET status='leased',claim_owner='worker',
         claim_generation=claim_generation+1,claim_expires_at=NOW()+INTERVAL '1 minute'
       WHERE attempt_id=$1`,
      [blocked.attemptId],
      /cleanup_outbox_invalid_status_transition/,
    );
    await expectRejectedInRollback(
      "UPDATE harness_attempt_cleanup_outbox SET claim_owner='forged' WHERE attempt_id=$1",
      [blocked.attemptId], /cleanup_outbox_invalid_idle_claim_state/,
    );

    const leased = await seedPendingIntent();
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox SET status='leased',claim_owner='worker-a',
         claim_generation=claim_generation+1,claim_expires_at=NOW()+INTERVAL '1 second'
       WHERE attempt_id=$1`,
      [leased.attemptId],
    );
    await expectRejectedInRollback(
      `UPDATE harness_attempt_cleanup_outbox SET claim_owner='worker-b',
         claim_generation=claim_generation+1,claim_expires_at=NOW()+INTERVAL '2 minutes'
       WHERE attempt_id=$1`,
      [leased.attemptId],
      /cleanup_outbox_invalid_lease_reclaim/,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox SET claim_owner='worker-b',
         claim_generation=claim_generation+1,claim_expires_at=NOW()+INTERVAL '1 minute' WHERE attempt_id=$1`,
      [leased.attemptId],
    );
    await expectRejectedInRollback(
      "UPDATE harness_attempt_cleanup_outbox SET status='pending',claim_generation=claim_generation+1 WHERE attempt_id=$1",
      [leased.attemptId],
      /cleanup_outbox_invalid_claim_release/,
    );
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox SET status='pending',claim_owner=NULL,
         claim_expires_at=NULL WHERE attempt_id=$1`,
      [leased.attemptId],
    );
  });

  it('rejects rolling migration 425 back while cleanup evidence exists', async () => {
    await seedPendingIntent();
    await expect(testPool.query(rollback425)).rejects.toThrow(
      /cleanup_outbox_rollback_nonempty/,
    );
    expect((await testPool.query(
      "SELECT to_regclass('harness_attempt_cleanup_outbox') AS table_name",
    )).rows[0].table_name).toBe('harness_attempt_cleanup_outbox');
  });
});
