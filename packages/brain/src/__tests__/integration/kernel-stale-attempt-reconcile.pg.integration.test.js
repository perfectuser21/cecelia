import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileStaleAttempts } from '../../../scripts/kernel-stale-attempt-reconcile.mjs';
import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { finalizeKernelRun } from '../../orchestrator/kernel-run-store.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;
let auditDirectory;

function quotedIdentifier(value) {
  if (!/^kernel_stale_attempt_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `kernel_stale_attempt_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
  auditDirectory = await mkdtemp(join(tmpdir(), 'kernel-stale-attempt-pg-'));
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    let activeSessions = 1;
    for (let attempt = 0; attempt < 250 && activeSessions > 0; attempt += 1) {
      const result = await adminPool.query(
        `SELECT COUNT(*)::int AS count
           FROM pg_stat_activity
          WHERE datname = $1`,
        [databaseName],
      );
      activeSessions = result.rows[0].count;
      if (activeSessions > 0) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    if (activeSessions > 0) {
      throw new Error(`test database still has ${activeSessions} active sessions`);
    }
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
  if (auditDirectory) await rm(auditDirectory, { recursive: true, force: true });
}, 30_000);

describe('kernel stale attempt reconciliation on real PostgreSQL', () => {
  it('rejects attempt creation after the exact parent run is terminal', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'terminal create fence', 'failed')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, completed_at, record_trust_status
       ) VALUES (
         $1, $2, 'failed', $3, 'v2', 'kernel_dispatch', NOW(), 'trusted'
       )`,
      [runId, randomUUID(), taskId],
    );

    await expect(createAttemptStore(testPool).createAttempt({
      id: randomUUID(),
      runId,
      hop: 1,
      phase: 'planning',
      role: 'planner',
      provider: 'auto',
      bundle: {},
      callbackSecretHash: 'a'.repeat(64),
    })).rejects.toThrow(`Kernel run is terminal or missing: ${runId}`);
  });

  it('serializes callback and finalization without an active attempt or deadlock', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'callback finalize race', 'in_progress')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, record_trust_status
       ) VALUES (
         $1, $2, 'generate', $3, 'v2', 'kernel_dispatch', 'trusted'
       )`,
      [runId, randomUUID(), taskId],
    );
    const store = createAttemptStore(testPool);
    await store.createAttempt({
      id: attemptId,
      runId,
      hop: 1,
      phase: 'generate',
      role: 'generator',
      provider: 'auto',
      bundle: {},
      callbackSecretHash: 'b'.repeat(64),
    });
    await testPool.query(
      `UPDATE harness_attempts
          SET status = 'running',
              lease_owner = 'race-worker',
              lease_expires_at = NOW() + INTERVAL '2 minutes'
        WHERE id = $1`,
      [attemptId],
    );
    await testPool.query(`
      CREATE OR REPLACE FUNCTION pause_callback_attempt_terminal()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.id = '${attemptId}'::uuid
           AND OLD.status = 'running'
           AND NEW.status IN ('completed', 'cancelled') THEN
          PERFORM pg_sleep(0.5);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER pause_callback_attempt_terminal
      BEFORE UPDATE OF status ON harness_attempts
      FOR EACH ROW
      EXECUTE FUNCTION pause_callback_attempt_terminal();
    `);

    const callback = store.recordCallbackTerminal({
      attemptId,
      runId,
      leaseOwner: 'race-worker',
      leaseGeneration: 0,
      result: {
        status: 'completed',
        summary: 'callback won or serialized',
        artifacts: [{
          type: 'pull_request',
          url: 'https://github.com/perfectuser21/cecelia/pull/4508',
          head_sha: 'd'.repeat(40),
          verification_status: 'verified',
        }],
        provider_metadata: { provider: 'codex' },
      },
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const finalization = finalizeKernelRun(testPool, {
      runId,
      expectedTaskId: taskId,
      outcome: 'failed',
      reason: 'callback_finalize_race',
    });
    const [callbackResult, finalizationResult] = await Promise.allSettled([
      callback,
      finalization,
    ]);
    await testPool.query('DROP TRIGGER pause_callback_attempt_terminal ON harness_attempts');

    for (const result of [callbackResult, finalizationResult]) {
      if (result.status === 'rejected') {
        expect(result.reason?.code).not.toBe('40P01');
      }
    }
    expect(callbackResult.status).toBe('fulfilled');
    expect(finalizationResult.status).toBe('fulfilled');
    const state = await testPool.query(
      `SELECT status
         FROM harness_attempts
        WHERE id = $1`,
      [attemptId],
    );
    expect(['completed', 'cancelled']).toContain(state.rows[0].status);
    expect(['queued', 'starting', 'running']).not.toContain(state.rows[0].status);
    if (state.rows[0].status === 'cancelled') {
      expect(callbackResult.value).toMatchObject({
        conflict: 'terminal_payload_conflict',
      });
    } else {
      expect(callbackResult.value.attempt).toMatchObject({ status: 'completed' });
    }
  });

  it('does not propose a live lease or an attempt under an active parent', async () => {
    const liveTaskId = randomUUID();
    const liveRunId = randomUUID();
    const activeTaskId = randomUUID();
    const activeRunId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES
         ($1, 'live lease fence', 'failed'),
         ($2, 'active parent fence', 'in_progress')`,
      [liveTaskId, activeTaskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, completed_at, record_trust_status
       ) VALUES
         ($1, $3, 'failed', $4, 'v2', 'kernel_dispatch', NOW(), 'trusted'),
         ($2, $5, 'generate', $6, 'v2', 'kernel_dispatch', NULL, 'trusted')`,
      [
        liveRunId,
        activeRunId,
        randomUUID(),
        liveTaskId,
        randomUUID(),
        activeTaskId,
      ],
    );
    await testPool.query(
      `INSERT INTO harness_attempts (
         id, run_id, hop, phase, role, task_bundle, callback_secret_hash,
         status, lease_owner, lease_expires_at
       ) VALUES
         ($1, $3, 1, 'generate', 'generator', '{}'::jsonb, $5,
          'running', 'live-worker', NOW() + INTERVAL '5 minutes'),
         ($2, $4, 1, 'generate', 'generator', '{}'::jsonb, $5,
          'running', 'stale-worker', NOW() - INTERVAL '5 minutes')`,
      [randomUUID(), randomUUID(), liveRunId, activeRunId, 'c'.repeat(64)],
    );

    const dry = await reconcileStaleAttempts({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(dry).toMatchObject({ proposed: 0, blocked: 0 });
  });

  it('audits one exact expired attempt and converges to zero proposals', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'stale attempt evidence', 'failed')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at, failure_reason,
         record_trust_status
       ) VALUES (
         $1, $2, 'failed', $3, 'v2', 'kernel_dispatch',
         NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day',
         'orphan_guard_exhausted', 'trusted'
       )`,
      [runId, randomUUID(), taskId],
    );
    await testPool.query(
      `INSERT INTO harness_attempts (
         id, run_id, hop, phase, role, task_bundle, callback_secret_hash,
         status, lease_owner, lease_expires_at, started_at, updated_at
       ) VALUES (
         $1, $2, 1, 'generate', 'generator', '{}'::jsonb, $3,
         'running', 'dead-worker', NOW() - INTERVAL '1 day',
         NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'
       )`,
      [attemptId, runId, 'a'.repeat(64)],
    );

    const dry = await reconcileStaleAttempts({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(dry).toMatchObject({
      database: databaseName,
      proposed: 1,
      blocked: 0,
    });

    const auditOutput = join(auditDirectory, 'stale-attempt-reconcile.jsonl');
    const applied = await reconcileStaleAttempts({
      db: testPool,
      apply: true,
      auditOutput,
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: dry.proposed,
      confirmDatabase: databaseName,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(applied).toMatchObject({
      proposed: 1,
      applied: 1,
      verified: 1,
      blocked: 0,
    });

    const state = await testPool.query(
      `SELECT status, error_code, lease_owner, lease_expires_at, completed_at
         FROM harness_attempts
        WHERE id = $1`,
      [attemptId],
    );
    expect(state.rows[0]).toMatchObject({
      status: 'cancelled',
      error_code: 'parent_run_terminal',
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(state.rows[0].completed_at).not.toBeNull();

    const secondDry = await reconcileStaleAttempts({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(secondDry).toMatchObject({ proposed: 0, blocked: 0 });

    expect((await stat(auditOutput)).mode & 0o777).toBe(0o400);
    const audit = await readFile(auditOutput, 'utf8');
    expect(audit).toContain('"commit_state":"verified"');
    expect(audit).toContain(`"attempt_id":"${attemptId}"`);
  });
});
